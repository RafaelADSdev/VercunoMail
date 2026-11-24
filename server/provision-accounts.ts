import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { domains, mailboxes, users } from "@/db/schema";
import { createAccountResponse } from "@/app/api/accounts/create";
import { verifyPassword } from "@/lib/auth/password";
import { createUserAccountSchema } from "@/lib/validators";
import { createNodeRuntime } from "./runtime/env";

const provisioningSchema = z.object({
	adminEmail: z.string().email(),
	accounts: z.array(z.object({ email: z.string().email(), password: z.string().min(16).max(72) })).min(1).max(50),
});

async function main() {
	const request = provisioningSchema.safeParse(JSON.parse(readFileSync(0, "utf8")));
	if (!request.success) throw new Error("Provide an admin email and account credentials on stdin.");

	const { env } = createNodeRuntime();
	const db = getDb(env);
	const [admin] = await db.select().from(users).where(eq(users.email, request.data.adminEmail.toLowerCase())).limit(1);
	if (!admin || admin.role !== "admin" || !admin.isPrimaryAdmin || admin.disabled || admin.deletedAt) {
		throw new Error("The primary administrator is unavailable.");
	}

	for (const account of request.data.accounts) {
		const email = account.email.toLowerCase();
		const separator = email.lastIndexOf("@");
		const username = email.slice(0, separator);
		const hostname = email.slice(separator + 1);
		const [domain] = await db.select().from(domains).where(and(eq(domains.hostname, hostname), eq(domains.userId, admin.id))).limit(1);
		if (!domain) throw new Error("The administrator does not own the requested domain.");

		const input = createUserAccountSchema.safeParse({
			username, domainId: domain.id, password: account.password, role: "user", useAllDomains: false, aliases: [],
		});
		if (!input.success) throw new Error("The username or password does not meet the account requirements.");

		const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
		if (existing) {
			const [mailbox] = await db.select({ id: mailboxes.id }).from(mailboxes)
				.where(and(eq(mailboxes.userId, existing.id), eq(mailboxes.domainId, domain.id), eq(mailboxes.localPart, username))).limit(1);
			if (existing.role !== "user" || existing.createdByUserId !== admin.id || existing.disabled
				|| existing.deletedAt || !mailbox || !verifyPassword(account.password, existing.passwordHash)) {
				throw new Error(`The address ${email} is already in use.`);
			}
			console.log(`${email} already provisioned`);
			continue;
		}

		const result = await createAccountResponse(env, admin, input.data);
		if (result.status !== 201) {
			const { error } = await result.json() as { error?: string };
			throw new Error(`Could not provision ${email}: ${error ?? result.status}`);
		}
		console.log(`${email} provisioned`);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : "Account provisioning failed.");
	process.exitCode = 1;
});
