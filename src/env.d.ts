// Secrets (set with `wrangler secret put`, or in .dev.vars locally).
interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  FORWARD_TO: string;
  /** Optional comma-separated inbound addresses to accept; unset accepts whatever the routing rule sends. */
  ALLOWED_RECIPIENTS?: string;
}
