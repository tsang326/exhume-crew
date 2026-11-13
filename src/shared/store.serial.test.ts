import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import fc from "fast-check";
import { createStore, type Store } from "./store";
import type { CatalogueData, PathRecord } from "./schema";

const MAX_INSTANCES = 4;
const MAX_UPDATES = 12;

type Op =
  | { kind: "set"; inst: number; key: string; diskId: string; stamp: string }
  | { kind: "delete"; inst: number; key: string }
  | { kind: "throw"; inst: number }
  | { kind: "nested"; inst: number; other: number; key: string; diskId: string };

const hex64 = fc
  .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 64, maxLength: 64 })
  .map((a) => a.join(""));
// Few keys so sets, overwrites and deletes collide often.
const key = fc.constantFrom("a.img", "b.img", "c.img", "d/e.img");
const inst = fc.integer({ min: 0, max: MAX_INSTANCES - 1 });
const stamp = fc.constantFrom("2024-01-01", "2024-06-30T12:00:00Z", "x");

const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("set" as const), inst, key, diskId: hex64, stamp }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("delete" as const), inst, key }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("throw" as const), inst }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("nested" as const), inst, other: inst, key, diskId: hex64 }),
  },
);

const ops = fc.array(op, { minLength: 1, maxLength: MAX_UPDATES });

type Model = Record<string, PathRecord>;

function applyToModel(model: Model, o: Op): void {
  if (o.kind === "set") model[o.key] = { diskId: o.diskId, firstSeen: o.stamp };
  else if (o.kind === "delete") delete model[o.key];
}

function runCase(list: Op[]): boolean {
  const dir = mkdtempSync(join(tmpdir(), "store-serial-"));
  try {
    // Short lock waits keep the nested-update case fast; the logic is unchanged.
    const stores: Store[] = Array.from({ length: MAX_INSTANCES }, () =>
      createStore(dir, { retryMs: 2, lockTimeoutMs: 10 }),
    );
    const model: Model = {};

    for (const o of list) {
      const store = stores[o.inst] as Store;
      if (o.kind === "set") {
        const r = store.update((d: CatalogueData) => {
          d.paths[o.key] = { diskId: o.diskId, firstSeen: o.stamp };
        });
        if (!r.ok) return false;
        applyToModel(model, o);
      } else if (o.kind === "delete") {
        const r = store.update((d: CatalogueData) => {
          delete d.paths[o.key];
        });
        if (!r.ok) return false;
        applyToModel(model, o);
      } else if (o.kind === "throw") {
        let threw = false;
        try {
          store.update((d: CatalogueData) => {
            d.paths["zzz-thrown"] = { diskId: "0".repeat(64), firstSeen: "t" };
            throw new Error("boom");
          });
        } catch {
          threw = true;
        }
        // A throwing update is not a success: it must rethrow and leave no trace.
        if (!threw) return false;
      } else {
        // Another instance updating from inside a held update cannot get the
        // lock: it reports STORE_BUSY and its write is not reflected.
        const other = stores[o.other] as Store;
        let nestedBusy = false;
        const r = store.update((d: CatalogueData) => {
          const inner = other.update((x: CatalogueData) => {
            x.paths[o.key] = { diskId: o.diskId, firstSeen: "nested" };
          });
          nestedBusy = !inner.ok && inner.error.code === "STORE_BUSY";
          d.paths["outer-" + o.key] = { diskId: o.diskId, firstSeen: "outer" };
        });
        if (!r.ok || !nestedBusy) return false;
        model["outer-" + o.key] = { diskId: o.diskId, firstSeen: "outer" };
      }

      // Every instance sees the contents so far after each completed update.
      const seen = (stores[(o.inst + 1) % MAX_INSTANCES] as Store).read();
      if (!seen.ok || JSON.stringify(sorted(seen.value.paths)) !== JSON.stringify(sorted(model))) {
        return false;
      }
    }

    const final = (stores[0] as Store).read();
    return final.ok && JSON.stringify(sorted(final.value.paths)) === JSON.stringify(sorted(model));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sorted(m: Record<string, PathRecord>): [string, PathRecord][] {
  return Object.keys(m)
    .sort()
    .map((k) => [k, m[k] as PathRecord]);
}

describe("Feature: crew-app, Property 3: Serialised updates keep every completed write", () => {
  it("final contents equal the completed updates applied in completion order across Store instances", () => {
    // **Validates: Requirements 6.4**
    fc.assert(
      fc.property(ops, (list) => runCase(list)),
      { numRuns: 100 },
    );
  }, 120_000);
});
