import { describe, expect, it } from "vitest";
import { formatSummary, stripHtml, TELEGRAM_LIMIT } from "../src/format";

const base = { from: "a@example.com", to: "contact@howlettga.net" };

describe("formatSummary", () => {
  it("escapes & < > in every field", () => {
    const out = formatSummary({
      from: "A <a@example.com>",
      to: "b&c@example.com",
      subject: "<script>x</script>",
      date: "d<>&",
      body: "1 < 2 && 3 > 2",
      attachments: [{ filename: "<f>&.txt", size: 10 }],
    });
    expect(out).toContain("A &lt;a@example.com&gt;");
    expect(out).toContain("b&amp;c@example.com");
    expect(out).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(out).toContain("1 &lt; 2 &amp;&amp; 3 &gt; 2");
    expect(out).toContain("&lt;f&gt;&amp;.txt");
    expect(out).not.toMatch(/<script|<f>/);
  });

  it("truncates a huge body under 4096 chars with a marker", () => {
    const out = formatSummary({ ...base, subject: "s", body: "x".repeat(10000) });
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(out).toContain("…(truncated)");
  });

  it("stays under the limit even when escaping expands the body", () => {
    const out = formatSummary({ ...base, subject: "<".repeat(300), body: "&".repeat(10000) });
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(out).toContain("…(truncated)");
  });

  it("does not mark short bodies as truncated", () => {
    const out = formatSummary({ ...base, subject: "s", body: "hi there" });
    expect(out).toContain("hi there");
    expect(out).not.toContain("truncated");
  });

  it("handles a missing subject", () => {
    expect(formatSummary({ ...base, subject: null, body: "x" })).toContain("(no subject)");
    expect(formatSummary({ ...base, subject: "  ", body: "x" })).toContain("(no subject)");
  });

  it("handles a missing text body and oversize mail", () => {
    expect(formatSummary({ ...base, subject: "s", body: "" })).toContain("(no text body)");
    expect(formatSummary({ ...base, subject: "s", tooLarge: true })).toContain("too large");
  });

  it("lists attachments with sizes", () => {
    const out = formatSummary({
      ...base,
      subject: "s",
      body: "x",
      attachments: [
        { filename: "a.pdf", size: 2048 },
        { filename: null, size: 5 },
      ],
    });
    expect(out).toContain("Attachments (2)");
    expect(out).toContain("a.pdf (2.0 KB)");
    expect(out).toContain("(unnamed) (5 B)");
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    expect(stripHtml("<style>p{}</style><p>a &amp; b</p><p>c<br>d</p>")).toBe("a & b\nc\nd");
  });
});
