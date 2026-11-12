import { describe, it } from "vitest";
import fc from "fast-check";
import { createHash, createHmac } from "node:crypto";
import { MAX_SKEW_SECONDS, readProxyHeader, verifyProxyRequest } from "./auth";

const RUNS = { numRuns: 200 };

const method = fc.constantFrom("GET", "PUT", "POST", "DELETE", "get", "Put");
const target = fc.oneof(
  fc.constantFrom("/api/disks", "/api/library?x=1", "/api/disks/abc/preview?entry=2"),
  fc.string({ maxLength: 40 }).map((s) => "/api/" + s),
);
const body = fc.uint8Array({ maxLength: 64 });
const secret = fc.string({ minLength: 1, maxLength: 40 });
const now = fc.integer({ min: 1_000_000, max: 9_999_999_999 });
const offset = fc.integer({ min: -MAX_SKEW_SECONDS, max: MAX_SKEW_SECONDS });

interface Req {
  method: string;
  target: string;
  body: Uint8Array;
  secret: string;
  now: number;
  ts: number;
}
const req: fc.Arbitrary<Req> = fc.record({
  method,
  target,
  body,
  secret,
  now,
  ts: fc.constant(0),
});

function sign(r: Pick<Req, "method" | "target" | "body" | "secret">, ts: string): string {
  const bodyHash = createHash("sha256").update(r.body).digest("hex");
  const msg = `${ts}:${r.method.toUpperCase()}:${r.target}:${bodyHash}`;
  return createHmac("sha256", Buffer.from(r.secret, "utf8")).update(msg).digest("hex");
}

function header(r: Req, ts: number): string {
  return `${ts}:${sign(r, String(ts))}`;
}

function verify(r: Req, headerValue: string | undefined, over: Partial<Req> = {}): boolean {
  const m = { ...r, ...over };
  return verifyProxyRequest({
    headerValue,
    method: m.method,
    target: m.target,
    body: m.body,
    secret: m.secret,
    now: m.now,
  });
}

describe("Feature: crew-app, Property 15: Proxy signature verification", () => {
  // **Validates: Requirements 7.2, 7.3, 19.5**
  it("accepts a correctly signed request inside the freshness window", () => {
    fc.assert(
      fc.property(req, offset, (r, off) => verify(r, header(r, r.now + off)) === true),
      RUNS,
    );
  });

  it("rejects a mutated method, target, body or secret", () => {
    fc.assert(
      fc.property(req, offset, fc.integer({ min: 0, max: 3 }), (r, off, which) => {
        const h = header(r, r.now + off);
        switch (which) {
          case 0:
            return !verify(r, h, { method: r.method.toUpperCase() === "GET" ? "PUT" : "GET" });
          case 1:
            return !verify(r, h, { target: r.target + "x" });
          case 2:
            return !verify(r, h, { body: Uint8Array.from([...r.body, 0]) });
          default:
            return !verify(r, h, { secret: r.secret + "x" });
        }
      }),
      RUNS,
    );
  });

  it("rejects a mutated timestamp (signature no longer matches)", () => {
    fc.assert(
      fc.property(req, offset, (r, off) => {
        const ts = r.now + off;
        const sig = sign(r, String(ts));
        return !verify(r, `${ts + 1}:${sig}`) && !verify(r, `0${ts}:${sig}`);
      }),
      RUNS,
    );
  });

  it("rejects a mutated signature: flipped, wrong length, non-hex, non-ASCII", () => {
    fc.assert(
      fc.property(
        req,
        offset,
        fc.integer({ min: 0, max: 63 }),
        fc.string({ maxLength: 80 }),
        (r, off, idx, junk) => {
          const ts = r.now + off;
          const sig = sign(r, String(ts));
          const flipped = sig.slice(0, idx) + (sig[idx] === "0" ? "1" : "0") + sig.slice(idx + 1);
          const candidates = [
            flipped,
            sig.slice(0, 63),
            sig + "0",
            "",
            "z".repeat(64),
            "é".repeat(64),
            junk,
          ].filter((c) => c !== sig);
          return candidates.every((c) => !verify(r, `${ts}:${c}`));
        },
      ),
      RUNS,
    );
  });

  it("rejects timestamps outside the window even when correctly signed", () => {
    fc.assert(
      fc.property(req, fc.integer({ min: MAX_SKEW_SECONDS + 1, max: 100_000 }), fc.boolean(), (r, d, past) => {
        const ts = past ? r.now - d : r.now + d;
        if (ts < 0) return true;
        return !verify(r, header(r, ts));
      }),
      RUNS,
    );
  });

  it("rejects a missing header, an empty or missing secret, and malformed headers", () => {
    fc.assert(
      fc.property(req, offset, fc.string({ maxLength: 100 }), (r, off, junk) => {
        const h = header(r, r.now + off);
        const validJunk = junk === h;
        return (
          !verify(r, undefined) &&
          !verify(r, h, { secret: "" }) &&
          !verifyProxyRequest({
            headerValue: h,
            method: r.method,
            target: r.target,
            body: r.body,
            secret: undefined,
            now: r.now,
          }) &&
          !verify(r, `${r.now}:${"a".repeat(64)}:extra`) &&
          !verify(r, `-${r.now}:${sign(r, String(r.now))}`) &&
          !verify(r, `1${"0".repeat(12)}:${sign(r, "1" + "0".repeat(12))}`) &&
          (validJunk || !verify(r, junk))
        );
      }),
      RUNS,
    );
  });

  it("reads the signature from either accepted header name", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.boolean(), (v, first) => {
        const name = first ? "x-kirocrew-proxy" : "x-crew-proxy";
        return readProxyHeader({ [name]: v }) === v && readProxyHeader({}) === undefined;
      }),
      RUNS,
    );
  });
});
