import PostalMime from "postal-mime";
import { formatSummary, stripHtml, type SummaryInput } from "./format";
import { isAllowedRecipient, parseRecipients } from "./recipients";

const PARSE_LIMIT = 1024 * 1024; // 1 MiB: bigger mail gets a header-only summary (CPU budget)

export default {
  async email(message, env, _ctx): Promise<void> {
    if (!isAllowedRecipient(message.to, parseRecipients(env.ALLOWED_RECIPIENTS))) {
      console.warn("forward-bot: rejecting mail to a recipient not in ALLOWED_RECIPIENTS");
      message.setReject("Unknown recipient");
      return;
    }

    // The raw stream may be single-use and the docs don't say whether forward() leaves it
    // readable, so for parseable sizes copy the bytes out first (cheap), then forward.
    // Parsing (the CPU-heavy part) happens only after the forward has succeeded.
    const small = message.rawSize <= PARSE_LIMIT;
    let rawBytes: ArrayBuffer | undefined;
    if (small) {
      try {
        rawBytes = await new Response(message.raw).arrayBuffer();
      } catch (err) {
        console.error("forward-bot: failed to buffer raw message", errMsg(err));
      }
    }

    // Critical path: if this throws, let it propagate so Cloudflare bounces/retries.
    await message.forward(env.FORWARD_TO, new Headers({ "X-Forwarded-By": "forward-bot" }));

    // Best effort from here on: never throw.
    try {
      const input: SummaryInput = {
        from: message.headers.get("from") ?? message.from,
        to: message.to,
        subject: message.headers.get("subject"),
        date: message.headers.get("date"),
      };
      if (message.headers.get("from") && message.headers.get("from") !== message.from) {
        input.from = `${message.headers.get("from")} (envelope: ${message.from})`;
      }

      if (!small) {
        input.tooLarge = true;
      } else if (rawBytes) {
        const parsed = await PostalMime.parse(rawBytes);
        input.body = parsed.text || (parsed.html ? stripHtml(parsed.html) : "");
        input.attachments = parsed.attachments.map((a) => ({
          filename: a.filename,
          size: byteLength(a.content),
        }));
        input.subject = parsed.subject ?? input.subject ?? null;
      }

      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: formatSummary(input),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        // Telegram's error body describes the problem; it does not echo the token.
        console.error("forward-bot: telegram sendMessage failed", res.status, await res.text());
      }
    } catch (err) {
      console.error("forward-bot: telegram summary failed", errMsg(err));
    }
  },
} satisfies ExportedHandler<Env>;

function byteLength(content: ArrayBuffer | Uint8Array | string): number {
  return typeof content === "string" ? new TextEncoder().encode(content).length : content.byteLength;
}

// Error messages from fetch can include the request URL, which contains the bot token.
function errMsg(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, "bot<redacted>");
}
