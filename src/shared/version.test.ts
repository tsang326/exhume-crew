import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkNodeVersion, MIN_NODE_MAJOR } from "./version";

const RUNS = 200;

const versionArb = fc
  .record({
    prefix: fc.constantFrom("", "v"),
    major: fc.integer({ min: 0, max: 999 }),
    minor: fc.integer({ min: 0, max: 999 }),
    patch: fc.integer({ min: 0, max: 999 }),
    parts: fc.constantFrom(1, 2, 3),
    suffix: fc.constantFrom("", "-nightly2025", "+build.5"),
  })
  .map((v) => ({
    major: v.major,
    text: `${v.prefix}${[v.major, v.minor, v.patch].slice(0, v.parts).join(".")}${v.suffix}`,
  }));

describe("Feature: crew-app, Property 34: Node version guard", () => {
  // **Validates: Requirements 20.7**
  it("allows start if and only if the major version is at least 22", () => {
    const property = fc.property(versionArb, (v) => {
      const result = checkNodeVersion(v.text);
      return result.ok === v.major >= MIN_NODE_MAJOR;
    });
    fc.assert(property, { numRuns: RUNS });
  });

  // **Validates: Requirements 20.7**
  it("names the required minimum version in every failure message", () => {
    const property = fc.property(versionArb, (v) => {
      const result = checkNodeVersion(v.text);
      return result.ok || result.message.includes(String(MIN_NODE_MAJOR));
    });
    fc.assert(property, { numRuns: RUNS });
  });

  // **Validates: Requirements 20.7**
  it("rejects strings that do not start with a version number", () => {
    const property = fc.property(
      fc.string({ maxLength: 40 }).filter((s) => !/^\s*v?\d/.test(s)),
      (s) => {
        const result = checkNodeVersion(s);
        return !result.ok && result.message.includes(String(MIN_NODE_MAJOR));
      },
    );
    fc.assert(property, { numRuns: RUNS });
  });

  it("handles the boundary examples", () => {
    expect(checkNodeVersion("22.0.0").ok).toBe(true);
    expect(checkNodeVersion("v21.9.9").ok).toBe(false);
  });
});
