/**
 * Long-lived stdio JSON-RPC client for the pinned Exhume MCP server.
 *
 * All disk parsing happens in `mcp/exhume-mcp.mjs`. This module only speaks
 * the line protocol, validates the shapes that come back and maps failures to
 * fixed error codes. There is no fallback parser: if the child cannot be
 * used, the call fails with `EXHUME_UNAVAILABLE` (Requirement 2.8).
 *
 * Requirements 2.5 (framing), 2.6 (no parsing here), 2.7 (spawn rules),
 * 2.8 (unavailable / timeout, no fallback).
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { ERROR_MESSAGES } from "./errors.js";

// ------------------------------------------------------------- constants

/** Maximum bytes in one protocol line (without the newline). */
export const MAX_LINE_BYTES = 1_048_576;

export const PROTOCOL_VERSION = "2025-06-18";

export const TIMEOUTS_MS = {
  handshake: 10_000,
  open_disk: 30_000,
  read_grave: 10_000,
  exhume: 30_000,
} as const;

export type ToolName = "open_disk" | "read_grave" | "exhume";
export type Timeouts = Readonly<Record<keyof typeof TIMEOUTS_MS, number>>;

const BYTE_LF = 0x0a;
const BYTE_CR = 0x0d;

// ----------------------------------------------------------------- types

export type GraveState = "alive" | "recovered" | "partial" | "lost";

export interface ExhumeWarning {
  code: string;
  message: string;
  path?: string;
}

export interface OpenDiskEntry {
  id: number;
  path: string;
  kind: "file" | "directory";
  state: GraveState;
  size: number;
  date: string | null;
  reason?: string;
}

export interface OpenDiskReport {
  untrusted: true;
  volume: { label: string; geometrySource: "bpb" | "fallback" | "none" };
  totalEntries: number;
  counts: Record<GraveState, number>;
  entries: OpenDiskEntry[];
  truncated: boolean;
  warnings: ExhumeWarning[];
  warningsOmitted: number;
}

export interface GraveRef {
  id: number;
  path: string;
  state: GraveState;
  reason?: string;
}

export interface ReadGraveText {
  grave: GraveRef;
  format: "markdown" | "csv" | "text";
  mime: string;
  extension: string;
  text: string;
  totalChars: number;
  truncated: boolean;
  warnings: ExhumeWarning[];
  warningsOmitted: number;
}

export interface ReadGravePng {
  grave: GraveRef;
  format: "png";
  mime: string;
  width: number;
  height: number;
  bytes: number;
  warnings: ExhumeWarning[];
  warningsOmitted: number;
}

export type ReadGraveResult = ReadGraveText | ReadGravePng;

export interface ExhumeResult {
  path: string;
  bytes: number;
  format: string;
  mime: string;
  id: number;
  state: GraveState;
  reason?: string;
}

export interface ExhumeClient {
  openDisk(image: string): Promise<OpenDiskReport>;
  readGrave(image: string, path: string, id: number): Promise<ReadGraveResult>;
  exhume(image: string, path: string, id: number): Promise<ExhumeResult>;
  restart(libraryRoot: string): Promise<void>;
  close(): void;
}

export type ExhumeClientErrorCode = "EXHUME_UNAVAILABLE" | "EXHUME_TIMEOUT";

/** The child is missing, died, misbehaved or took too long. */
export class ExhumeClientError extends Error {
  readonly code: ExhumeClientErrorCode;

  constructor(code: ExhumeClientErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ExhumeClientError";
    this.code = code;
  }
}

/** The Exhume server answered with `isError: true`; `code` is its fixed code. */
export class ExhumeToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExhumeToolError";
    this.code = code;
  }
}

// ---------------------------------------------------------- line reader

export type LineEvent =
  | { kind: "message"; value: unknown }
  | { kind: "invalid" }
  | { kind: "overflow" };

export interface LineReader {
  push(chunk: Uint8Array): LineEvent[];
  end(): LineEvent[];
}

/** Serialises one JSON-RPC message as exactly one newline-terminated line. */
export function encodeMessage(message: unknown): string {
  const text = JSON.stringify(message);
  // JSON.stringify never emits a raw newline; this guards a broken toJSON.
  if (typeof text !== "string" || text.includes("\n")) {
    throw new TypeError("message cannot be serialised on one line");
  }
  return `${text}\n`;
}

