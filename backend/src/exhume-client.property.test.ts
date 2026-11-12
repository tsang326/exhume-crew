import { describe, it } from "vitest";
import fc from "fast-check";
import { createLineReader, encodeMessage, type LineEvent } from "./exhume-client";

const RUNS = { numRuns: 200 };

const encoder = new TextEncoder();

/** JSON-RPC-like messages: objects with arbitrary JSON params, including unicode text. */
const message = fc.record({
  jsonrpc: fc.constant("2.0"),
  id: fc.integer({ min: 0, max: 1_000_000 }),
  method: fc.string({ maxLength: 20 }),
  params: fc.jsonValue(),
});

const messages = fc.array(message, { maxLength: 8 });
const cuts = fc.array(fc.nat(), { maxLength: 24 });

/** Splits bytes at the (sorted, clamped) cut points, producing chunks that may split UTF-8 sequences. */
function splitAt(bytes: Uint8Array, rawCuts: number[]): Uint8Array[] {
  const points = rawCuts.map((c) => c % (bytes.length + 1)).sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  let prev = 0;
  for (const p of points) {
    chunks.push(bytes.subarray(prev, p));
    prev = p;
  }
  chunks.push(bytes.subarray(prev));
  return chunks;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("Feature: crew-app, Property 6: JSON-RPC line framing round trip", () => {
  // **Validates: Requirements 2.5**
  it("encodes each message as exactly one LF-terminated line", () => {
    fc.assert(
      fc.property(message, (m) => {
        const line = encodeMessage(m);
        const body = line.slice(0, -1);
        return (
          line.endsWith("\n") &&
          !body.includes("\n") &&
          JSON.stringify(JSON.parse(body)) === JSON.stringify(m)
        );
      }),
      RUNS,
    );
  });

  // **Validates: Requirements 2.5**
  it("recovers the same messages in order for any chunk split of the concatenated stream", () => {
    fc.assert(
      fc.property(messages, cuts, (list, rawCuts) => {
        const stream = encoder.encode(list.map((m) => encodeMessage(m)).join(""));
        const reader = createLineReader();
        const events: LineEvent[] = [];
        for (const chunk of splitAt(stream, rawCuts)) events.push(...reader.push(chunk));
        events.push(...reader.end());
        if (events.length !== list.length) return false;
        for (let i = 0; i < list.length; i++) {
          const ev = events[i];
          if (ev === undefined || ev.kind !== "message") return false;
          if (JSON.stringify(ev.value) !== JSON.stringify(JSON.parse(JSON.stringify(list[i])))) {
            return false;
          }
        }
        return true;
      }),
      RUNS,
    );
  });

  // **Validates: Requirements 2.5**
  it("gives the same events whether the stream arrives whole or split", () => {
    fc.assert(
      fc.property(messages, cuts, (list, rawCuts) => {
        const stream = encoder.encode(list.map((m) => encodeMessage(m)).join(""));
        const whole = createLineReader();
        const a = [...whole.push(stream), ...whole.end()];
        const split = createLineReader();
        const b: LineEvent[] = [];
        for (const chunk of splitAt(stream, rawCuts)) b.push(...split.push(chunk));
        b.push(...split.end());
        return JSON.stringify(a) === JSON.stringify(b) && concat(splitAt(stream, rawCuts)).length === stream.length;
      }),
      RUNS,
    );
  });
});
