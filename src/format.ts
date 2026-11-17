// Pure formatter: parsed email fields in, Telegram HTML out. No I/O.

export interface SummaryInput {
  from: string;
  to: string;
  subject?: string | null;
  date?: string | null;
  /** Plain-text body; undefined/empty when unavailable. */
  body?: string | null;
  attachments?: { filename?: string | null; size: number }[];
  /** True when the mail was too large to parse, so the body is omitted. */
  tooLarge?: boolean;
}

export const TELEGRAM_LIMIT = 4096;
export const BODY_TARGET = 3500;
export const TRUNCATED_MARK = "…(truncated)";
const FIELD_MAX = 300;
const MAX_ATTACHMENTS = 20;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Crude HTML to text, for mail with no text/plain part. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function clip(s: string, max = FIELD_MAX): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Cut `text` so its escaped form fits in `budget` chars. Returns the escaped text. */
function escapeWithin(text: string, budget: number): { out: string; cut: boolean } {
  let out = "";
  for (const ch of text) {
    const e = escapeHtml(ch);
    if (out.length + e.length > budget) return { out, cut: true };
    out += e;
  }
  return { out, cut: false };
}

export function formatSummary(input: SummaryInput): string {
  const lines = [
    `<b>From:</b> ${escapeHtml(clip(input.from))}`,
    `<b>To:</b> ${escapeHtml(clip(input.to))}`,
    `<b>Subject:</b> ${escapeHtml(clip(input.subject?.trim() || "(no subject)"))}`,
  ];
  if (input.date) lines.push(`<b>Date:</b> ${escapeHtml(clip(input.date))}`);

  const atts = input.attachments ?? [];
  if (atts.length > 0) {
    lines.push("", `<b>Attachments (${atts.length}):</b>`);
    for (const a of atts.slice(0, MAX_ATTACHMENTS)) {
      lines.push(`- ${escapeHtml(clip(a.filename || "(unnamed)", 100))} (${formatSize(a.size)})`);
    }
    if (atts.length > MAX_ATTACHMENTS) lines.push(`…and ${atts.length - MAX_ATTACHMENTS} more`);
  }

  lines.push("");
  const head = lines.join("\n");

  if (input.tooLarge) return head + "<i>(message too large to preview)</i>";
  const body = input.body?.trim();
  if (!body) return head + "<i>(no text body)</i>";

  const mark = escapeHtml(TRUNCATED_MARK);
  const budget = Math.min(BODY_TARGET, TELEGRAM_LIMIT - head.length - mark.length - 1);
  const { out, cut } = escapeWithin(body, Math.max(budget, 0));
  return head + out + (cut ? mark : "");
}
