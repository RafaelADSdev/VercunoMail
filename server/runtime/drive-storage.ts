import { openB2Bucket } from "@/lib/storage/b2-bucket";

export function openDriveStorage(env: NodeJS.ProcessEnv): CloudflareEnv["DRIVE_STORAGE"] {
	if (!env.DRIVE_S3_URL) return undefined;
	const url = new URL(env.DRIVE_S3_URL);
	const { DRIVE_S3_BUCKET: bucket, DRIVE_S3_REGION: region, DRIVE_S3_KEY_ID: keyId,
		DRIVE_S3_SECRET_KEY: applicationKey, DRIVE_S3_SESSION_TOKEN: sessionToken } = env;
	const maxFileBytes = Number(env.DRIVE_S3_MAX_FILE_BYTES);
	if (!bucket || !region || !keyId || !applicationKey || !Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0
		|| !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error("Invalid Drive S3 configuration. Check the endpoint, credentials and file size limit.");
	}
	return { bucket: openB2Bucket({ url, endpoint: url.host, bucket, region, keyId, applicationKey, sessionToken }), maxFileBytes };
}
