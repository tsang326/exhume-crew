/**
 * Hand-written JSON-RPC 2.0 over stdio for the catalogue MCP server.
 *
 * Same framing as the pinned Exhume server: one JSON message per line, a 1 MiB
 * line cap, the same four protocol versions, methods `initialize`, `ping`,
 * `tools/list` and `tools/call`, notifications ignored. No MCP SDK
 * (Requirement 9.1). Error messages are fixed strings and never echo input.
 */

export const MAX_LINE_BYTES = 1_048_576;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const SUPPORTED_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
export const DEFAULT_VERSION = "2025-06-18";
export const SERVER_NAME = "exhume-catalogue";
export const SERVER_VERSION = "0.1.0";

const PARSE_ERROR_CODE = -32700;
const INVALID_REQUEST_CODE = -32600;
const METHOD_NOT_FOUND_CODE = -32601;
const INVALID_PARAMS_CODE = -32602;
const INTERNAL_ERROR_CODE = -32603;

const PARSE_ERROR = "Parse error";
const INVALID_REQUEST = "Invalid Request";
const METHOD_NOT_FOUND = "Method not found";
const INVALID_PARAMS = "Invalid params";
const INTERNAL_ERROR = "Internal error";
const REQUEST_TOO_LARGE = "Request too large";

const BYTE_LF = 0x0a;
const BYTE_CR = 0x0d;

export type JsonObject = { [key: string]: unknown };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  annotations: JsonObject;
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

/** What the transport needs from the tool layer. */
export interface ToolHost {
  tools: readonly ToolDefinition[];
  callTool(name: string, args: JsonObject): ToolCallResult;
}

export function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function getOwn(obj: JsonObject, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  return descriptor === undefined ? undefined : (descriptor.value as unknown);
}

type Id = string | number;

function isValidId(v: unknown): v is Id {
  return typeof v === "string" || (typeof v === "number" && Number.isSafeInteger(v));
}

type Envelope =
  | { kind: "invalid" }
  | { kind: "notification" }
  | { kind: "request"; id: Id; method: string; params: unknown };

function classify(value: unknown): Envelope {
  if (!isPlainObject(value)) return { kind: "invalid" };
  if (getOwn(value, "jsonrpc") !== "2.0") return { kind: "invalid" };
  const method = getOwn(value, "method");
  if (typeof method !== "string") return { kind: "invalid" };
  if (Object.getOwnPropertyDescriptor(value, "id") === undefined) return { kind: "notification" };
  const id = getOwn(value, "id");
  if (!isValidId(id)) return { kind: "invalid" };
  return { kind: "request", id, method, params: getOwn(value, "params") };
}

