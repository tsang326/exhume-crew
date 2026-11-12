import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import fc from "fast-check";
import { isCatalogueData } from "./schema";
import { createStore } from "./store";

/** The same decode the Store applies: UTF-8 text, then JSON, then the schema guard. */
function isValidCatalogueBytes(bytes: Uint8Array): boolean {
  try {
    return isCatalogueData(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch {
    return false;
  }
}

const randomBytes = fc.uint8Array({ minLength: 0, maxLength: 200 });

// Plausible near misses: truncated, wrong version, wrong shapes, wrong types.
const nearMisses = fc.constantFrom(
  "",
  "{",
  "null",
  "[]",
  "42",
  '"text"',
  "{}",
  '{"schemaVersion":1,',
  '{"schemaVersion":2,"paths":{},"cards":{},"annotations":{},"exhumed":{}}',
  '{"schemaVersion":1,"paths":[],"cards":{},"annotations":{},"exhumed":{}}',
  '{"schemaVersion":1,"paths":{},"cards":{"x":1},"annotations":{},"exhumed":{}}',
).map((s) => new Uint8Array(Buffer.from(s, "utf8")));

const invalidCatalogueBytes = fc
  .oneof(randomBytes, nearMisses)
  .filter((b) => !isValidCatalogueBytes(b));

describe("Feature: crew-app, Property 4: A corrupt catalogue is preserved and the Scanner can rebuild", () => {
  it("names the file, preserves the bytes, then reads empty and accepts a write", () => {
    fc.assert(
      fc.property(invalidCatalogueBytes, (bytes) => {
        const dataDir = mkdtempSync(join(tmpdir(), "crew-corrupt-"));
        try {
          const storeDir = join(dataDir, "store");
          mkdirSync(storeDir, { recursive: true });
          const target = join(storeDir, "catalogue.json");
          writeFileSync(target, bytes);
          const store = createStore(dataDir);

          const first = store.read();
          if (first.ok) return false;
          const err = first.error;
          if (err.code !== "STORE_CORRUPT") return false;
          if (err.file !== "catalogue.json") return false;
          if (err.preservedAs === "catalogue.json") return false;
          if (err.preservedAs.includes("/") || err.preservedAs.includes("\\")) return false;

          const preservedPath = join(storeDir, err.preservedAs);
          if (!existsSync(preservedPath)) return false;
          if (!Buffer.from(bytes).equals(readFileSync(preservedPath))) return false;
          if (existsSync(target)) return false;
          if (!readdirSync(storeDir).includes(err.preservedAs)) return false;

          const second = store.read();
          if (!second.ok) return false;
          if (Object.keys(second.value.cards).length !== 0) return false;
          if (Object.keys(second.value.paths).length !== 0) return false;

          const written = store.update((d) => {
            d.paths["/rebuilt"] = { diskId: "a".repeat(64), firstSeen: "2024-01-01T00:00:00Z" };
          });
          if (!written.ok) return false;
          const third = store.read();
          if (!third.ok) return false;
          if (third.value.paths["/rebuilt"] === undefined) return false;

          // The preserved bytes are untouched by the later write.
          return Buffer.from(bytes).equals(readFileSync(preservedPath));
        } finally {
          rmSync(dataDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
