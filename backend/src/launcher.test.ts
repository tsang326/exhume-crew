import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LAUNCHER_SRC = resolve(__dirname, "..", "..", "mcp", "launch.py");
const STDLIB_ALLOW = new Set([
  "glob",
  "json",
  "os",
  "re",
  "shutil",
  "subprocess",
  "sys",
]);
const NODE_LINE = "Node.js not found. Install Node.js 22 or newer.";
const OLD_NODE_LINE = "Node.js 22 or newer is required.";
const LIBRARY_LINE = "No library selected. Open Exhume Crew and choose a library folder.";
const MODE_LINE = "Unknown mode. Use: launch.py exhume | catalogue";

let appRoot = "";
let launcher = "";
let emptyBin = "";
let python = "python3";

// Resolve python3 to an absolute path so a stripped PATH cannot hide it.
function resolvePython(): string {
  const r = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  const out = (r.stdout ?? "").trim();
  return r.status === 0 && out.length > 0 ? out : "python3";
}

function run(args: string[], pathValue?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (pathValue !== undefined) env.PATH = pathValue;
  return spawnSync(python, [launcher, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGKILL",
    env,
  });
}

function stderrLines(stderr: string): string[] {
  return stderr.split("\n").filter((l) => l.length > 0);
}

describe("mcp/launch.py", () => {
  beforeAll(() => {
    python = resolvePython();
    appRoot = mkdtempSync(join(tmpdir(), "launcher-test-"));
    mkdirSync(join(appRoot, "mcp"));
    mkdirSync(join(appRoot, "data"));
    launcher = join(appRoot, "mcp", "launch.py");
    copyFileSync(LAUNCHER_SRC, launcher);
    emptyBin = join(appRoot, "empty-bin");
    mkdirSync(emptyBin);
  });

  afterAll(() => {
    if (appRoot) rmSync(appRoot, { recursive: true, force: true });
  });

  it("imports only allow-listed standard-library modules and never kiro_crew", () => {
    const lines = readFileSync(LAUNCHER_SRC, "utf8").split("\n");
    const capped = lines.slice(0, 2000);
    let seen = 0;
    for (let i = 0; i < capped.length; i += 1) {
      const m = /^\s*(?:import|from)\s+([A-Za-z_][\w.]*)/.exec(capped[i] ?? "");
      if (!m) continue;
      seen += 1;
      const top = (m[1] ?? "").split(".")[0] ?? "";
      expect(top).not.toBe("kiro_crew");
      expect(STDLIB_ALLOW.has(top)).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
    expect(readFileSync(LAUNCHER_SRC, "utf8")).not.toMatch(/kiro_crew\s*(?:import|\.)|import\s+kiro_crew/);
  });

  it("unknown mode gives one stderr line and a non-zero exit", () => {
    const r = run(["bogus"]);
    expect(r.status).not.toBe(0);
    expect(stderrLines(r.stderr)).toEqual([MODE_LINE]);
  });

  it("missing library file gives one stderr line and a non-zero exit", () => {
    const r = run(["exhume"]);
    expect(r.status).not.toBe(0);
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    // Depending on node discovery on this machine, an earlier check may fire.
    expect([LIBRARY_LINE, NODE_LINE, OLD_NODE_LINE]).toContain(lines[0]);
  });

  it("stripped PATH gives one stderr line and a non-zero exit", () => {
    const r = run(["exhume"], emptyBin);
    expect(r.status).not.toBe(0);
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect([NODE_LINE, OLD_NODE_LINE, LIBRARY_LINE]).toContain(lines[0]);
  });
});