function resultLine(id: Id | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function errorLine(id: Id | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

export function tooLargeLine(): string {
  return errorLine(null, INVALID_REQUEST_CODE, REQUEST_TOO_LARGE);
}

function negotiateVersion(params: JsonObject): string {
  const requested = getOwn(params, "protocolVersion");
  return SUPPORTED_VERSIONS.find((v) => v === requested) ?? DEFAULT_VERSION;
}

function paramsOk(params: unknown): boolean {
  return params === undefined || isPlainObject(params);
}

function handleCall(host: ToolHost, id: Id, params: unknown): string {
  if (!isPlainObject(params)) return errorLine(id, INVALID_PARAMS_CODE, INVALID_PARAMS);
  const name = getOwn(params, "name");
  if (typeof name !== "string") return errorLine(id, INVALID_PARAMS_CODE, INVALID_PARAMS);
  const rawArgs = getOwn(params, "arguments");
  if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
    return errorLine(id, INVALID_PARAMS_CODE, INVALID_PARAMS);
  }
  return resultLine(id, host.callTool(name, rawArgs === undefined ? {} : rawArgs));
}

function dispatch(host: ToolHost, id: Id, method: string, params: unknown): string {
  switch (method) {
    case "initialize":
      if (!isPlainObject(params)) return errorLine(id, INVALID_PARAMS_CODE, INVALID_PARAMS);
      return resultLine(id, {
        protocolVersion: negotiateVersion(params),
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    case "ping":
      if (!paramsOk(params)) return errorLine(id, INVALID_PARAMS_CODE, INVALID_PARAMS);
      return resultLine(id, {});
    case "tools/list":
      if (!paramsOk(params)) return errorLine(id, INVALID_PARAMS_CODE, INVALID_PARAMS);
      return resultLine(id, { tools: host.tools });
    case "tools/call":
      return handleCall(host, id, params);
    default:
      return errorLine(id, METHOD_NOT_FOUND_CODE, METHOD_NOT_FOUND);
  }
}

function isBlank(text: string): boolean {
  for (const ch of text) {
    if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n") return false;
  }
  return true;
}

export interface JsonRpcServer {
  /** Handles one line (without the newline) and returns the response lines, if any. */
  handleLine(line: Uint8Array | string): string[];
}

export function createJsonRpcServer(host: ToolHost): JsonRpcServer {
  function handleLine(line: Uint8Array | string): string[] {
    let id: Id | null = null;
    try {
      let text: string;
      if (typeof line === "string") {
        text = line;
      } else {
        try {
          text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(line);
        } catch {
          return [errorLine(null, PARSE_ERROR_CODE, PARSE_ERROR)];
        }
      }
      if (isBlank(text)) return [];
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return [errorLine(null, PARSE_ERROR_CODE, PARSE_ERROR)];
      }
      const env = classify(value);
      if (env.kind === "invalid") return [errorLine(null, INVALID_REQUEST_CODE, INVALID_REQUEST)];
      if (env.kind === "notification") return [];
      id = env.id;
      const response = dispatch(host, env.id, env.method, env.params);
      if (Buffer.byteLength(response, "utf8") > MAX_RESPONSE_BYTES) {
        return [errorLine(env.id, INTERNAL_ERROR_CODE, INTERNAL_ERROR)];
      }
      return [response];
    } catch {
      return [errorLine(id, INTERNAL_ERROR_CODE, INTERNAL_ERROR)];
    }
  }
  return { handleLine };
}

// ------------------------------------------------------------- line reader

export type LineEvent = { kind: "line"; bytes: Uint8Array } | { kind: "overflow" };

export interface LineReader {
  push(chunk: Uint8Array): LineEvent[];
  end(): LineEvent[];
}

/**
 * Splits a byte stream into lines. A line longer than `maxLineBytes` yields one
 * `overflow` event and the rest of that line is discarded. A trailing CR is dropped.
 */
export function createLineReader(maxLineBytes: number = MAX_LINE_BYTES): LineReader {
  let parts: Uint8Array[] = [];
  let held = 0;
  let discarding = false;

  const takeLine = (): LineEvent => {
    const joined = Buffer.concat(parts, held);
    parts = [];
    held = 0;
    const end =
      joined.length > 0 && joined[joined.length - 1] === BYTE_CR ? joined.length - 1 : joined.length;
    return { kind: "line", bytes: joined.subarray(0, end) };
  };

  const push = (chunk: Uint8Array): LineEvent[] => {
    const events: LineEvent[] = [];
    let pos = 0;
    // Each pass consumes one newline-delimited segment, so this ends after at most
    // chunk.length + 1 passes.
    for (;;) {
      const idx = chunk.indexOf(BYTE_LF, pos);
      const stop = idx === -1 ? chunk.length : idx;
      const segment = chunk.subarray(pos, stop);
      if (!discarding) {
        if (held + segment.length > maxLineBytes) {
          discarding = true;
          parts = [];
          held = 0;
          events.push({ kind: "overflow" });
        } else if (segment.length > 0) {
          parts.push(segment.slice());
          held += segment.length;
        }
      }
      if (idx === -1) break;
      if (discarding) discarding = false;
      else events.push(takeLine());
      pos = idx + 1;
    }
    return events;
  };

  const end = (): LineEvent[] => {
    if (discarding) {
      discarding = false;
      parts = [];
      held = 0;
      return [];
    }
    return held > 0 ? [takeLine()] : [];
  };

  return { push, end };
}
