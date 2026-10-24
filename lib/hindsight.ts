import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { REVEAL_WINDOW } from "./limits";

export interface PredictionView {
  id: bigint;
  author: Address;
  commitment: Hex;
  committedAt: bigint | number;
  committedBlock: number;
  revealAfter: bigint | number;
  revealedAt: bigint | number;
  revealedBlock: number;
  right: number;
  wrong: number;
  status: number; // 0 Sealed, 1 Revealable, 2 Revealed, 3 Lapsed
}

export interface RevealPayload {
  id?: string;
  text: string;
  salt: Hex;
  author: Address;
  revealAfter: number;
  commitment: Hex;
}

/**
 * Generates 32 cryptographically secure random bytes as a 0x-prefixed hex string.
 */
export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/**
 * Computes commitment hash matching Hindsight.sol:
 * keccak256(abi.encode(author, text, salt))
 */
export function commitmentOf(author: Address, text: string, salt: Hex): Hex {
  const checksummed = getAddress(author);
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "string" }, { type: "bytes32" }],
    [checksummed, text, salt]
  );
  return keccak256(encoded);
}

/**
 * Computes UTF-8 byte length of a string.
 */
export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Formats a reveal payload into a downloadable JSON string.
 */
export function exportRevealFile(data: RevealPayload): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Parses and validates an imported reveal file JSON.
 * Re-computes commitment to guarantee integrity.
 */
export function importRevealFile(
  json: string,
  expectedAuthor?: Address
): RevealPayload {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON format in reveal file.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Reveal file must be a JSON object.");
  }

  if (typeof parsed.text !== "string" || parsed.text.length === 0) {
    throw new Error("Reveal file is missing prediction text.");
  }

  if (!parsed.salt || !isHex(parsed.salt) || parsed.salt.length !== 66) {
    throw new Error("Reveal file contains an invalid 32-byte salt.");
  }

  if (!parsed.author || !isAddress(parsed.author)) {
    throw new Error("Reveal file contains an invalid author address.");
  }

  const author = getAddress(parsed.author);
  if (expectedAuthor && author.toLowerCase() !== expectedAuthor.toLowerCase()) {
    throw new Error(
      `Reveal file author (${author}) does not match your connected wallet (${expectedAuthor}).`
    );
  }

  const expectedCommitment = commitmentOf(author, parsed.text, parsed.salt);
  if (parsed.commitment && parsed.commitment.toLowerCase() !== expectedCommitment.toLowerCase()) {
    throw new Error("Commitment in reveal file does not match text and salt.");
  }

  return {
    id: parsed.id ? String(parsed.id) : undefined,
    text: parsed.text,
    salt: parsed.salt as Hex,
    author,
    revealAfter: Number(parsed.revealAfter || 0),
    commitment: expectedCommitment,
  };
}

const STORAGE_KEY = "hindsight_reveals_v1";

export interface RevealItem extends RevealPayload {
  savedAt: number;
}

/**
 * Persists a reveal entry into browser localStorage.
 */
export function saveReveal(item: RevealPayload): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const existing = listSavedReveals();
    const updated = existing.filter(
      (x) => x.commitment.toLowerCase() !== item.commitment.toLowerCase()
    );
    updated.push({
      ...item,
      savedAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage quota or unavailable
  }
}

/**
 * Retrieves a saved reveal entry by its commitment hash.
 */
export function getSavedReveal(commitment: Hex): RevealItem | undefined {
  try {
    const list = listSavedReveals();
    const lower = commitment.toLowerCase();
    return list.find((x) => x.commitment.toLowerCase() === lower);
  } catch {
    return undefined;
  }
}

/**
 * Links a prediction ID to an existing stored reveal entry.
 */
export function linkSavedRevealId(commitment: Hex, id: bigint | string): void {
  try {
    const list = listSavedReveals();
    const lower = commitment.toLowerCase();
    const target = list.find((x) => x.commitment.toLowerCase() === lower);
    if (target) {
      target.id = String(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // Storage error
  }
}

/**
 * Lists all stored reveal items in localStorage.
 */
export function listSavedReveals(): RevealItem[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Evaluates the status of a prediction at given timestamp (or current time).
 * 0 Sealed, 1 Revealable, 2 Revealed, 3 Lapsed
 */
export function statusOf(
  prediction: {
    revealAfter: bigint | number;
    revealedAt: bigint | number;
  },
  nowSec?: number
): { status: number; label: string; kind: "sealed" | "revealable" | "revealed" | "lapsed" } {
  const revAt = Number(prediction.revealedAt);
  if (revAt !== 0) {
    return { status: 2, label: "Revealed", kind: "revealed" };
  }

  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const after = Number(prediction.revealAfter);
  const windowClose = after + Number(REVEAL_WINDOW);

  if (now < after) {
    return { status: 0, label: "Sealed", kind: "sealed" };
  }

  if (now <= windowClose) {
    return { status: 1, label: "Revealable", kind: "revealable" };
  }

  return { status: 3, label: "Lapsed", kind: "lapsed" };
}

/**
 * Counts how many predictions in a list have lapsed.
 */
export function lapsedCount(
  predictions: Array<{
    revealAfter: bigint | number;
    revealedAt: bigint | number;
  }>,
  nowSec?: number
): number {
  return predictions.filter((p) => statusOf(p, nowSec).status === 3).length;
}

/**
 * Returns Date at which the 90-day reveal window closes.
 */
export function windowCloses(prediction: { revealAfter: bigint | number }): Date {
  const after = Number(prediction.revealAfter);
  return new Date((after + Number(REVEAL_WINDOW)) * 1000);
}
