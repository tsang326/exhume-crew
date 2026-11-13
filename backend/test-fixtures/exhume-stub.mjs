// Test stub for the Exhume stdio client. Speaks the same line protocol as
// mcp/exhume-mcp.mjs (one JSON-RPC message per line) but is told what to do.
//
// Usage: node exhume-stub.mjs --root <dir>
// The client passes only `--root`, so behaviour is read from
// `<dir>/behavior.json`:
//   { "handshake": "ok" | "hang" | "exit" | "garbage",
//     "calls": ["answer" | "error" | "hang" | "exit" | "garbage" | "badshape", ...] }
// The n-th tools/call (counted across restarts, in `<dir>/state.json`) uses
// calls[n]; past the end of the list the last entry repeats, "answer" if empty.
// Every start appends its pid to `<dir>/pids.txt`.
//
// Hard timer: the stub exits by itself after 30 s so a hung stub never lingers.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HARD_LIMIT_MS = 30_000;
setTimeout(() => process.exit(3), HARD_LIMIT_MS).unref();

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex === -1 ? "" : process.argv[rootIndex + 1] ?? "";
if (root === "") process.exit(2);

appendFileSync(path.join(root, "pids.txt"), `${process.pid}\n`);

function behavior() {
  try {
    return JSON.parse(readFileSync(path.join(root, "behavior.json"), "utf8"));
  } catch {
    return {};
  }
}

function nextCallIndex() {
  const file = path.join(root, "state.json");
  let n = 0;
  if (existsSync(file)) {
    try {
      n = JSON.parse(readFileSync(file, "utf8")).n ?? 0;
    } catch {
      n = 0;
    }
  }
  writeFileSync(file, JSON.stringify({ n: n + 1 }));
  return n;
}

const OPEN_DISK = {
  untrusted: true,
  volume: { label: "STUB", geometrySource: "bpb" },
  totalEntries: 1,
  counts: { alive: 1, recovered: 0, partial: 0, lost: 0 },
  entries: [{ id: 0, path: "A.TXT", kind: "file", state: "alive", size: 5, date: null }],
  truncated: false,
  warnings: [],
  warningsOmitted: 0,
};

const READ_GRAVE = {
  untrusted: true,
  grave: { id: 0, path: "A.TXT", state: "alive" },
  format: "text",
  mime: "text/plain",
  extension: ".txt",
  text: "hello",
  totalChars: 5,
  truncated: false,
  warnings: [],
  warningsOmitted: 0,
};

const EXHUME = {
  untrusted: true,
  path: "exhumed/A.txt",
  bytes: 5,
  format: "text",
  mime: "text/plain",
  id: 0,
  state: "alive",
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolResult(id, isError, body) {
  send({
    jsonrpc: "2.0",
    id,
    result: { isError, content: [{ type: "text", text: JSON.stringify(body) }] },
  });
}

function handleCall(msg) {
  const list = Array.isArray(behavior().calls) ? behavior().calls : [];
  const index = nextCallIndex();
  const action = list.length === 0 ? "answer" : list[Math.min(index, list.length - 1)];
  const name = msg.params?.name;
  if (action === "hang") return;
  if (action === "exit") process.exit(1);
  if (action === "garbage") {
    process.stdout.write("this is not json\n");
    return;
  }
  if (action === "badshape") {
    toolResult(msg.id, false, { untrusted: true, unexpected: 1 });
    return;
  }
  if (action === "error") {
    toolResult(msg.id, true, { error: "GRAVE_NOT_READABLE", message: "Fixed stub message." });
    return;
  }
  if (name === "open_disk") toolResult(msg.id, false, OPEN_DISK);
  else if (name === "read_grave") toolResult(msg.id, false, READ_GRAVE);
  else if (name === "exhume") toolResult(msg.id, false, EXHUME);
  else toolResult(msg.id, true, { error: "UNKNOWN_TOOL", message: "Unknown tool." });
}

function handle(msg) {
  if (msg === null || typeof msg !== "object") return;
  if (msg.method === "initialize") {
    const mode = behavior().handshake ?? "ok";
    if (mode === "hang") return;
    if (mode === "exit") process.exit(1);
    if (mode === "garbage") {
      process.stdout.write("not json\n");
      return;
    }
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "exhume-stub", version: "0.0.0" },
      },
    });
    return;
  }
  if (msg.method === "tools/call") handleCall(msg);
  // notifications (no id) get no reply
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // ignore malformed input
    }
  }
});
process.stdin.on("end", () => process.exit(0));
