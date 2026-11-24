import type { DomainDnsView } from "@/lib/domains/service";
import type { DomainRow } from "@/lib/domains/types";

/**
 * Suggested records for a self-hosted zone, with the relay's signing selector
 * for the independent public DNS audit when one is configured.
 */
export async function getManualDomainDns(
	env: CloudflareEnv,
	hostname: string,
	sendingProvider: DomainRow["sendingProvider"],
): Promise<DomainDnsView> {
	const mailHost = process.env.MAIL_HOSTNAME?.trim() || `mail.${hostname}`;
	const records = [
		{ type: "MX", name: hostname, content: `10 ${mailHost}`, ttl: 3600 },
		{ type: "TXT", name: hostname, content: `v=spf1 a:${mailHost} ~all`, ttl: 3600 },
		{ type: "TXT", name: `_dmarc.${hostname}`, content: "v=DMARC1; p=none", ttl: 3600 },
	];
	const mailer = env.EMAIL as unknown as { configured?: boolean };
	const selector = env.SMTP_DKIM_SELECTOR;
	// The default provider uses the EMAIL binding, which is the relay in Node SMTP mode.
	const usesRelaySelector = sendingProvider === "cloudflare"
		&& env.SMTP_DKIM_DOMAIN?.toLowerCase() === hostname.toLowerCase();
	const validSelector = selector?.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label));
	return {
		routing: { records: [], missing: records, status: "manual" },
		sending: [],
		sendingEnabled: mailer?.configured === true,
		dkimSelector: usesRelaySelector && validSelector ? selector : undefined,
	};
}
