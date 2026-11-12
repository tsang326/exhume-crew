import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Validates: Requirements 19.15, 20.4

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function readPackageJson(): PackageJson {
  const path = resolve(process.cwd(), "package.json");
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

describe("package.json", () => {
  const pkg = readPackageJson();

  it("declares no runtime dependencies", () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it("pins every devDependency to an exact version", () => {
    const offenders = Object.entries(pkg.devDependencies ?? {}).filter(
      ([, version]) => !EXACT_VERSION.test(version),
    );
    expect(offenders).toEqual([]);
  });

  it("rejects non-exact version specifiers (self-check)", () => {
    for (const bad of ["^1.0.0", "~1.0.0", "*", "latest", ">=1.0.0", "1.x", "1.0.0 - 2.0.0"]) {
      expect(EXACT_VERSION.test(bad)).toBe(false);
    }
    expect(EXACT_VERSION.test("1.2.3")).toBe(true);
  });
});
