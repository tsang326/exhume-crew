import { describe, it } from "vitest";
import fc from "fast-check";
import type { CatalogueData } from "../../src/shared/schema";
import { emptyCatalogue } from "../../src/shared/store";
import type { Store } from "../../src/shared/store";
import { ApiError } from "./errors";
import { createRoutes } from "./routes";
import type { RouteDeps } from "./routes";

// Feature: crew-app, Property 17: Unknown Disk_Id gives 404 without calling Exhume
// **Validates: Requirements 7.5**

const NUM_RUNS = 100;

const diskIdArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(""));

function makeStore(): Store {
  const data: CatalogueData = emptyCatalogue();
  return {
    read: () => ({ ok: true, value: data }),
    update: (mutate) => {
      mutate(data);
      return { ok: true, value: undefined };
    },
    readFiles: () => ({ ok: false, error: "missing" }) as never,
    writeFiles: () => ({ ok: true, value: undefined }),
  };
}

async function statusFor(routeIndex: number, id: string): Promise<{ status: number; calls: number }> {
  let calls = 0;
  const count = (): Promise<never> => {
    calls += 1;
    return Promise.reject(new Error("must not be called"));
  };
  const deps: RouteDeps = {
    store: makeStore(),
    scanner: {
      getStatus: () => ({ state: "idle" }) as never,
      triggerScan: () => ({ started: true, running: true }),
    },
    library: {
      getStatus: () => ({ path: "/lib", error: null }) as never,
      getRealPath: () => "/lib",
      setLibrary: () => Promise.reject(new Error("unused")),
    },
    exhume: { readGrave: count, exhume: count },
    copyDemo: () => Promise.reject(new Error("unused")),
    hashImage: () => {
      calls += 1;
      return Promise.resolve(id);
    },
    clock: { now: () => Date.UTC(2024, 0, 1) },
  };
  const routes = createRoutes(deps).filter((r) => r.pattern.includes(":id"));
  const route = routes[routeIndex];
  if (route === undefined) throw new Error("route missing");
  try {
    const res = await route.handler({ params: { id }, query: { entry: "1" }, body: new Uint8Array() });
    return { status: res.status, calls };
  } catch (err) {
    return { status: err instanceof ApiError ? err.status : -1, calls };
  }
}

describe("Property 17: Unknown Disk_Id gives 404 without calling Exhume", () => {
  it("every route taking a Disk_Id answers 404 and makes no Exhume call", async () => {
    const holds = fc.asyncProperty(diskIdArb, fc.integer({ min: 0, max: 2 }), async (id, idx) => {
      const out = await statusFor(idx, id);
      return out.status === 404 && out.calls === 0;
    });
    await fc.assert(holds, { numRuns: NUM_RUNS });
  });

  it("covers all three Disk_Id routes", () => {
    const deps = { store: makeStore() } as unknown as RouteDeps;
    const count = createRoutes(deps).filter((r) => r.pattern.includes(":id")).length;
    if (count !== 3) throw new Error(`expected 3 Disk_Id routes, found ${count}`);
  });
});
