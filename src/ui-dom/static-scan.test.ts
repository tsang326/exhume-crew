/**
 * Static scans over the sources (no execution). Comments are stripped first so prose does not
 * trigger a match.
 * Validates: Requirements 13.3, 13.4, 15.1, 15.5, 15.6, 20.1, 20.5, 20.6
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "test-fixtures" || name === "dist" || name === "exhumed") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Removes // and block comments, keeping string, template and regex-free code intact. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          out += src[i] as string;
          i++;
        }
        out += src[i] ?? "";
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Source {
  rel: string;
  code: string;
}

function load(dirs: string[]): Source[] {
  return dirs
    .flatMap((d) => walk(join(ROOT, d)))
    .map((p) => ({ rel: relative(ROOT, p), code: stripComments(readFileSync(p, "utf8")) }));
}

function matches(sources: Source[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const s of sources) {
    s.code.split("\n").forEach((line, i) => {
      if (re.test(line)) hits.push(`${s.rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

const uiSources = load(["ui/src"]);
const allSources = load(["backend/src", "src/catalogue-mcp", "ui/src"]);

describe("static scans", () => {
  it("finds source files to scan", () => {
    expect(uiSources.length).toBeGreaterThan(5);
    expect(allSources.some((s) => s.rel.startsWith("backend/src"))).toBe(true);
    expect(allSources.some((s) => s.rel.startsWith("src/catalogue-mcp"))).toBe(true);
  });

  it("strips comments but keeps strings", () => {
    const out = stripComments('const a = "// x"; // c\n/* b */ const d = 1;');
    expect(out).toContain('"// x"');
    expect(out).not.toContain("// c");
    expect(out).not.toContain("/* b */");
  });

  it("ui/src has no raw HTML injection APIs", () => {
    expect(matches(uiSources, /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/)).toEqual([]);
  });

  it("backend, MCP and UI sources have no fetch(, eval, Function(, npx or latest", () => {
    expect(matches(allSources, /\bfetch\s*\(|\beval\b|\bFunction\s*\(|\bnpx\b|\blatest\b/)).toEqual([]);
  });

  it("backend, MCP and UI sources have no explicit any", () => {
    const re = /(:|\bas|<|\||&|,|=>)\s*any\b(?!\w)|\bany\s*(\[\]|>)|\bArray<any\b/;
    expect(matches(allSources, re)).toEqual([]);
  });

  it("only the allow-listed modules write files", () => {
    // Allow-list: the Store (store.ts), the active-library file (library.ts), the demo copy
    // (demo.ts) and the guarded write helper (paths.ts). The Exhume child process writes
    // `exhumed/` itself and is outside these sources.
    const allowed = new Set([
      "src/shared/store.ts",
      "src/shared/paths.ts",
      "backend/src/library.ts",
      "backend/src/demo.ts",
    ]);
    const sources = load(["backend/src", "src/catalogue-mcp", "src/shared", "ui/src"]).filter(
      (s) => !allowed.has(s.rel),
    );
    const writeApi =
      /(?<![.\w])(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|cp|cpSync|rename|renameSync|rm|link|truncate|truncateSync|mkdir|mkdirSync|symlink|symlinkSync|linkSync|unlink|unlinkSync|rmSync|rmdir|writeSync)\s*\(/;
    const hits = matches(sources, writeApi);
    expect(hits).toEqual([]);

    // Every open( must be read-only.
    const opens = matches(sources, /\b(open|openSync)\s*\(/).filter((h) => !/O_RDONLY|"r"/.test(h));
    expect(opens).toEqual([]);
  });
});
