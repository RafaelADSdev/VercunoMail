import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { domains, mailboxes, users } from "@/db/schema";
import { getAccountStatus } from "@/lib/accounts/deletion-utils";
import { canManageUserAccount, canManageUsers } from "@/lib/auth/admin";
import type { SessionUser } from "@/lib/auth/types";
import { getLicenseEntitlements } from "@/lib/licenses/service";
import { tracksAccountIdentity } from "@/lib/profile/identity-utils";
import { getMailboxAccessLevel } from "./access";

/** List settings for manageable accounts without granting access to their mail. */
export async function listManagedMailboxSummaries(db: AppDatabase, user: SessionUser) {
	if (!canManageUsers(user)) return [];

	const rows = await db.select({
		mailbox: {
			id: mailboxes.id,
			domainId: mailboxes.domainId,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			type: mailboxes.type,
			hostname: domains.hostname,
		},
		avatarKey: mailboxes.avatarKey,
		owner: {
			email: users.email,
			name: users.name,
			avatarKey: users.avatarKey,
			role: users.role,
			isPrimaryAdmin: users.isPrimaryAdmin,
			disabled: users.disabled,
			lastSignInAt: users.lastSignInAt,
		},
	}).from(mailboxes)
		.innerJoin(users, eq(mailboxes.userId, users.id))
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(and(eq(mailboxes.disabled, false), isNull(users.deletedAt)))
		.orderBy(asc(domains.hostname), asc(mailboxes.localPart));

	return rows.filter(({ owner }) => canManageUserAccount(user, owner)).map(({ mailbox, avatarKey, owner }) => {
		const tracksIdentity = tracksAccountIdentity(mailbox, owner.email);
		return {
			...mailbox,
			displayName: tracksIdentity ? owner.name : mailbox.displayName,
			hasAvatar: !!(tracksIdentity ? owner.avatarKey : avatarKey),
			status: mailbox.type === "shared" ? "active" : getAccountStatus(owner),
			lastSignInAt: mailbox.type === "shared" ? null : owner.lastSignInAt,
		};
	});
}

/** Configuration access does not grant permission to read or send mail. */
export async function getMailboxSettingsAccess(
	env: CloudflareEnv,
	user: Pick<SessionUser, "id" | "role" | "isPrimaryAdmin" | "canManageUsers">,
	mailboxId: string,
) {
	const db = getDb(env);
	const access = await getMailboxAccessLevel(db, user, mailboxId);
	if (access?.canManage || !canManageUsers(user)) return access;

	const [owner] = await db
		.select({ role: users.role, isPrimaryAdmin: users.isPrimaryAdmin })
		.from(mailboxes)
		.innerJoin(users, eq(mailboxes.userId, users.id))
		.where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.disabled, false), isNull(users.deletedAt)))
		.limit(1);
	if (!owner || !canManageUserAccount(user, owner) || !(await getLicenseEntitlements(env)).canManageAccounts) {
		return access;
	}

	return { permission: access?.permission ?? null, canRead: true, canManage: true };
}
