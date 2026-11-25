import { createZipStream, uniqueZipNames, type ZipEntrySource } from "@/lib/zip";
import { collectDriveDescendants } from "./access";
import type { DriveRow } from "./types";
import { driveContentDisposition, driveObjectKey, normalizeDriveName } from "./utils";

// The shared ZIP writer uses classic field widths, with these values reserved for ZIP64.
const ZIP32_BYTES = 0xffffffff;
const ZIP32_ENTRIES = 0xffff;
const ENTRY_OVERHEAD = 30 + 16 + 46 + 2; // headers, descriptor, and the two possible directory slashes

function archiveSegment(name: string): string {
	const segment = normalizeDriveName(name)?.replace(/[:*?"<>|]/g, "_").replace(/[. ]+$/, "") || "file";
	return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ? `_${segment}` : segment;
}

/** Streams a folder after the caller checks access. Children inherit access from the folder. */
export async function downloadDriveFolder(env: CloudflareEnv, db: Parameters<typeof collectDriveDescendants>[0], folder: DriveRow): Promise<Response> {
	const children = new Map<string, DriveRow[]>();
	for (const item of await collectDriveDescendants(db, [folder.id], folder.ownerId)) {
		if (!item.parentId || item.id === folder.id || item.trashedAt || item.uploadId) continue;
		const siblings = children.get(item.parentId) ?? [];
		siblings.push(item);
		children.set(item.parentId, siblings);
	}

	const encoder = new TextEncoder();
	const entries: ZipEntrySource[] = [];
	let archiveBytes = 22; // end of central directory record
	function append(item: DriveRow, path: string): boolean {
		archiveBytes += Number(item.size) + ENTRY_OVERHEAD + 2 * encoder.encode(path).byteLength;
		if (entries.length + 1 >= ZIP32_ENTRIES || archiveBytes >= ZIP32_BYTES) return false;
		if (item.kind === "file") {
			entries.push({ name: path, modified: item.updatedAt, open: async () => {
				const object = await env.BUCKET.get(item.r2Key ?? driveObjectKey(item.ownerId, item.id));
				if (!object || object.size !== Number(item.size)) throw new Error("Drive file is missing or incomplete in storage");
				return object.body;
			} });
			return true;
		}
		entries.push({ name: path, modified: item.updatedAt, directory: true });
		const siblings = children.get(item.id) ?? [];
		const names = uniqueZipNames(siblings.map(({ name }) => archiveSegment(name)), true);
		return siblings.every((child, index) => append(child, `${path}/${names[index]}`));
	}

	const name = archiveSegment(folder.name);
	if (!append(folder, name)) return new Response("Folder is too large for a single ZIP download", { status: 413 });
	return new Response(createZipStream(entries), {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": driveContentDisposition(`${name}.zip`, false),
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