/**
 * Incremental line reader. Splits a byte stream on LF (a trailing CR is
 * dropped), parses each non-empty line as JSON and caps a line at
 * `maxLineBytes`. A longer line yields one `overflow` event, its bytes are
 * discarded up to the next LF and no message is produced for it.
 */
export function createLineReader(maxLineBytes: number = MAX_LINE_BYTES): LineReader {
  let parts: Uint8Array[] = [];
  let held = 0;
  let discarding = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });

  const takeLine = (): LineEvent | null => {
    const joined = new Uint8Array(held);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.length;
    }
    parts = [];
    held = 0;
    const end =
      joined.length > 0 && joined[joined.length - 1] === BYTE_CR ? joined.length - 1 : joined.length;
    if (end === 0) return null;
    try {
      const value: unknown = JSON.parse(decoder.decode(joined.subarray(0, end)));
      return { kind: "message", value };
    } catch {
      return { kind: "invalid" };
    }
  };

  const push = (chunk: Uint8Array): LineEvent[] => {
    const events: LineEvent[] = [];
    let pos = 0;
    // Each pass consumes up to the next LF; the pass count is bounded by the
    // number of LF bytes in the chunk plus one.
    for (let pass = 0; pass <= chunk.length + 1; pass++) {
      if (pos > chunk.length) break;
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
      if (discarding) {
        discarding = false;
      } else {
        const ev = takeLine();
        if (ev !== null) events.push(ev);
      }
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
    if (held > 0) {
      const ev = takeLine();
      return ev === null ? [] : [ev];
    }
    return [];
  };

  return { push, end };
}

// ---------------------------------------------------------- type guards

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

const GRAVE_STATES: readonly string[] = ["alive", "recovered", "partial", "lost"];

