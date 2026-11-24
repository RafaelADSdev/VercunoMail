import { getObjectStorageConfig } from "@/lib/storage/b2-config";
import { openB2Bucket } from "@/lib/storage/b2-bucket";
import { splitDriveBucket } from "@/lib/storage/drive-bucket";

const wrapped = new WeakMap<object, CloudflareEnv>();
const proxies = new WeakSet<object>();

/**
 * Returns env with BUCKET served by Backblaze B2 (B2_*) or AWS S3 (S3_*) when configured; otherwise env unchanged
 * (the R2 binding on Workers, the file bucket when self-hosted). A separate Drive backend can override the
 * drive/ prefix. Proxied rather than spread because Worker bindings are not enumerable.
 */
export function withStorage(env: CloudflareEnv): CloudflareEnv {
	if (proxies.has(env)) return env;
	const cached = wrapped.get(env);
	if (cached) return cached;
	const config = getObjectStorageConfig(env);
	const drive = env.DRIVE_STORAGE?.bucket;
	if (!config && !drive) return env;
	const base = config ? openB2Bucket(config) : env.BUCKET;
	const bucket = drive ? splitDriveBucket(base, drive) : base;
	const proxy = new Proxy(env, { get: (target, property) => (property === "BUCKET" ? bucket : Reflect.get(target, property)) });
	wrapped.set(env, proxy);
	proxies.add(proxy);
	return proxy;
}
