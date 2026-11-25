import { authFetch } from "@/lib/auth/client";
import { folderPathBatches, importName } from "@/lib/drive/import-utils";
import type { ImportFolderResult } from "@/lib/drive/import-store-types";
import { DRIVE_MAX_DEPTH } from "@/lib/drive/utils";

export type DriveUploadSelection = {
	files: { file: File; parentPath: string[] }[];
	folders: string[][];
};

function folderSegment(name: string): string {
	const segment = importName(name);
	if (!segment) throw new Error("Invalid folder name");
	return segment;
}

async function readEntry(entry: FileSystemEntry, parentPath: string[], selection: DriveUploadSelection): Promise<void> {
	if (entry.isFile) {
		const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
		selection.files.push({ file, parentPath });
		return;
	}
	if (!entry.isDirectory) return;
	if (parentPath.length >= DRIVE_MAX_DEPTH) throw new Error("Folders are nested too deeply");
	const path = [...parentPath, folderSegment(entry.name)];
	selection.folders.push(path);
	const reader = (entry as FileSystemDirectoryEntry).createReader();
	for (;;) {
		const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
		if (!entries.length) return;
		for (const child of entries) await readEntry(child, path, selection);
	}
}

export async function collectDroppedDriveUpload(transfer: Pick<DataTransfer, "files" | "items">): Promise<DriveUploadSelection> {
	// Snapshot each item while the drop event still exposes its data store.
	const items = Array.from(transfer.items).filter((item) => item.kind === "file")
		.map((item) => item.webkitGetAsEntry?.() ?? item.getAsFile());
	const sources = items.some(Boolean) ? items : Array.from(transfer.files);
	const selection: DriveUploadSelection = { files: [], folders: [] };
	for (const source of sources) {
		if (!source) continue;
		if ("isFile" in source) await readEntry(source, [], selection);
		else {
			// Browsers may surface a directory as an unreadable zero-byte file.
			if (!source.size) await source.arrayBuffer();
			selection.files.push({ file: source, parentPath: [] });
		}
	}
	return selection;
}

export function collectPickedDriveUpload(files: File[], fromFolder = false): DriveUploadSelection {
	const folders = new Map<string, string[]>();
	const entries = files.map((file) => {
		const parentPath = fromFolder ? file.webkitRelativePath.split("/").slice(0, -1).map(folderSegment) : [];
		if (fromFolder && (!parentPath.length || parentPath.length > DRIVE_MAX_DEPTH)) throw new Error("Invalid folder path");
		if (parentPath.length) folders.set(parentPath.join("/"), parentPath);
		return { file, parentPath };
	});
	return { files: entries, folders: [...folders.values()] };
}

export async function createDriveUploadFolders(parentId: string | null, paths: string[][]): Promise<Map<string, string>> {
	const ids = new Map<string, string>();
	for (const batch of folderPathBatches(paths)) {
		const response = await authFetch("/api/drive/import/folders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ parentId, paths: batch }),
		});
		const result = await response.json() as ImportFolderResult & { error?: string };
		if (!response.ok) throw new Error(result.error);
		for (const [path, id] of Object.entries(result.folders)) ids.set(path, id);
	}
	return ids;
}
