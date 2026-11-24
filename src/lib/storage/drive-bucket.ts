const DRIVE_PREFIX = "drive/";
const isDriveKey = (key: string) => key.startsWith(DRIVE_PREFIX);

/** Drive's uploaded files use their own prefix. Mail attachments linked from Drive keep their original keys. */
export function splitDriveBucket(base: R2Bucket, drive: R2Bucket): R2Bucket {
	const bucketFor = (key: string) => isDriveKey(key) ? drive : base;
	return {
		get: (key, options) => bucketFor(key).get(key, options),
		head: (key) => bucketFor(key).head(key),
		put: (key, value, options) => bucketFor(key).put(key, value, options),
		createMultipartUpload: (key, options) => bucketFor(key).createMultipartUpload(key, options),
		resumeMultipartUpload: (key, uploadId) => bucketFor(key).resumeMultipartUpload(key, uploadId),
		list: (options) => bucketFor(options?.prefix ?? "").list(options),
		async delete(keys) {
			if (typeof keys === "string") return bucketFor(keys).delete(keys);
			const driveKeys = keys.filter(isDriveKey);
			const baseKeys = keys.filter((key) => !isDriveKey(key));
			await Promise.all([
				driveKeys.length ? drive.delete(driveKeys) : undefined,
				baseKeys.length ? base.delete(baseKeys) : undefined,
			]);
		},
	} as R2Bucket;
}