function isGraveState(v: unknown): v is GraveState {
  return typeof v === "string" && GRAVE_STATES.includes(v);
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isWarning(v: unknown): v is ExhumeWarning {
  return (
    isRecord(v) &&
    typeof v["code"] === "string" &&
    typeof v["message"] === "string" &&
    isOptionalString(v["path"])
  );
}

function isWarningList(v: unknown): v is ExhumeWarning[] {
  return Array.isArray(v) && v.every(isWarning);
}

function isOpenDiskEntry(v: unknown): v is OpenDiskEntry {
  return (
    isRecord(v) &&
    isCount(v["id"]) &&
    typeof v["path"] === "string" &&
    (v["kind"] === "file" || v["kind"] === "directory") &&
    isGraveState(v["state"]) &&
    isCount(v["size"]) &&
    (v["date"] === null || typeof v["date"] === "string") &&
    isOptionalString(v["reason"])
  );
}

export function isOpenDiskReport(v: unknown): v is OpenDiskReport {
  if (!isRecord(v) || v["untrusted"] !== true) return false;
  const volume = v["volume"];
  if (
    !isRecord(volume) ||
    typeof volume["label"] !== "string" ||
    (volume["geometrySource"] !== "bpb" &&
      volume["geometrySource"] !== "fallback" &&
      volume["geometrySource"] !== "none")
  ) {
    return false;
  }
  const counts = v["counts"];
  if (!isRecord(counts) || !GRAVE_STATES.every((s) => isCount(counts[s]))) return false;
  return (
    isCount(v["totalEntries"]) &&
    Array.isArray(v["entries"]) &&
    v["entries"].every(isOpenDiskEntry) &&
    typeof v["truncated"] === "boolean" &&
    isWarningList(v["warnings"]) &&
    isCount(v["warningsOmitted"])
  );
}

function isGraveRef(v: unknown): v is GraveRef {
  return (
    isRecord(v) &&
    isCount(v["id"]) &&
    typeof v["path"] === "string" &&
    isGraveState(v["state"]) &&
    isOptionalString(v["reason"])
  );
}

export function isReadGraveResult(v: unknown): v is ReadGraveResult {
  if (!isRecord(v) || v["untrusted"] !== true) return false;
  if (!isGraveRef(v["grave"]) || typeof v["mime"] !== "string") return false;
  if (!isWarningList(v["warnings"]) || !isCount(v["warningsOmitted"])) return false;
  if (v["format"] === "png") {
    return isCount(v["width"]) && isCount(v["height"]) && isCount(v["bytes"]);
  }
  return (
    (v["format"] === "markdown" || v["format"] === "csv" || v["format"] === "text") &&
    typeof v["extension"] === "string" &&
    typeof v["text"] === "string" &&
    isCount(v["totalChars"]) &&
    typeof v["truncated"] === "boolean"
  );
}

export function isExhumeResult(v: unknown): v is ExhumeResult {
  return (
    isRecord(v) &&
    v["untrusted"] === true &&
    typeof v["path"] === "string" &&
    isCount(v["bytes"]) &&
    typeof v["format"] === "string" &&
    typeof v["mime"] === "string" &&
    isCount(v["id"]) &&
    isGraveState(v["state"]) &&
    isOptionalString(v["reason"])
  );
}

// -------------------------------------------------------------- session

interface Pending {
  id: number;
  resolve: (value: unknown) => void;
  reject: (err: ExhumeClientError) => void;
  timer: NodeJS.Timeout | null;
}

/** One child process and its single in-flight request. */
class Session {
  dead = false;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly reader = createLineReader();
  private pending: Pending | null = null;
  private nextId = 1;

  constructor(scriptPath: string, libraryRoot: string, cwd: string) {
    // shell:false, minimal environment, never --workspace-from-agent (2.7).
    const child = spawn(process.execPath, [scriptPath, "--root", libraryRoot], {
      shell: false,
      cwd,
      env: { PATH: process.env["PATH"] ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", () => undefined); // drained and dropped
    child.stdin.on("error", () => this.fail());
    child.on("error", () => this.fail());
    child.on("exit", () => this.fail());
    child.on("close", () => this.fail());
  }

  /** Kills the child and fails the in-flight request with `EXHUME_UNAVAILABLE`. */
  fail(): void {
    this.settle(new ExhumeClientError("EXHUME_UNAVAILABLE"));
    this.kill();
  }

  kill(): void {
    this.dead = true;
    try {
      this.child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }

  private settle(err: ExhumeClientError): void {
    const p = this.pending;
    if (p === null) return;
    this.pending = null;
    if (p.timer !== null) clearTimeout(p.timer);
    p.reject(err);
  }

  private onData(chunk: Buffer): void {
    for (const ev of this.reader.push(chunk)) {
      if (ev.kind === "overflow" || ev.kind === "invalid") {
        // The stream can no longer be trusted: discard the child.
        this.fail();
        return;
      }
      this.onMessage(ev.value);
    }
  }

  private onMessage(value: unknown): void {
    const p = this.pending;
    if (p === null || !isRecord(value) || value["id"] !== p.id) return; // notification or stray
    this.pending = null;
    if (p.timer !== null) clearTimeout(p.timer);
    if (value["error"] !== undefined || !("result" in value)) {
      p.reject(new ExhumeClientError("EXHUME_UNAVAILABLE"));
      return;
    }
    p.resolve(value["result"]);
  }

  private write(message: unknown): void {
    this.child.stdin.write(encodeMessage(message));
  }

  notify(method: string): void {
    if (this.dead) return;
    try {
      this.write({ jsonrpc: "2.0", method });
    } catch {
      this.fail();
    }
  }

  /** Sends one request. A timeout kills the child and rejects `EXHUME_TIMEOUT`. */
  request(method: string, params: unknown, timeoutMs: number, onTimeout: "timeout" | "unavailable"): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (this.dead || this.pending !== null) {
        reject(new ExhumeClientError("EXHUME_UNAVAILABLE"));
        return;
      }
      const id = this.nextId++;
      const pending: Pending = { id, resolve, reject, timer: null };
      pending.timer = setTimeout(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        this.kill();
        reject(new ExhumeClientError(onTimeout === "timeout" ? "EXHUME_TIMEOUT" : "EXHUME_UNAVAILABLE"));
      }, timeoutMs);
      this.pending = pending;
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch {
        this.fail();
      }
    });
  }
}

// --------------------------------------------------------------- client

export interface ExhumeClientOptions {
  /** Installed app folder; the server is `<appRoot>/mcp/exhume-mcp.mjs`. */
  appRoot: string;
  libraryRoot: string;
  /** Client version sent in `clientInfo`. */
  version?: string;
  /** Override the server script (tests only). */
  serverScript?: string;
  /** Override timeouts (tests only). */
  timeouts?: Partial<Timeouts>;
}

export class StdioExhumeClient implements ExhumeClient {
  private readonly script: string;
  private readonly appRoot: string;
  private readonly version: string;
  private readonly timeouts: Timeouts;
  private libraryRoot: string;
  private session: Session | null = null;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private spawned = 0;

  constructor(options: ExhumeClientOptions) {
    this.appRoot = options.appRoot;
    this.libraryRoot = options.libraryRoot;
    this.version = options.version ?? "0.0.0";
    this.script = options.serverScript ?? path.join(options.appRoot, "mcp", "exhume-mcp.mjs");
    this.timeouts = { ...TIMEOUTS_MS, ...options.timeouts };
  }

  /** Number of child processes started so far (lets the Scanner note restarts). */
  get spawnCount(): number {
    return this.spawned;
  }

  openDisk(image: string): Promise<OpenDiskReport> {
    return this.call("open_disk", { image }, isOpenDiskReport);
  }

  readGrave(image: string, gravePath: string, id: number): Promise<ReadGraveResult> {
    return this.call("read_grave", { image, path: gravePath, id }, isReadGraveResult);
  }

  exhume(image: string, gravePath: string, id: number): Promise<ExhumeResult> {
    return this.call("exhume", { image, path: gravePath, id }, isExhumeResult);
  }

  /** Kills the child and points the next lazy start at a new library root. */
  restart(libraryRoot: string): Promise<void> {
    this.libraryRoot = libraryRoot;
    this.closed = false;
    // Run behind the queue so an in-flight call is not cut off mid-answer.
    return this.enqueue(async () => {
      this.discard();
    });
  }

  close(): void {
    this.closed = true;
    this.discard();
  }

  private discard(): void {
    const s = this.session;
    this.session = null;
    if (s !== null) s.kill();
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private call<T>(tool: ToolName, args: Record<string, unknown>, guard: (v: unknown) => v is T): Promise<T> {
    return this.enqueue(async () => {
      if (this.closed) throw new ExhumeClientError("EXHUME_UNAVAILABLE");
      const session = await this.ensureSession();
      let result: unknown;
      try {
        result = await session.request(
          "tools/call",
          { name: tool, arguments: args },
          this.timeouts[tool],
          "timeout",
        );
      } catch (err) {
        this.dropIfDead(session);
        throw err;
      }
      try {
        return this.interpret(result, guard);
      } catch (err) {
        if (err instanceof ExhumeClientError) {
          session.kill();
          this.dropIfDead(session);
        }
        throw err;
      }
    });
  }

  private dropIfDead(session: Session): void {
    if (session.dead && this.session === session) this.session = null;
  }

  private async ensureSession(): Promise<Session> {
    const existing = this.session;
    if (existing !== null && !existing.dead) return existing;
    this.session = null;
    let session: Session;
    try {
      session = new Session(this.script, this.libraryRoot, this.appRoot);
    } catch {
      throw new ExhumeClientError("EXHUME_UNAVAILABLE");
    }
    this.spawned++;
    try {
      const init = await session.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "exhume-crew-backend", version: this.version },
        },
        this.timeouts.handshake,
        "unavailable",
      );
      if (!isRecord(init) || typeof init["protocolVersion"] !== "string") {
        throw new ExhumeClientError("EXHUME_UNAVAILABLE");
      }
      session.notify("notifications/initialized");
    } catch {
      session.kill();
      throw new ExhumeClientError("EXHUME_UNAVAILABLE");
    }
    this.session = session;
    return session;
  }

  /** Unwraps `content[0].text`, parses it and validates the shape. */
  private interpret<T>(result: unknown, guard: (v: unknown) => v is T): T {
    const bad = new ExhumeClientError("EXHUME_UNAVAILABLE");
    if (!isRecord(result) || typeof result["isError"] !== "boolean") throw bad;
    const content = result["content"];
    if (!Array.isArray(content) || content.length === 0) throw bad;
    const first: unknown = content[0];
    if (!isRecord(first) || first["type"] !== "text" || typeof first["text"] !== "string") throw bad;
    let body: unknown;
    try {
      body = JSON.parse(first["text"]);
    } catch {
      throw bad;
    }
    if (result["isError"]) {
      if (isRecord(body) && typeof body["error"] === "string") {
        const message = typeof body["message"] === "string" ? body["message"] : "";
        throw new ExhumeToolError(body["error"], message);
      }
      throw new ExhumeToolError("EXHUME_FAILED", "");
    }
    if (!guard(body)) throw bad;
    return body;
  }
}
