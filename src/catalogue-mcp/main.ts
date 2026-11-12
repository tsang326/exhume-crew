/**
 * Entry point of the catalogue MCP server: `node catalogue-mcp.mjs --data-dir <dir>`.
 * Reads one JSON-RPC message per line on stdin, writes one per line on stdout.
 */
import { resolve } from "node:path";

import { createStore } from "../shared/store";
import { checkNodeVersion } from "../shared/version";
import { createJsonRpcServer, createLineReader, tooLargeLine, type LineEvent } from "./jsonrpc";
import { TOOL_DEFS, callTool } from "./tools";

const START_FAILURE = "exhume-catalogue: cannot start (expected: --data-dir <directory>)";

function parseDataDir(argv: readonly string[]): string | null {
  if (argv.length !== 2 || argv[0] !== "--data-dir") return null;
  const dir = argv[1];
  return dir === undefined || dir === "" ? null : resolve(dir);
}

async function main(): Promise<void> {
  const version = checkNodeVersion(process.versions.node);
  if (!version.ok) {
    process.stderr.write(`exhume-catalogue: ${version.message}\n`);
    process.exit(1);
  }
  const dataDir = parseDataDir(process.argv.slice(2));
  if (dataDir === null) {
    process.stderr.write(`${START_FAILURE}\n`);
    process.exit(1);
  }

  const store = createStore(dataDir);
  const server = createJsonRpcServer({
    tools: TOOL_DEFS,
    callTool: (name, args) => callTool(store, name, args),
  });

  let outputBroken = false;
  process.stdout.on("error", () => {
    outputBroken = true;
  });

  const emit = async (ev: LineEvent): Promise<void> => {
    const lines = ev.kind === "overflow" ? [tooLargeLine()] : server.handleLine(ev.bytes);
    for (const line of lines) {
      if (outputBroken) return;
      try {
        if (!process.stdout.write(`${line}\n`)) {
          await new Promise<void>((done) => process.stdout.once("drain", () => done()));
        }
      } catch {
        outputBroken = true;
        return;
      }
    }
  };

  const reader = createLineReader();
  try {
    for await (const chunk of process.stdin) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Uint8Array);
      for (const ev of reader.push(bytes)) await emit(ev);
      if (outputBroken) return;
    }
    for (const ev of reader.end()) await emit(ev);
  } catch {
    // stdin closed or broke; nothing more to serve.
  }
}

void main();
