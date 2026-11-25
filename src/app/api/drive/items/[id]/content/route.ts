import { authorizeDrive } from "@/lib/drive/auth";
import { getDriveItem, getDriveRole } from "@/lib/drive/access";
import { streamDriveFile } from "@/lib/drive/content";
import { downloadDriveFolder } from "@/lib/drive/folder-download";
import type { DriveItemParams } from "../types";

export async function GET(request: Request, { params }: DriveItemParams) {
	const { id } = await params;
	const auth = await authorizeDrive(request);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	const item = await getDriveItem(db, id);
	if (!item || item.uploadId || !(await getDriveRole(db, user.id, item))) return new Response("Not found", { status: 404 });
	const download = new URL(request.url).searchParams.get("download") === "1";
	if (download && item.kind === "folder") return downloadDriveFolder(env, db, item);
	return streamDriveFile(env, request, item, download);
}
