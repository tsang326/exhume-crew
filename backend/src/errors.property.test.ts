import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ApiError, ERROR_MESSAGES, redactPaths, toErrorResponse, type ErrorCode } from "./errors";

const codes = Object.keys(ERROR_MESSAGES) as ErrorCode[];
const tableMessages = new Set<string>(Object.values(ERROR_MESSAGES));

const segment = fc.stringMatching(/^[A-Za-z0-9_-]{2,12}$/);
const absPath = fc
  .tuple(fc.constantFrom("/Users", "/home", "/var", "/tmp", "/etc", "/mnt"), fc.array(segment, { minLength: 1, maxLength: 5 }))
  .map(([root, parts]) => `${root}/${parts.join("/")}`);

/** An error whose message, cause and stack all embed absolute paths. */
const pathError = fc
  .tuple(fc.array(absPath, { minLength: 1, maxLength: 3 }), fc.string({ maxLength: 20 }), fc.constantFrom("plain", "api", "string", "object"))
  .map(([paths, noise, kind]) => {
    const text = `${noise} failed reading ${paths.join(" then ")} (${noise})`;
    let thrown: unknown;
    if (kind === "plain") {
      const e = new Error(text);
      e.stack = `Error: ${text}\n    at fn (${paths[0]}:1:2)`;
      thrown = e;
    } else if (kind === "api") {
      const e = new ApiError(codes[noise.length % codes.length] as ErrorCode, 400 + (noise.length % 100));
      e.message = text;
      e.stack = `ApiError: ${text}\n    at fn (${paths[0]}:3:4)`;
      thrown = e;
    } else if (kind === "string") {
      thrown = text;
    } else {
      thrown = { message: text, stack: `at ${paths[0]}` };
    }
    return { thrown, paths };
  });

// Feature: crew-app, Property 18: Error responses contain no paths
describe("Feature: crew-app, Property 18: Error responses contain no paths", () => {
  it("responses hold no path, no stack and only a fixed-table message", () => {
    // **Validates: Requirements 7.6**
    const prop = fc.property(pathError, ({ thrown, paths }) => {
      const res = toErrorResponse(thrown);
      const json = JSON.stringify(res.body);
      const keys = Object.keys(res.body);
      const errKeys = Object.keys(res.body.error).sort();
      return (
        paths.every((p) => !json.includes(p)) &&
        !/\n\s*at\s|\.ts:\d|\.mjs:\d/.test(json) &&
        keys.length === 1 &&
        keys[0] === "error" &&
        errKeys.join(",") === "code,message" &&
        codes.includes(res.body.error.code) &&
        tableMessages.has(res.body.error.message) &&
        res.body.error.message === ERROR_MESSAGES[res.body.error.code] &&
        res.status >= 400 &&
        res.status <= 599
      );
    });
    fc.assert(prop, { numRuns: 200 });
  });

  it("redactPaths removes absolute paths from arbitrary text", () => {
    // **Validates: Requirements 7.6**
    const prop = fc.property(absPath, fc.string({ maxLength: 15 }), (p, noise) => {
      const out = redactPaths(`${noise} open ${p} failed`);
      return !out.includes(p) && out.includes("<path>");
    });
    fc.assert(prop, { numRuns: 200 });
  });

  it("maps a known ApiError to its code and status", () => {
    const res = toErrorResponse(new ApiError("DISK_NOT_FOUND", 404));
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(ERROR_MESSAGES.DISK_NOT_FOUND);
  });
});
