// Deterministic esbuild build: three bundles, no timestamps, fixed target.
// Usage: node scripts/build.mjs [--out-dir <dir>]  (default: write into the repo)
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_NODE_MAJOR = 22;

const outIdx = process.argv.indexOf("--out-dir");
const OUT_ROOT = outIdx >= 0 && process.argv[outIdx + 1] ? resolve(process.argv[outIdx + 1]) : ROOT;

const GUARD_BANNER =
  `if (Number.parseInt(process.versions.node.split(".")[0], 10) < ${MIN_NODE_MAJOR}) {` +
  ` process.stderr.write("exhume-crew: Node ${MIN_NODE_MAJOR} or newer is required (found " + process.versions.node + ")\\n");` +
  ` process.exit(1); }`;

const NODE_BANNER = { js: GUARD_BANNER };

const common = {
  absWorkingDir: ROOT,
  bundle: true,
  format: "esm",
  legalComments: "none",
  logLevel: "warning",
  sourcemap: false,
  metafile: false,
  charset: "utf8",
};

const NODE_TARGETS = {
  ...common,
  platform: "node",
  target: "node22",
  // Bundled CJS-free ESM code may still need require for node built-ins.
  banner: NODE_BANNER,
};

export const OUTPUTS = ["backend/server.mjs", "mcp/catalogue-mcp.mjs", "ui/dist/index.mjs"];

export async function runBuild(outRoot = OUT_ROOT) {
  for (const rel of OUTPUTS) mkdirSync(dirname(join(outRoot, rel)), { recursive: true });
  await build({
    ...NODE_TARGETS,
    entryPoints: ["backend/src/main.ts"],
    outfile: join(outRoot, "backend/server.mjs"),
  });
  await build({
    ...NODE_TARGETS,
    entryPoints: ["src/catalogue-mcp/main.ts"],
    outfile: join(outRoot, "mcp/catalogue-mcp.mjs"),
  });
  await build({
    ...common,
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    entryPoints: ["ui/src/index.tsx"],
    outfile: join(outRoot, "ui/dist/index.mjs"),
    external: ["react", "react-dom", "react/jsx-runtime", "@kirocrew/app-sdk", "lucide-react"],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBuild().catch((err) => {
    process.stderr.write(`build failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
