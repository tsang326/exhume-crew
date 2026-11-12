// Reproducibility check: a fresh build into a temp dir must be byte-identical
// to the working-tree outputs; when the outputs are tracked, `git diff --exit-code`
// must also be clean after rebuilding in place.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUTS = ["backend/server.mjs", "mcp/catalogue-mcp.mjs", "ui/dist/index.mjs"];
const TIMEOUT_MS = 120_000;

function run(cmd, args, cwd = ROOT) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS, killSignal: "SIGKILL" });
}
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

let failed = false;
const tmp = mkdtempSync(join(tmpdir(), "exhume-build-"));
try {
  const built = run(process.execPath, [join(ROOT, "scripts/build.mjs"), "--out-dir", tmp]);
  if (built.status !== 0) {
    process.stderr.write(`build failed: ${built.stderr || built.error || "timeout"}\n`);
    process.exit(1);
  }
  for (const rel of OUTPUTS) {
    const committed = join(ROOT, rel);
    if (!existsSync(committed)) {
      process.stderr.write(`MISSING: ${rel}\n`);
      failed = true;
    } else if (sha(committed) !== sha(join(tmp, rel))) {
      process.stderr.write(`DIFFERS: ${rel} (run npm run build)\n`);
      failed = true;
    }
  }
  // When tracked, also compare against the git index/HEAD.
  const tracked = OUTPUTS.filter((rel) => run("git", ["ls-files", "--error-unmatch", rel]).status === 0);
  if (tracked.length > 0) {
    const diff = run("git", ["diff", "--exit-code", "--", ...tracked]);
    if (diff.status !== 0) {
      process.stderr.write(`git diff reports changes in tracked outputs:\n${diff.stdout}\n`);
      failed = true;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (failed) process.exit(1);
process.stdout.write("build outputs are reproducible\n");
