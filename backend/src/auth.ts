import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Header names the Backend accepts for the Proxy_Signature (design V11, I-12). */
export const PROXY_HEADER_NAMES = ["x-kirocrew-proxy", "x-crew-proxy"] as const;

/** Allowed clock skew in seconds, in either direction. */
export const MAX_SKEW_SECONDS = 60;

const MAX_TS_DIGITS = 12;
const TS_PATTERN = /^[0-9]{1,12}$/;
const HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

export interface VerifyProxyInput {
  /** Raw header value `<ts>:<hex>`, or undefined when absent. */
  headerValue: string | undefined;
  method: string;
  /** Raw request target as received, including the query string. */
  target: string;
  /** Raw request body bytes (empty for no body). */
  body: Uint8Array;
  /** Per-app secret (env KIROCREW_PROXY_SECRET). */
  secret: string | undefined;
  /** Current time in Unix seconds. */
  now: number;
}

/** Returns true only when the signature is present, fresh and correct. Fails closed. */
export function verifyProxyRequest(input: VerifyProxyInput): boolean {
  const { headerValue, method, target, body, secret, now } = input;
  if (typeof secret !== "string" || secret.length === 0) return false;
  if (typeof headerValue !== "string") return false;
  if (!Number.isFinite(now)) return false;

  const parts = headerValue.split(":");
  if (parts.length !== 2) return false;
  const ts = parts[0];
  const hex = parts[1];
  if (ts === undefined || hex === undefined) return false;
  if (ts.length > MAX_TS_DIGITS || !TS_PATTERN.test(ts)) return false;
  if (!HEX_PATTERN.test(hex)) return false;

  const tsNumber = Number(ts);
  if (!Number.isSafeInteger(tsNumber)) return false;
  if (Math.abs(now - tsNumber) > MAX_SKEW_SECONDS) return false;

  const bodyHash = createHash("sha256").update(body).digest("hex");
  const message = `${ts}:${method.toUpperCase()}:${target}:${bodyHash}`;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(message).digest();
  const provided = Buffer.from(hex, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Reads the Proxy_Signature from either accepted header (names are lowercase in Node). */
export function readProxyHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  for (const name of PROXY_HEADER_NAMES) {
    const value = headers[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") return value[0];
  }
  return undefined;
}
