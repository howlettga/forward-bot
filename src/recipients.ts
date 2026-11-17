// Optional recipient allowlist. The routing rule in Cloudflare decides which addresses reach the
// Worker; this is a second guard so a later catch-all or extra rule doesn't silently start forwarding.

/** Parse a comma/whitespace-separated list of addresses. Empty or unset means "allow all". */
export function parseRecipients(list: string | undefined): string[] {
  return (list ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedRecipient(to: string, allowed: string[]): boolean {
  return allowed.length === 0 || allowed.includes(to.trim().toLowerCase());
}
