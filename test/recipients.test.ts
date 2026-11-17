import { describe, expect, it } from "vitest";
import { isAllowedRecipient, parseRecipients } from "../src/recipients";

describe("recipient allowlist", () => {
  it("allows everything when unset or empty", () => {
    expect(isAllowedRecipient("anyone@example.com", parseRecipients(undefined))).toBe(true);
    expect(isAllowedRecipient("anyone@example.com", parseRecipients("  "))).toBe(true);
  });

  it("matches case-insensitively across comma/space separated entries", () => {
    const allowed = parseRecipients("Contact@Example.com, hello@example.com\nops@example.com");
    expect(allowed).toEqual(["contact@example.com", "hello@example.com", "ops@example.com"]);
    expect(isAllowedRecipient("CONTACT@example.com", allowed)).toBe(true);
    expect(isAllowedRecipient("ops@example.com", allowed)).toBe(true);
    expect(isAllowedRecipient("other@example.com", allowed)).toBe(false);
  });
});
