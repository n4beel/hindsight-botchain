import { describe, expect, it } from "vitest";
import {
  commitmentOf,
  exportRevealFile,
  importRevealFile,
  lapsedCount,
  randomSalt,
  statusOf,
  textByteLength,
  windowCloses,
  type RevealPayload,
} from "../hindsight";
import { REVEAL_WINDOW } from "../limits";

describe("hindsight library", () => {
  const alice = "0x00000000000000000000000000000000000A11cE" as const;
  const bob = "0x0000000000000000000000000000000000000B0B" as const;
  const salt1 = "0x000000000000000000000000000000000000000000000000000000000005a171" as const;
  const pred1 = "Bitcoin reaches new ATH before November.";

  describe("randomSalt", () => {
    it("generates a 32-byte 0x-prefixed hex string", () => {
      const s = randomSalt();
      expect(s).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("generates distinct values across calls", () => {
      const s1 = randomSalt();
      const s2 = randomSalt();
      expect(s1).not.toBe(s2);
    });
  });

  describe("commitmentOf", () => {
    it("computes deterministic keccak256 commitment matching abi.encode(author, text, salt)", () => {
      const c1 = commitmentOf(alice, pred1, salt1);
      const c2 = commitmentOf(alice, pred1, salt1);
      expect(c1).toBe(c2);
      expect(c1).toMatch(/^0x[0-9a-f]{64}$/);

      // Altering author changes commitment
      const cBob = commitmentOf(bob, pred1, salt1);
      expect(cBob).not.toBe(c1);

      // Altering text changes commitment
      const cAltText = commitmentOf(alice, "Bitcoin reaches ATH before December.", salt1);
      expect(cAltText).not.toBe(c1);

      // Altering salt changes commitment
      const salt2 = "0x000000000000000000000000000000000000000000000000000000000005a172" as const;
      const cAltSalt = commitmentOf(alice, pred1, salt2);
      expect(cAltSalt).not.toBe(c1);
    });
  });

  describe("textByteLength", () => {
    it("measures ASCII length correctly", () => {
      expect(textByteLength("hello")).toBe(5);
    });

    it("measures multibyte UTF-8 characters correctly", () => {
      expect(textByteLength("⚡")).toBe(3); // UTF-8 high voltage symbol
      expect(textByteLength("hello ⚡")).toBe(9);
    });
  });

  describe("exportRevealFile & importRevealFile", () => {
    const payload: RevealPayload = {
      id: "42",
      text: pred1,
      salt: salt1,
      author: alice,
      revealAfter: 1765000000,
      commitment: commitmentOf(alice, pred1, salt1),
    };

    it("exports and imports valid reveal file json", () => {
      const json = exportRevealFile(payload);
      const imported = importRevealFile(json, alice);

      expect(imported.id).toBe("42");
      expect(imported.text).toBe(pred1);
      expect(imported.salt).toBe(salt1);
      expect(imported.author.toLowerCase()).toBe(alice.toLowerCase());
      expect(imported.revealAfter).toBe(1765000000);
      expect(imported.commitment.toLowerCase()).toBe(payload.commitment.toLowerCase());
    });

    it("rejects invalid JSON", () => {
      expect(() => importRevealFile("not json", alice)).toThrow(
        "Invalid JSON format in reveal file."
      );
    });

    it("rejects missing text", () => {
      const bad = JSON.stringify({ ...payload, text: "" });
      expect(() => importRevealFile(bad, alice)).toThrow(
        "Reveal file is missing prediction text."
      );
    });

    it("rejects invalid salt", () => {
      const bad = JSON.stringify({ ...payload, salt: "0x123" });
      expect(() => importRevealFile(bad, alice)).toThrow(
        "Reveal file contains an invalid 32-byte salt."
      );
    });

    it("rejects mismatched expected author", () => {
      const json = exportRevealFile(payload);
      expect(() => importRevealFile(json, bob)).toThrow(
        "does not match your connected wallet"
      );
    });

    it("rejects tampered commitment hash", () => {
      const tampered = JSON.stringify({
        ...payload,
        commitment: "0x0000000000000000000000000000000000000000000000000000000000000001",
      });
      expect(() => importRevealFile(tampered, alice)).toThrow(
        "Commitment in reveal file does not match text and salt."
      );
    });
  });

  describe("statusOf & windowCloses", () => {
    const revealAfter = 1_000_000;
    const windowSeconds = Number(REVEAL_WINDOW); // 90 * 86400 = 7,776,000

    it("returns Revealed (2) if revealedAt is non-zero regardless of time", () => {
      const res = statusOf({ revealAfter, revealedAt: 1_000_500 }, 2_000_000);
      expect(res.status).toBe(2);
      expect(res.kind).toBe("revealed");
      expect(res.label).toBe("Revealed");
    });

    it("returns Sealed (0) before revealAfter", () => {
      const res = statusOf({ revealAfter, revealedAt: 0 }, revealAfter - 1);
      expect(res.status).toBe(0);
      expect(res.kind).toBe("sealed");
      expect(res.label).toBe("Sealed");
    });

    it("returns Revealable (1) during reveal window", () => {
      // Exactly at revealAfter
      expect(statusOf({ revealAfter, revealedAt: 0 }, revealAfter).status).toBe(1);

      // Midway through window
      expect(
        statusOf({ revealAfter, revealedAt: 0 }, revealAfter + 1000).status
      ).toBe(1);

      // Exactly at window close (revealAfter + 90 days)
      expect(
        statusOf({ revealAfter, revealedAt: 0 }, revealAfter + windowSeconds).status
      ).toBe(1);
    });

    it("returns Lapsed (3) past window close", () => {
      // 1 second past window close
      const res = statusOf(
        { revealAfter, revealedAt: 0 },
        revealAfter + windowSeconds + 1
      );
      expect(res.status).toBe(3);
      expect(res.kind).toBe("lapsed");
      expect(res.label).toBe("Lapsed");
    });

    it("computes window close date accurately", () => {
      const closes = windowCloses({ revealAfter });
      expect(closes.getTime()).toBe((revealAfter + windowSeconds) * 1000);
    });
  });

  describe("lapsedCount", () => {
    it("counts lapsed predictions in a list", () => {
      const revealAfter = 1_000_000;
      const windowSeconds = Number(REVEAL_WINDOW);
      const now = revealAfter + windowSeconds + 100;

      const list = [
        { revealAfter, revealedAt: 0 }, // Lapsed (3)
        { revealAfter: now + 1000, revealedAt: 0 }, // Sealed (0)
        { revealAfter, revealedAt: revealAfter + 50 }, // Revealed (2)
        { revealAfter: 500_000, revealedAt: 0 }, // Lapsed (3)
      ];

      expect(lapsedCount(list, now)).toBe(2);
    });
  });
});
