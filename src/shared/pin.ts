import { createHash } from "node:crypto";

export interface PinRecord {
  /** Lower-case hex SHA-256 of the pinned bundle (64 chars). */
  sha256: string;
  /** Full lower-case hex commit hash (40 chars). */
  commit: string;
}

export type PinParseResult =
  | { ok: true; record: PinRecord }
  | { ok: false; error: string };

export type PinCheckResult =
  | { ok: true; actual: string }
  | { ok: false; actual: string; error: string };

const SHA256_LINE = /^SHA-256:[ \t]*`?([^\s`]*)`?[ \t]*$/m;
const SHA256_VALUE = /^[0-9a-f]{64}$/;
const COMMIT_VALUE = /\bcommit\s+`?([0-9a-fA-F]{7,64})`?/;
const COMMIT_FULL = /^[0-9a-f]{40}$/;

/** Parse the text of mcp/PINNED.md. The record is valid only with both hashes well formed. */
export function parsePinRecord(text: string): PinParseResult {
  const shaMatch = SHA256_LINE.exec(text);
  if (!shaMatch) {
    return { ok: false, error: "Pin record has no 'SHA-256:' line." };
  }
  const sha256 = shaMatch[1] ?? "";
  if (!SHA256_VALUE.test(sha256)) {
    return { ok: false, error: "Pin record SHA-256 must be exactly 64 lower-case hex characters." };
  }
  const commitMatch = COMMIT_VALUE.exec(text);
  const commit = commitMatch?.[1] ?? "";
  if (!COMMIT_FULL.test(commit)) {
    return { ok: false, error: "Pin record has no commit hash of exactly 40 lower-case hex characters." };
  }
  return { ok: true, record: { sha256, commit } };
}

/** Compare the SHA-256 of the given bytes with the pin record. */
export function checkPinnedFile(bytes: Uint8Array, record: PinRecord): PinCheckResult {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== record.sha256) {
    return {
      ok: false,
      actual,
      error: `Pinned file hash mismatch: expected ${record.sha256}, actual ${actual}.`,
    };
  }
  return { ok: true, actual };
}
