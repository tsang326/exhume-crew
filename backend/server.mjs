if (Number.parseInt(process.versions.node.split(".")[0], 10) < 22) { process.stderr.write("exhume-crew: Node 22 or newer is required (found " + process.versions.node + ")\n"); process.exit(1); }

// backend/src/main.ts
import { existsSync, realpathSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import path6 from "node:path";
import { fileURLToPath } from "node:url";

// src/shared/version.ts
var MIN_NODE_MAJOR = 22;
function checkNodeVersion(versionString) {
  const match = /^\s*v?(\d+)(?:\.\d+){0,2}(?:[-+].*)?\s*$/.exec(versionString);
  const major = match?.[1] === void 0 ? NaN : Number.parseInt(match[1], 10);
  if (Number.isSafeInteger(major) && major >= MIN_NODE_MAJOR) return { ok: true };
  return {
    ok: false,
    message: `Node.js ${MIN_NODE_MAJOR} or newer is required (found "${versionString}"). Minimum supported version: ${MIN_NODE_MAJOR}.`
  };
}

// src/shared/store.ts
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

// src/shared/schema.ts
var CAPS = {
  warnings: 100,
  libraryWarnings: 200,
  notes: 100,
  summary: 1200,
  // code points
  note: 500,
  // code points
  relPath: 4096,
  label: 255,
  reason: 200
};
var SCHEMA_VERSION = 1;
var STATUSES = ["new", "catalogued", "summarised"];
var GRAVE_STATES = ["alive", "recovered", "partial", "lost"];
var FORMATS = ["markdown", "csv", "png", "text"];
var AGENTS = ["exhume-archivist", "exhume-undertaker"];
var GEOMETRY_SOURCES = ["bpb", "fallback", "none"];
var DISK_ID = /^[0-9a-f]{64}$/;
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isCount(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function isNullableString(v) {
  return v === null || typeof v === "string";
}
function codePointLength(s) {
  let n = 0;
  for (const _ of s) {
    void _;
    n++;
  }
  return n;
}
function hasOnlyKeys(v, allowed) {
  return Object.keys(v).every((k) => allowed.includes(k));
}
function isDiskId(v) {
  return typeof v === "string" && DISK_ID.test(v);
}
function isCardWarning(v) {
  if (!isRecord(v)) return false;
  if (!hasOnlyKeys(v, ["code", "message", "path"])) return false;
  if (typeof v["code"] !== "string" || typeof v["message"] !== "string") return false;
  return v["path"] === void 0 || typeof v["path"] === "string";
}
function isWarningList(v, cap) {
  return Array.isArray(v) && v.length <= cap && v.every(isCardWarning);
}
function isGeometry(v) {
  return isRecord(v) && typeof v["source"] === "string" && GEOMETRY_SOURCES.includes(v["source"]) && isNullableString(v["label"]);
}
function isCounts(v) {
  return isRecord(v) && GRAVE_STATES.every((s) => isCount(v[s]));
}
function isFormatFamily(v) {
  return typeof v === "string" && FORMATS.includes(v);
}
function isDiskCard(v) {
  if (!isRecord(v)) return false;
  if (!isDiskId(v["diskId"])) return false;
  if (typeof v["relPath"] !== "string" || v["relPath"].length > CAPS.relPath) return false;
  if (typeof v["label"] !== "string" || v["label"].length > CAPS.label) return false;
  if (!isCount(v["sizeBytes"]) || !isCount(v["fileCount"]) || !isCount(v["totalEntries"])) {
    return false;
  }
  if (!isGeometry(v["geometry"])) return false;
  if (typeof v["entriesTruncated"] !== "boolean") return false;
  if (!isNullableString(v["dateFirst"]) || !isNullableString(v["dateLast"])) return false;
  const formats = v["formats"];
  if (!Array.isArray(formats) || !formats.every(isFormatFamily)) return false;
  if (!isCounts(v["counts"])) return false;
  if (!isWarningList(v["warnings"], CAPS.warnings)) return false;
  if (typeof v["status"] !== "string" || !STATUSES.includes(v["status"])) return false;
  return typeof v["firstSeen"] === "string";
}
function isFileEntry(v) {
  if (!isRecord(v)) return false;
  if (!isCount(v["id"])) return false;
  if (typeof v["path"] !== "string" || v["path"].length > CAPS.relPath) return false;
  if (v["kind"] !== "file" && v["kind"] !== "directory") return false;
  if (typeof v["state"] !== "string" || !GRAVE_STATES.includes(v["state"])) {
    return false;
  }
  if (!isCount(v["size"]) || !isNullableString(v["date"])) return false;
  const reason = v["reason"];
  return reason === void 0 || typeof reason === "string" && reason.length <= CAPS.reason;
}
function isFilesDoc(v) {
  return isRecord(v) && v["schemaVersion"] === SCHEMA_VERSION && isDiskId(v["diskId"]) && isCount(v["totalEntries"]) && typeof v["truncated"] === "boolean" && Array.isArray(v["entries"]) && v["entries"].every(isFileEntry);
}
function isAgent(v) {
  return typeof v === "string" && AGENTS.includes(v);
}
function isSummary(v) {
  return isRecord(v) && typeof v["text"] === "string" && codePointLength(v["text"]) <= CAPS.summary && typeof v["savedAt"] === "string" && isAgent(v["agent"]);
}
function isNote(v) {
  return isRecord(v) && typeof v["id"] === "string" && typeof v["text"] === "string" && codePointLength(v["text"]) <= CAPS.note && typeof v["savedAt"] === "string" && isAgent(v["agent"]);
}
function isAnnotation(v) {
  return isRecord(v) && (v["summary"] === null || isSummary(v["summary"])) && Array.isArray(v["notes"]) && v["notes"].length <= CAPS.notes && v["notes"].every(isNote);
}
function isExhumedRecord(v) {
  return isRecord(v) && typeof v["outputPath"] === "string" && typeof v["at"] === "string";
}
function isPathRecord(v) {
  return isRecord(v) && isDiskId(v["diskId"]) && typeof v["firstSeen"] === "string";
}
function everyValue(v, test) {
  return Object.keys(v).every((k) => test(v[k]));
}
function isCatalogueData(v) {
  if (!isRecord(v) || v["schemaVersion"] !== SCHEMA_VERSION) return false;
  const { paths, cards, annotations, exhumed } = v;
  if (!isRecord(paths) || !isRecord(cards) || !isRecord(annotations) || !isRecord(exhumed)) {
    return false;
  }
  if (!Object.keys(paths).every((k) => k.length <= CAPS.relPath)) return false;
  if (!everyValue(paths, isPathRecord)) return false;
  if (!Object.keys(cards).every((k) => isDiskId(k) && isDiskCard(cards[k]) && cards[k].diskId === k)) {
    return false;
  }
  if (!Object.keys(annotations).every((k) => isDiskId(k) && isAnnotation(annotations[k]))) {
    return false;
  }
  return Object.keys(exhumed).every((k) => {
    const inner = exhumed[k];
    return isDiskId(k) && isRecord(inner) && everyValue(inner, isExhumedRecord);
  });
}

// src/shared/store.ts
var DEFAULT_RETRY_MS = 25;
var DEFAULT_LOCK_TIMEOUT_MS = 5e3;
var DEFAULT_STALE_MS = 3e4;
var MAX_CORRUPT_NAME_ATTEMPTS = 100;
var MAX_STALE_REMOVALS = 8;
var REASON_UNREADABLE = "file could not be read";
var REASON_NOT_JSON = "file is not valid JSON";
var REASON_INVALID = "file failed validation";
function emptyCatalogue() {
  return { schemaVersion: SCHEMA_VERSION, paths: {}, cards: {}, annotations: {}, exhumed: {} };
}
function errorCode(e) {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = e.code;
    return typeof code === "string" ? code : void 0;
  }
  return void 0;
}
function makeWellFormed(s) {
  return s.toWellFormed();
}
function wellFormed(value) {
  if (typeof value === "string") return makeWellFormed(value);
  if (Array.isArray(value)) return value.map(wellFormed);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [makeWellFormed(k), wellFormed(v)])
    );
  }
  return value;
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errorCode(e) === "EPERM";
  }
}
function utcStamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "");
}
function unique() {
  return `${process.pid}.${randomBytes(6).toString("hex")}`;
}
function fsyncDir(dir) {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
  }
}
function createStore(dataDir, options = {}) {
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const maxLockAttempts = Math.ceil(lockTimeoutMs / Math.max(1, retryMs)) + 2;
  const storeDir = join(dataDir, "store");
  const filesDir = join(storeDir, "files");
  const lockDir = join(storeDir, ".lock");
  const ownerFile = join(lockDir, "owner.json");
  const catalogueFile = join(storeDir, "catalogue.json");
  function ensureDirs() {
    try {
      mkdirSync(filesDir, { recursive: true, mode: 448 });
      return true;
    } catch {
      return false;
    }
  }
  function lockIsStale() {
    try {
      const raw = JSON.parse(readFileSync(ownerFile, "utf8"));
      if (typeof raw === "object" && raw !== null) {
        const o = raw;
        if (typeof o.pid === "number" && !pidAlive(o.pid)) return true;
        if (typeof o.startedAt === "number" && Date.now() - o.startedAt > staleMs) return true;
        if (typeof o.pid === "number") return false;
      }
    } catch {
    }
    try {
      return Date.now() - statSync(lockDir).mtimeMs > staleMs;
    } catch {
      return false;
    }
  }
  function removeStaleLock() {
    if (!lockIsStale()) return;
    const aside = `${lockDir}.stale.${unique()}`;
    try {
      renameSync(lockDir, aside);
    } catch {
      return;
    }
    try {
      rmSync(aside, { recursive: true, force: true });
    } catch {
    }
  }
  function acquire() {
    if (!ensureDirs()) return "failed";
    const deadline = Date.now() + lockTimeoutMs;
    let staleRemovals = 0;
    for (let attempt = 0; attempt < maxLockAttempts; attempt++) {
      try {
        mkdirSync(lockDir, { mode: 448 });
        try {
          writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
        } catch {
          release();
          return "failed";
        }
        return "ok";
      } catch (e) {
        if (errorCode(e) !== "EEXIST") return "failed";
      }
      if (staleRemovals < MAX_STALE_REMOVALS && lockIsStale()) {
        staleRemovals++;
        removeStaleLock();
        continue;
      }
      if (Date.now() >= deadline) break;
      sleepSync(retryMs);
    }
    return "busy";
  }
  function release() {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
    }
  }
  function withLock(fn) {
    const got = acquire();
    if (got === "busy") return { ok: false, error: { code: "STORE_BUSY" } };
    if (got === "failed") return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
    try {
      return fn();
    } finally {
      release();
    }
  }
  function atomicWrite(target, data) {
    const tmp = `${target}.${unique()}.tmp`;
    let fd = null;
    try {
      const text = JSON.stringify(wellFormed(data));
      fd = openSync(tmp, "wx", 384);
      writeFileSync(fd, text, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmp, target);
    } catch {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
        }
      }
      try {
        rmSync(tmp, { force: true });
      } catch {
      }
      return false;
    }
    fsyncDir(join(target, ".."));
    return true;
  }
  function preserveCorrupt(path7) {
    const stamp = utcStamp();
    for (let i = 0; i < MAX_CORRUPT_NAME_ATTEMPTS; i++) {
      const dest = `${path7}.corrupt-${stamp}${i === 0 ? "" : `-${i}`}`;
      try {
        statSync(dest);
        continue;
      } catch {
      }
      try {
        renameSync(path7, dest);
        return dest;
      } catch {
        return dest;
      }
    }
    return `${path7}.corrupt-${stamp}`;
  }
  function load(path7, label, guard) {
    let raw;
    try {
      raw = readFileSync(path7, "utf8");
    } catch (e) {
      if (errorCode(e) === "ENOENT") return { kind: "missing" };
      return corrupt(path7, label, REASON_UNREADABLE);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return corrupt(path7, label, REASON_NOT_JSON);
    }
    return guard(parsed) ? { kind: "ok", value: parsed } : corrupt(path7, label, REASON_INVALID);
  }
  function corrupt(path7, label, reason) {
    const preserved = preserveCorrupt(path7);
    const base = preserved.slice(storeDir.length + 1);
    return { kind: "corrupt", error: { code: "STORE_CORRUPT", file: label, reason, preservedAs: base } };
  }
  function readCatalogue2() {
    const r = load(catalogueFile, "catalogue.json", isCatalogueData);
    if (r.kind === "ok") return { ok: true, value: r.value };
    if (r.kind === "missing") return { ok: true, value: emptyCatalogue() };
    return { ok: false, error: r.error };
  }
  function filesPath(diskId) {
    return join(filesDir, `${diskId}.json`);
  }
  return {
    read: readCatalogue2,
    update(mutate) {
      return withLock(() => {
        const current = readCatalogue2();
        if (!current.ok) return current;
        const draft = wellFormed(current.value);
        mutate(draft);
        const next = wellFormed(draft);
        if (!isCatalogueData(next)) return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
        if (!atomicWrite(catalogueFile, next)) {
          return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
        }
        return { ok: true, value: void 0 };
      });
    },
    readFiles(diskId) {
      if (!isDiskId(diskId)) return { ok: true, value: null };
      const r = load(filesPath(diskId), `files/${diskId}.json`, isFilesDoc);
      if (r.kind === "ok") return { ok: true, value: r.value };
      if (r.kind === "missing") return { ok: true, value: null };
      return { ok: false, error: r.error };
    },
    writeFiles(diskId, doc) {
      if (!isDiskId(diskId)) return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
      const next = wellFormed(doc);
      if (!isFilesDoc(next)) return { ok: false, error: { code: "STORE_WRITE_FAILED" } };
      return withLock(
        () => atomicWrite(filesPath(diskId), next) ? { ok: true, value: void 0 } : { ok: false, error: { code: "STORE_WRITE_FAILED" } }
      );
    }
  };
}

// backend/src/demo.ts
import { randomBytes as randomBytes3 } from "node:crypto";
import { homedir } from "node:os";
import { link, lstat as lstat2, mkdir as mkdir2, readdir, readFile as readFile2, unlink as unlink2, writeFile as writeFile2 } from "node:fs/promises";
import path2 from "node:path";

// backend/src/errors.ts
var ERROR_MESSAGES = {
  UNAUTHORIZED: "The request was not authorised.",
  BODY_TOO_LARGE: "The request body is too large.",
  BAD_PARAMETER: "A request parameter is not valid.",
  BAD_REQUEST: "The request is not valid.",
  NOT_FOUND: "The requested resource was not found.",
  METHOD_NOT_ALLOWED: "This method is not allowed for the resource.",
  DISK_NOT_FOUND: "No disk with that identifier is in the catalogue.",
  DISK_CHANGED: "The disk image changed since it was catalogued. A rescan has started.",
  LIBRARY_TOO_BROAD: "That folder is too broad to use as a library.",
  LIBRARY_NOT_FOUND: "That folder was not found.",
  LIBRARY_NOT_DIRECTORY: "That path is not a folder.",
  LIBRARY_UNREADABLE: "That folder cannot be read.",
  LIBRARY_TIMEOUT: "Reading that folder took too long.",
  DEMO_COPY_FAILED: "The demo disks could not be copied.",
  PREVIEW_UNAVAILABLE: "The preview is not available right now.",
  EXHUME_UNAVAILABLE: "The exhume tool is not available right now.",
  EXHUME_TIMEOUT: "The exhume tool took too long to respond.",
  EXPORT_FAILED: "The export could not be built.",
  STORE_BUSY: "The catalogue is busy. Try again shortly.",
  STORE_WRITE_FAILED: "The catalogue could not be saved.",
  STORE_CORRUPT: "The catalogue was damaged and will be rebuilt by a rescan.",
  INTERNAL_ERROR: "Something went wrong."
};
var ApiError = class extends Error {
  code;
  status;
  constructor(code, status) {
    super(ERROR_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
};
function redactPaths(text) {
  return text.replace(/(?<![\w.~-])(?:\/[^\s/"'`<>|:;,()[\]{}\\]+)+\/?/g, "<path>").replace(/(?<![\w])[A-Za-z]:\\(?:[^\s\\"'`<>|:;,()[\]{}]+\\?)*/g, "<path>");
}
function isErrorCode(value) {
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}
function toErrorResponse(err) {
  if (err instanceof ApiError && isErrorCode(err.code)) {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
    return {
      status,
      body: { error: { code: err.code, message: redactPaths(ERROR_MESSAGES[err.code]) } }
    };
  }
  return {
    status: 500,
    body: {
      error: { code: "INTERNAL_ERROR", message: redactPaths(ERROR_MESSAGES.INTERNAL_ERROR) }
    }
  };
}

// backend/src/library.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
var REALPATH_TIMEOUT_MS = 2e3;
var DEFAULT_LIBRARY_NAME = "Exhume Library";
var ACTIVE_FILE_NAME = "library-active.json";
var CONFIG_FILE_NAME = "config.json";
function libraryError(code) {
  return new ApiError(code, code === "LIBRARY_TIMEOUT" ? 504 : 400);
}
function isLibraryCode(code) {
  return code.startsWith("LIBRARY_");
}
function errnoCode(err) {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = err.code;
    return typeof code === "string" ? code : "";
  }
  return "";
}
function expandHome(input, home) {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return input;
}
async function realpathWithTimeout(target, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(libraryError("LIBRARY_TIMEOUT")), timeoutMs);
  });
  try {
    return await Promise.race([realpath(target), timeout]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
}
function isSameOrAncestor(ancestor, child) {
  if (ancestor === child) return true;
  const prefix = ancestor.endsWith(path.sep) ? ancestor : ancestor + path.sep;
  return child.startsWith(prefix);
}
async function validateLibraryPath(input, home, timeoutMs = REALPATH_TIMEOUT_MS) {
  if (typeof input !== "string" || input.trim() === "" || input.includes("\0")) {
    throw libraryError("LIBRARY_NOT_FOUND");
  }
  const expanded = expandHome(input.trim(), home);
  if (!path.isAbsolute(expanded)) throw libraryError("LIBRARY_NOT_FOUND");
  const absolute = path.resolve(expanded);
  let real;
  try {
    real = await realpathWithTimeout(absolute, timeoutMs);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const code = errnoCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") throw libraryError("LIBRARY_NOT_FOUND");
    throw libraryError("LIBRARY_UNREADABLE");
  }
  try {
    const st = await lstat(real);
    if (!st.isDirectory()) throw libraryError("LIBRARY_NOT_DIRECTORY");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw libraryError(errnoCode(err) === "ENOENT" ? "LIBRARY_NOT_FOUND" : "LIBRARY_UNREADABLE");
  }
  let homeReal;
  try {
    homeReal = await realpathWithTimeout(path.resolve(home), timeoutMs);
  } catch {
    homeReal = path.resolve(home);
  }
  if (real === path.parse(real).root || isSameOrAncestor(real, homeReal)) {
    throw libraryError("LIBRARY_TOO_BROAD");
  }
  try {
    await access(real, fsConstants.R_OK | fsConstants.X_OK);
  } catch {
    throw libraryError("LIBRARY_UNREADABLE");
  }
  return real;
}
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return void 0;
  }
}
function stringField(value, key) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const field = value[key];
    if (typeof field === "string" && field.trim() !== "") return field;
  }
  return void 0;
}
var LibraryManager = class {
  dataDir;
  home;
  restartExhume;
  triggerScan;
  timeoutMs;
  typedPath;
  realPath = null;
  error = null;
  queue = Promise.resolve();
  constructor(options) {
    this.dataDir = options.dataDir;
    this.home = options.home;
    this.restartExhume = options.restartExhume;
    this.triggerScan = options.triggerScan;
    this.timeoutMs = options.realpathTimeoutMs ?? REALPATH_TIMEOUT_MS;
    this.typedPath = path.join(this.home, DEFAULT_LIBRARY_NAME);
  }
  get activeFile() {
    return path.join(this.dataDir, ACTIVE_FILE_NAME);
  }
  /**
   * Resolves the startup library: active file, then config.json `libraryPath`,
   * then the default. Each candidate is validated; the first valid one wins and
   * is persisted if it did not come from the active file. Does not restart the
   * Exhume client or scan; the caller does that after startup.
   */
  async init() {
    const candidates = [];
    const active = stringField(await readJson(this.activeFile), "path");
    if (active !== void 0) candidates.push({ source: "active", value: active });
    const configured = stringField(
      await readJson(path.join(this.dataDir, CONFIG_FILE_NAME)),
      "libraryPath"
    );
    if (configured !== void 0) candidates.push({ source: "config", value: configured });
    candidates.push({ source: "default", value: path.join(this.home, DEFAULT_LIBRARY_NAME) });
    let first = true;
    for (const candidate of candidates) {
      if (first) this.typedPath = candidate.value;
      first = false;
      try {
        const real = await validateLibraryPath(candidate.value, this.home, this.timeoutMs);
        this.typedPath = candidate.value;
        this.realPath = real;
        this.error = null;
        if (candidate.source !== "active") await this.persist(real);
        return this.getStatus();
      } catch (err) {
        this.error = this.toStatusError(err);
      }
    }
    this.realPath = null;
    return this.getStatus();
  }
  /**
   * Validates `input`, persists it atomically, restarts the Exhume client and
   * triggers a scan. A rejected path throws and leaves the previous valid path
   * active; nothing is written and nothing starts.
   */
  setLibrary(input) {
    const run = this.queue.then(() => this.doSetLibrary(input));
    this.queue = run.catch(() => void 0);
    return run;
  }
  async doSetLibrary(input) {
    let real;
    try {
      real = await validateLibraryPath(input, this.home, this.timeoutMs);
    } catch (err) {
      this.error = this.toStatusError(err);
      throw err;
    }
    await this.persist(real);
    this.typedPath = input;
    this.realPath = real;
    this.error = null;
    await this.restartExhume(real);
    await this.triggerScan();
    return this.getStatus();
  }
  getStatus() {
    return { path: this.typedPath, error: this.error };
  }
  /** The validated real path of the active library, or null when none is valid. */
  getRealPath() {
    return this.realPath;
  }
  toStatusError(err) {
    if (err instanceof ApiError && isLibraryCode(err.code)) {
      return { code: err.code, message: ERROR_MESSAGES[err.code] };
    }
    return { code: "LIBRARY_UNREADABLE", message: ERROR_MESSAGES.LIBRARY_UNREADABLE };
  }
  /** Atomic write: temp file in the same directory, then rename. */
  async persist(real) {
    await mkdir(this.dataDir, { recursive: true });
    const tmp = path.join(this.dataDir, `.${ACTIVE_FILE_NAME}.${randomBytes2(6).toString("hex")}.tmp`);
    const body = JSON.stringify({ path: real, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2);
    try {
      await writeFile(tmp, body, { encoding: "utf8", mode: 384 });
      await rename(tmp, this.activeFile);
    } catch (err) {
      await unlink(tmp).catch(() => void 0);
      throw err;
    }
  }
};

// backend/src/demo.ts
var DEMO_DIR_NAME = "demo-library";
var DEMO_IMAGE_EXTENSION = ".img";
var MAX_DEMO_IMAGE_BYTES = 2949120;
var DemoCopyError = class extends ApiError {
  copied;
  skipped;
  constructor(copied, skipped) {
    super("DEMO_COPY_FAILED", 500);
    this.name = "DemoCopyError";
    this.copied = copied;
    this.skipped = skipped;
  }
};
function errnoCode2(err) {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = err.code;
    return typeof code === "string" ? code : "";
  }
  return "";
}
async function listDemoImages(demoDir) {
  const names = [];
  for (const entry of await readdir(demoDir)) {
    if (path2.extname(entry).toLowerCase() !== DEMO_IMAGE_EXTENSION) continue;
    if (entry !== path2.basename(entry)) continue;
    const st = await lstat2(path2.join(demoDir, entry));
    if (!st.isFile() || st.size === 0 || st.size > MAX_DEMO_IMAGE_BYTES) continue;
    names.push(entry);
  }
  return names.sort();
}
async function ensureLibraryFolder(libraryRoot, inject) {
  const target = path2.resolve(libraryRoot);
  try {
    await lstat2(target);
    return;
  } catch (err) {
    if (errnoCode2(err) !== "ENOENT") return;
  }
  if (inject) await inject("mkdir-library", "");
  try {
    await mkdir2(target, { mode: 493 });
  } catch (err) {
    if (errnoCode2(err) !== "EEXIST") throw err;
  }
}
async function copyDemoLibrary(appRoot, libraryRoot, options) {
  if (options.userInitiated !== true) throw new ApiError("DEMO_COPY_FAILED", 500);
  const inject = options.inject;
  const home = options.home ?? homedir();
  const copied = [];
  const skipped = [];
  try {
    await ensureLibraryFolder(libraryRoot, inject);
  } catch {
    throw new DemoCopyError(copied, skipped);
  }
  const realLibrary = await validateLibraryPath(libraryRoot, home);
  const demoDir = path2.join(appRoot, DEMO_DIR_NAME);
  let names;
  try {
    names = await listDemoImages(demoDir);
  } catch {
    throw new DemoCopyError(copied, skipped);
  }
  for (const name of names) {
    const finalPath = path2.join(realLibrary, name);
    const tmpPath = path2.join(realLibrary, `.demo-${randomBytes3(8).toString("hex")}.tmp`);
    try {
      const bytes = await readFile2(path2.join(demoDir, name));
      if (inject) await inject("write-temp", name);
      await writeFile2(tmpPath, bytes, { flag: "wx", mode: 420 });
      if (inject) await inject("link", name);
      try {
        await link(tmpPath, finalPath);
        copied.push(name);
      } catch (err) {
        if (errnoCode2(err) !== "EEXIST") throw err;
        skipped.push(name);
      }
      if (inject) await inject("unlink-temp", name);
      await unlink2(tmpPath);
    } catch {
      await unlink2(tmpPath).catch(() => void 0);
      throw new DemoCopyError(copied, skipped);
    }
  }
  return { copied, skipped };
}

// backend/src/exhume-client.ts
import { spawn } from "node:child_process";
import path3 from "node:path";
var MAX_LINE_BYTES = 1048576;
var PROTOCOL_VERSION = "2025-06-18";
var TIMEOUTS_MS = {
  handshake: 1e4,
  open_disk: 3e4,
  read_grave: 1e4,
  exhume: 3e4
};
var BYTE_LF = 10;
var BYTE_CR = 13;
var ExhumeClientError = class extends Error {
  code;
  constructor(code) {
    super(ERROR_MESSAGES[code]);
    this.name = "ExhumeClientError";
    this.code = code;
  }
};
var ExhumeToolError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ExhumeToolError";
    this.code = code;
  }
};
function encodeMessage(message) {
  const text = JSON.stringify(message);
  if (typeof text !== "string" || text.includes("\n")) {
    throw new TypeError("message cannot be serialised on one line");
  }
  return `${text}
`;
}
function createLineReader(maxLineBytes = MAX_LINE_BYTES) {
  let parts = [];
  let held = 0;
  let discarding = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const takeLine = () => {
    const joined = new Uint8Array(held);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.length;
    }
    parts = [];
    held = 0;
    const end2 = joined.length > 0 && joined[joined.length - 1] === BYTE_CR ? joined.length - 1 : joined.length;
    if (end2 === 0) return null;
    try {
      const value = JSON.parse(decoder.decode(joined.subarray(0, end2)));
      return { kind: "message", value };
    } catch {
      return { kind: "invalid" };
    }
  };
  const push = (chunk) => {
    const events = [];
    let pos = 0;
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
  const end = () => {
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
function isRecord2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isCount2(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
var GRAVE_STATES2 = ["alive", "recovered", "partial", "lost"];
function isGraveState(v) {
  return typeof v === "string" && GRAVE_STATES2.includes(v);
}
function isOptionalString(v) {
  return v === void 0 || typeof v === "string";
}
function isWarning(v) {
  return isRecord2(v) && typeof v["code"] === "string" && typeof v["message"] === "string" && isOptionalString(v["path"]);
}
function isWarningList2(v) {
  return Array.isArray(v) && v.every(isWarning);
}
function isOpenDiskEntry(v) {
  return isRecord2(v) && isCount2(v["id"]) && typeof v["path"] === "string" && (v["kind"] === "file" || v["kind"] === "directory") && isGraveState(v["state"]) && isCount2(v["size"]) && (v["date"] === null || typeof v["date"] === "string") && isOptionalString(v["reason"]);
}
function isOpenDiskReport(v) {
  if (!isRecord2(v) || v["untrusted"] !== true) return false;
  const volume = v["volume"];
  if (!isRecord2(volume) || typeof volume["label"] !== "string" || volume["geometrySource"] !== "bpb" && volume["geometrySource"] !== "fallback" && volume["geometrySource"] !== "none") {
    return false;
  }
  const counts = v["counts"];
  if (!isRecord2(counts) || !GRAVE_STATES2.every((s) => isCount2(counts[s]))) return false;
  return isCount2(v["totalEntries"]) && Array.isArray(v["entries"]) && v["entries"].every(isOpenDiskEntry) && typeof v["truncated"] === "boolean" && isWarningList2(v["warnings"]) && isCount2(v["warningsOmitted"]);
}
function isGraveRef(v) {
  return isRecord2(v) && isCount2(v["id"]) && typeof v["path"] === "string" && isGraveState(v["state"]) && isOptionalString(v["reason"]);
}
function isReadGraveResult(v) {
  if (!isRecord2(v) || v["untrusted"] !== true) return false;
  if (!isGraveRef(v["grave"]) || typeof v["mime"] !== "string") return false;
  if (!isWarningList2(v["warnings"]) || !isCount2(v["warningsOmitted"])) return false;
  if (v["format"] === "png") {
    return isCount2(v["width"]) && isCount2(v["height"]) && isCount2(v["bytes"]);
  }
  return (v["format"] === "markdown" || v["format"] === "csv" || v["format"] === "text") && typeof v["extension"] === "string" && typeof v["text"] === "string" && isCount2(v["totalChars"]) && typeof v["truncated"] === "boolean";
}
function isExhumeResult(v) {
  return isRecord2(v) && v["untrusted"] === true && typeof v["path"] === "string" && isCount2(v["bytes"]) && typeof v["format"] === "string" && typeof v["mime"] === "string" && isCount2(v["id"]) && isGraveState(v["state"]) && isOptionalString(v["reason"]);
}
var Session = class {
  dead = false;
  child;
  reader = createLineReader();
  pending = null;
  nextId = 1;
  constructor(scriptPath, libraryRoot, cwd) {
    const child = spawn(process.execPath, [scriptPath, "--root", libraryRoot], {
      shell: false,
      cwd,
      env: { PATH: process.env["PATH"] ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    child.stdout.on("data", (chunk) => this.onData(chunk));
    child.stderr.on("data", () => void 0);
    child.stdin.on("error", () => this.fail());
    child.on("error", () => this.fail());
    child.on("exit", () => this.fail());
    child.on("close", () => this.fail());
  }
  /** Kills the child and fails the in-flight request with `EXHUME_UNAVAILABLE`. */
  fail() {
    this.settle(new ExhumeClientError("EXHUME_UNAVAILABLE"));
    this.kill();
  }
  kill() {
    this.dead = true;
    try {
      this.child.kill("SIGKILL");
    } catch {
    }
  }
  settle(err) {
    const p = this.pending;
    if (p === null) return;
    this.pending = null;
    if (p.timer !== null) clearTimeout(p.timer);
    p.reject(err);
  }
  onData(chunk) {
    for (const ev of this.reader.push(chunk)) {
      if (ev.kind === "overflow" || ev.kind === "invalid") {
        this.fail();
        return;
      }
      this.onMessage(ev.value);
    }
  }
  onMessage(value) {
    const p = this.pending;
    if (p === null || !isRecord2(value) || value["id"] !== p.id) return;
    this.pending = null;
    if (p.timer !== null) clearTimeout(p.timer);
    if (value["error"] !== void 0 || !("result" in value)) {
      p.reject(new ExhumeClientError("EXHUME_UNAVAILABLE"));
      return;
    }
    p.resolve(value["result"]);
  }
  write(message) {
    this.child.stdin.write(encodeMessage(message));
  }
  notify(method) {
    if (this.dead) return;
    try {
      this.write({ jsonrpc: "2.0", method });
    } catch {
      this.fail();
    }
  }
  /** Sends one request. A timeout kills the child and rejects `EXHUME_TIMEOUT`. */
  request(method, params, timeoutMs, onTimeout) {
    return new Promise((resolve2, reject) => {
      if (this.dead || this.pending !== null) {
        reject(new ExhumeClientError("EXHUME_UNAVAILABLE"));
        return;
      }
      const id = this.nextId++;
      const pending = { id, resolve: resolve2, reject, timer: null };
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
};
var StdioExhumeClient = class {
  script;
  appRoot;
  version;
  timeouts;
  libraryRoot;
  session = null;
  tail = Promise.resolve();
  closed = false;
  spawned = 0;
  constructor(options) {
    this.appRoot = options.appRoot;
    this.libraryRoot = options.libraryRoot;
    this.version = options.version ?? "0.0.0";
    this.script = options.serverScript ?? path3.join(options.appRoot, "mcp", "exhume-mcp.mjs");
    this.timeouts = { ...TIMEOUTS_MS, ...options.timeouts };
  }
  /** Number of child processes started so far (lets the Scanner note restarts). */
  get spawnCount() {
    return this.spawned;
  }
  openDisk(image) {
    return this.call("open_disk", { image }, isOpenDiskReport);
  }
  readGrave(image, gravePath, id) {
    return this.call("read_grave", { image, path: gravePath, id }, isReadGraveResult);
  }
  exhume(image, gravePath, id) {
    return this.call("exhume", { image, path: gravePath, id }, isExhumeResult);
  }
  /** Kills the child and points the next lazy start at a new library root. */
  restart(libraryRoot) {
    this.libraryRoot = libraryRoot;
    this.closed = false;
    return this.enqueue(async () => {
      this.discard();
    });
  }
  close() {
    this.closed = true;
    this.discard();
  }
  discard() {
    const s = this.session;
    this.session = null;
    if (s !== null) s.kill();
  }
  enqueue(job) {
    const run = this.tail.then(job, job);
    this.tail = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  call(tool, args, guard) {
    return this.enqueue(async () => {
      if (this.closed) throw new ExhumeClientError("EXHUME_UNAVAILABLE");
      const session = await this.ensureSession();
      let result;
      try {
        result = await session.request(
          "tools/call",
          { name: tool, arguments: args },
          this.timeouts[tool],
          "timeout"
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
  dropIfDead(session) {
    if (session.dead && this.session === session) this.session = null;
  }
  async ensureSession() {
    const existing = this.session;
    if (existing !== null && !existing.dead) return existing;
    this.session = null;
    let session;
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
          clientInfo: { name: "exhume-crew-backend", version: this.version }
        },
        this.timeouts.handshake,
        "unavailable"
      );
      if (!isRecord2(init) || typeof init["protocolVersion"] !== "string") {
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
  interpret(result, guard) {
    const bad2 = new ExhumeClientError("EXHUME_UNAVAILABLE");
    if (!isRecord2(result) || typeof result["isError"] !== "boolean") throw bad2;
    const content = result["content"];
    if (!Array.isArray(content) || content.length === 0) throw bad2;
    const first = content[0];
    if (!isRecord2(first) || first["type"] !== "text" || typeof first["text"] !== "string") throw bad2;
    let body;
    try {
      body = JSON.parse(first["text"]);
    } catch {
      throw bad2;
    }
    if (result["isError"]) {
      if (isRecord2(body) && typeof body["error"] === "string") {
        const message = typeof body["message"] === "string" ? body["message"] : "";
        throw new ExhumeToolError(body["error"], message);
      }
      throw new ExhumeToolError("EXHUME_FAILED", "");
    }
    if (!guard(body)) throw bad2;
    return body;
  }
};

// backend/src/routes.ts
import { constants as fsConstants2 } from "node:fs";
import { lstat as lstat4, open } from "node:fs/promises";
import path4 from "node:path";

// src/shared/card.ts
var GEOMETRY_LABELS = /* @__PURE__ */ new Map([
  [368640, "360K"],
  [737280, "720K"],
  [1228800, "1.2M"],
  [1474560, "1.44M"],
  [2949120, "2.88M"]
]);
function geometryLabel(sizeBytes) {
  return GEOMETRY_LABELS.get(sizeBytes) ?? null;
}
function mergeFormats(...lists) {
  const seen = /* @__PURE__ */ new Set();
  for (const list of lists) for (const f of list) seen.add(f);
  return [...seen].sort();
}
function dateRange(entries) {
  let dateFirst = null;
  let dateLast = null;
  for (const e of entries) {
    if (e.kind !== "file" || e.date === null) continue;
    if (dateFirst === null || e.date < dateFirst) dateFirst = e.date;
    if (dateLast === null || e.date > dateLast) dateLast = e.date;
  }
  return { dateFirst, dateLast };
}
function mergeWarnings(report, scanner = []) {
  const out = [];
  for (const w of [...report, ...scanner]) {
    if (out.length >= CAPS.warnings) break;
    out.push(w.path === void 0 ? { code: w.code, message: w.message } : { code: w.code, message: w.message, path: w.path });
  }
  return out;
}
function cardStatus(opts) {
  if (opts.hasSummary) return "summarised";
  return opts.stored ? "catalogued" : "new";
}
function deriveCard(input) {
  const { report } = input;
  const { dateFirst, dateLast } = dateRange(report.entries);
  return {
    diskId: input.diskId,
    relPath: input.relPath,
    label: Array.from(report.volume.label).slice(0, CAPS.label).join(""),
    sizeBytes: input.sizeBytes,
    geometry: { source: report.volume.geometrySource, label: geometryLabel(input.sizeBytes) },
    fileCount: report.entries.filter((e) => e.kind === "file").length,
    totalEntries: report.totalEntries,
    entriesTruncated: report.truncated,
    dateFirst,
    dateLast,
    formats: mergeFormats(input.formats ?? []),
    counts: {
      alive: report.counts.alive,
      recovered: report.counts.recovered,
      partial: report.counts.partial,
      lost: report.counts.lost
    },
    warnings: mergeWarnings(report.warnings, input.scannerWarnings),
    status: cardStatus({ stored: true, hasSummary: input.hasSummary === true }),
    firstSeen: input.firstSeen
  };
}
function toCardView(card, annotation) {
  const summary = annotation?.summary ?? null;
  return {
    ...card,
    status: cardStatus({ stored: true, hasSummary: summary !== null }),
    summary,
    notes: annotation?.notes ?? []
  };
}

// src/shared/paths.ts
import { lstat as lstat3, mkdir as mkdir3, realpath as realpath2, writeFile as writeFile3 } from "node:fs/promises";
import { dirname, join as join2, parse, resolve, sep } from "node:path";
function errorCode2(e) {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = e.code;
    return typeof code === "string" ? code : void 0;
  }
  return void 0;
}
async function realpathAllowMissing(p) {
  const abs = resolve(p);
  const missing = [];
  let current = abs;
  for (; ; ) {
    try {
      const real = await realpath2(current);
      return missing.length === 0 ? real : join2(real, ...missing.reverse());
    } catch (e) {
      if (errorCode2(e) !== "ENOENT" && errorCode2(e) !== "ENOTDIR") return null;
    }
    try {
      await lstat3(current);
      return null;
    } catch (e) {
      if (errorCode2(e) !== "ENOENT" && errorCode2(e) !== "ENOTDIR") return null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    missing.push(parse(current).base);
    current = parent;
  }
}
function containsSegments(base, candidate) {
  const b = base.split(sep).filter((s) => s !== "");
  const c = candidate.split(sep).filter((s) => s !== "");
  if (c.length < b.length) return false;
  return b.every((seg, i) => seg === c[i]);
}
async function isWithin(base, candidate) {
  if (base === "" || candidate === "") return false;
  const realBase = await realpathAllowMissing(base);
  const realCandidate = await realpathAllowMissing(candidate);
  if (realBase === null || realCandidate === null) return false;
  return containsSegments(realBase, realCandidate);
}

// src/shared/sanitize.ts
var FALLBACK_FILE_NAME = "exhume-export";
var MAX_FILE_NAME_LENGTH = 255;
function toWellFormed(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 55296 && c <= 56319) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        out += text.slice(i, i + 2);
        i++;
      } else {
        out += "�";
      }
    } else if (c >= 56320 && c <= 57343) {
      out += "�";
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}
function isControl(cp) {
  return cp <= 31 || cp >= 127 && cp <= 159;
}
function isInvisibleFormat(cp) {
  return cp === 8232 || cp === 8233 || cp >= 8234 && cp <= 8238 || cp >= 8294 && cp <= 8297 || cp === 65279;
}
function filterCodePoints(text, drop) {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!drop(cp)) out += ch;
  }
  return out;
}
var FORMULA_PREFIXES = /* @__PURE__ */ new Set(["=", "+", "-", "@", "	", "\r"]);
function cellText(value) {
  const cleaned = filterCodePoints(
    toWellFormed(value),
    (cp) => isControl(cp) && cp !== 9 && cp !== 13 && cp !== 10
  );
  const first = cleaned.charAt(0);
  return FORMULA_PREFIXES.has(first) ? `'${cleaned}` : cleaned;
}
function displayName(value) {
  let out = "";
  for (const ch of toWellFormed(value)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 9 || cp === 10 || cp === 13 || cp === 8232 || cp === 8233) {
      out += " ";
    } else if (!isControl(cp) && !isInvisibleFormat(cp)) {
      out += ch;
    }
  }
  return out;
}
function sanitizeFileName(name) {
  let out = "";
  for (const ch of toWellFormed(name)) {
    out += /^[A-Za-z0-9._-]$/.test(ch) ? ch : "_";
  }
  out = out.slice(0, MAX_FILE_NAME_LENGTH);
  if (out === "" || /^\.+$/.test(out)) return FALLBACK_FILE_NAME;
  return out;
}

// src/shared/csv.ts
var CSV_COLUMNS = [
  "diskId",
  "relPath",
  "label",
  "sizeBytes",
  "geometrySource",
  "geometryLabel",
  "fileCount",
  "totalEntries",
  "entriesTruncated",
  "dateFirst",
  "dateLast",
  "formats",
  "alive",
  "recovered",
  "partial",
  "lost",
  "warnings",
  "status",
  "firstSeen",
  "summary",
  "notes"
];
function cardValues(card) {
  return [
    card.diskId,
    card.relPath,
    card.label,
    String(card.sizeBytes),
    card.geometry.source,
    card.geometry.label ?? "",
    String(card.fileCount),
    String(card.totalEntries),
    card.entriesTruncated ? "true" : "false",
    card.dateFirst ?? "",
    card.dateLast ?? "",
    card.formats.join(" "),
    String(card.counts.alive),
    String(card.counts.recovered),
    String(card.counts.partial),
    String(card.counts.lost),
    card.warnings.map((w) => `${w.code}: ${w.message}`).join("\n"),
    card.status,
    card.firstSeen,
    card.summary?.text ?? "",
    card.notes.map((n) => n.text).join("\n")
  ];
}
function csvField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function csvRow(values) {
  return values.map((v) => csvField(cellText(v))).join(",");
}
function buildCsv(cards) {
  const lines = [csvRow(CSV_COLUMNS)];
  for (const card of cards) lines.push(csvRow(cardValues(card)));
  return lines.join("\r\n") + "\r\n";
}

// backend/src/exports.ts
var MARKDOWN_TITLE = "# Exhume Crew catalogue";
function escapeMarkdown(value) {
  return displayName(value).replace(/[!-/:-@[-`{-~]/g, "\\$&");
}
function markdownSection(card) {
  const values = cardValues(card);
  const heading = escapeMarkdown(card.label !== "" ? card.label : card.relPath);
  const lines = [`## ${heading} (${card.diskId.slice(0, 12)})`, ""];
  CSV_COLUMNS.forEach((column, i) => {
    lines.push(`- ${column}: ${escapeMarkdown(values[i] ?? "")}`);
  });
  return lines.join("\n");
}
function toCsv(cards) {
  try {
    return buildCsv(cards);
  } catch {
    throw new ApiError("EXPORT_FAILED", 500);
  }
}
function toMarkdown(cards) {
  try {
    const parts = [MARKDOWN_TITLE];
    for (const card of cards) parts.push(markdownSection(card));
    return parts.join("\n\n") + "\n";
  } catch {
    throw new ApiError("EXPORT_FAILED", 500);
  }
}

// backend/src/params.ts
var DISK_ID_PATTERN = /^[0-9a-f]{64}$/;
var ENTRY_ID_PATTERN = /^(?:0|[1-9][0-9]{0,3})$/;
var MAX_ENTRY_ID = 4095;
var CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
function bad() {
  return { ok: false, error: new ApiError("BAD_PARAMETER", 400) };
}
function decodeOnce(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
function isUnsafe(decoded, isSegment) {
  if (decoded.includes("%")) return true;
  if (decoded.includes("..")) return true;
  if (CONTROL_CHARS.test(decoded)) return true;
  if (decoded.startsWith("/") || decoded.startsWith("\\")) return true;
  if (isSegment && (decoded.includes("/") || decoded.includes("\\"))) return true;
  return false;
}
function guardParams(url, routeParamNames) {
  if (typeof url !== "string" || CONTROL_CHARS.test(url)) return bad();
  const hashAt = url.indexOf("#");
  const target = hashAt === -1 ? url : url.slice(0, hashAt);
  const qAt = target.indexOf("?");
  const rawPath = qAt === -1 ? target : target.slice(0, qAt);
  const rawQuery = qAt === -1 ? "" : target.slice(qAt + 1);
  if (!rawPath.startsWith("/")) return bad();
  const segments = [];
  for (const rawSegment of rawPath.slice(1).split("/")) {
    if (rawSegment === "") continue;
    const decoded = decodeOnce(rawSegment);
    if (decoded === null || isUnsafe(decoded, true)) return bad();
    segments.push(decoded);
  }
  const allowed = new Set(routeParamNames);
  const query = /* @__PURE__ */ Object.create(null);
  if (rawQuery !== "") {
    for (const pair of rawQuery.split("&")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
      const name = decodeOnce(rawName.replace(/\+/g, " "));
      const value = decodeOnce(rawValue.replace(/\+/g, " "));
      if (name === null || value === null) return bad();
      if (isUnsafe(name, false) || isUnsafe(value, false)) return bad();
      if (!allowed.has(name) || name in query) return bad();
      query[name] = value;
    }
  }
  return { ok: true, params: { segments, query } };
}
function parseDiskId(value) {
  return typeof value === "string" && DISK_ID_PATTERN.test(value) ? value : null;
}
function parseEntryId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_ENTRY_ID ? value : null;
  }
  if (typeof value !== "string" || !ENTRY_ID_PATTERN.test(value)) return null;
  const n = Number(value);
  return n <= MAX_ENTRY_ID ? n : null;
}

// backend/src/routes.ts
var MAX_PREVIEW_BYTES = 65536;
var MAX_IMAGE_DATA_BYTES = 15e5;
var MAX_LIBRARY_PATH_CHARS = 4096;
var MAX_PREVIEW_WARNINGS = 50;
var EXHUMED_DIR = "exhumed";
var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
var TOOL_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
function isRecord3(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function json(status, body) {
  return { kind: "json", status, body };
}
function storeFailure(code) {
  if (code === "STORE_BUSY") return new ApiError("STORE_BUSY", 503);
  if (code === "STORE_CORRUPT") return new ApiError("STORE_CORRUPT", 500);
  return new ApiError("STORE_WRITE_FAILED", 500);
}
function readCatalogue(store) {
  let result = store.read();
  if (!result.ok && result.error.code === "STORE_CORRUPT") result = store.read();
  if (!result.ok) throw storeFailure(result.error.code);
  return result.value;
}
function compareCards(a, b) {
  if (a.relPath !== b.relPath) return a.relPath < b.relPath ? -1 : 1;
  if (a.diskId === b.diskId) return 0;
  return a.diskId < b.diskId ? -1 : 1;
}
function allViews(data) {
  return Object.values(data.cards).sort(compareCards).map((card) => toCardView(card, data.annotations[card.diskId]));
}
function requireCard(data, rawId) {
  const id = parseDiskId(rawId);
  const card = id === null ? void 0 : data.cards[id];
  if (card === void 0) throw new ApiError("DISK_NOT_FOUND", 404);
  return card;
}
function readEntries(store, card) {
  const result = store.readFiles(card.diskId);
  if (!result.ok) throw storeFailure(result.error.code);
  return result.value === null ? [] : result.value.entries;
}
function truncateUtf8(text, maxBytes = MAX_PREVIEW_BYTES) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && ((buf[end] ?? 0) & 192) === 128) end--;
  return { text: buf.subarray(0, end).toString("utf8"), truncated: true };
}
function viewWarnings(warnings) {
  return warnings.slice(0, MAX_PREVIEW_WARNINGS).map((w) => {
    const out = {
      code: displayName(w.code),
      message: redactPaths(displayName(w.message))
    };
    if (w.path !== void 0) out.path = displayName(w.path);
    return out;
  });
}
function toolErrorCode(err) {
  if (err instanceof ExhumeToolError && TOOL_CODE.test(err.code)) return err.code;
  if (err instanceof ExhumeClientError) return err.code;
  return "EXHUME_FAILED";
}
async function readExhumedPng(root, outputPath) {
  try {
    const exhumedDir = path4.join(root, EXHUMED_DIR);
    const abs = path4.resolve(root, outputPath);
    if (!await isWithin(exhumedDir, abs)) return null;
    const linkInfo = await lstat4(abs);
    if (!linkInfo.isFile()) return null;
    const handle = await open(abs, fsConstants2.O_RDONLY | fsConstants2.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_DATA_BYTES) return null;
      const buf = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < info.size) {
        const { bytesRead } = await handle.read(buf, offset, info.size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== info.size) return null;
      if (!buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
      return `data:image/png;base64,${buf.toString("base64")}`;
    } finally {
      await handle.close().catch(() => void 0);
    }
  } catch {
    return null;
  }
}
function parseLibraryBody(body) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new ApiError("BAD_REQUEST", 400);
  }
  if (!isRecord3(value)) throw new ApiError("BAD_REQUEST", 400);
  const p = value["path"];
  if (typeof p !== "string" || p.trim() === "" || p.length > MAX_LIBRARY_PATH_CHARS) {
    throw new ApiError("BAD_REQUEST", 400);
  }
  return p;
}
function createRoutes(deps) {
  const { store, scanner, library, exhume, clock } = deps;
  const getLibrary = () => {
    const s = library.getStatus();
    return Promise.resolve(json(200, { path: s.path, error: s.error }));
  };
  const putLibrary = async ({ body }) => {
    const requested = parseLibraryBody(body);
    const s = await library.setLibrary(requested);
    return json(200, { path: s.path, error: s.error });
  };
  const useDemo = async () => {
    const typed = library.getStatus().path;
    const result = await deps.copyDemo(typed);
    if (library.getRealPath() === null) {
      await library.setLibrary(typed);
    } else {
      scanner.triggerScan();
    }
    return json(200, { copied: [...result.copied], skipped: [...result.skipped] });
  };
  const scanStatus = () => Promise.resolve(json(200, scanner.getStatus()));
  const rescan = () => {
    const r = scanner.triggerScan();
    return Promise.resolve(json(202, { started: r.started, running: r.running }));
  };
  const listDisks = () => {
    const data = readCatalogue(store);
    return Promise.resolve(json(200, { disks: allViews(data) }));
  };
  const oneDisk = ({ params }) => {
    const data = readCatalogue(store);
    const card = requireCard(data, params["id"]);
    const files = readEntries(store, card);
    return Promise.resolve(
      json(200, {
        card: toCardView(card, data.annotations[card.diskId]),
        files,
        truncated: card.entriesTruncated,
        totalEntries: card.totalEntries
      })
    );
  };
  const preview = async ({ params, query }) => {
    const data = readCatalogue(store);
    const card = requireCard(data, params["id"]);
    const entryId = parseEntryId(query["entry"]);
    if (entryId === null) throw new ApiError("BAD_PARAMETER", 400);
    const entry = readEntries(store, card).find((e) => e.id === entryId);
    if (entry === void 0) throw new ApiError("NOT_FOUND", 404);
    if (entry.kind !== "file") throw new ApiError("BAD_REQUEST", 400);
    let grave;
    try {
      grave = await exhume.readGrave(card.relPath, entry.path, entry.id);
    } catch (err) {
      const timedOut = err instanceof ExhumeClientError && err.code === "EXHUME_TIMEOUT";
      throw new ApiError("PREVIEW_UNAVAILABLE", timedOut ? 504 : 502);
    }
    if (grave.format === "png") {
      let imageDataUrl = null;
      const record = data.exhumed[card.diskId]?.[String(entry.id)];
      const root = library.getRealPath();
      if (record !== void 0 && root !== null) {
        imageDataUrl = await readExhumedPng(root, record.outputPath);
      }
      const body2 = {
        kind: "png",
        width: grave.width,
        height: grave.height,
        bytes: grave.bytes,
        imageDataUrl,
        warnings: viewWarnings(grave.warnings)
      };
      return json(200, body2);
    }
    const cut = truncateUtf8(grave.text);
    const body = {
      kind: "text",
      format: grave.format,
      text: cut.text,
      truncated: grave.truncated || cut.truncated,
      warnings: viewWarnings(grave.warnings)
    };
    return json(200, body);
  };
  const exhumeAll = async ({ params }) => {
    const data = readCatalogue(store);
    const card = requireCard(data, params["id"]);
    const currentHash = await deps.hashImage(card.relPath, card.sizeBytes);
    if (currentHash !== card.diskId) {
      scanner.triggerScan();
      throw new ApiError("DISK_CHANGED", 409);
    }
    const recoverable = readEntries(store, card).filter(
      (e) => e.kind === "file" && (e.state === "alive" || e.state === "recovered")
    );
    const results = [];
    const saved = [];
    for (const entry of recoverable) {
      const shown = displayName(entry.path);
      try {
        const out = await exhume.exhume(card.relPath, entry.path, entry.id);
        const outputPath = displayName(out.path);
        results.push({ entry: entry.id, path: shown, outcome: "exhumed", outputPath });
        saved.push({ entry: entry.id, outputPath: out.path });
      } catch (err) {
        results.push({ entry: entry.id, path: shown, outcome: "failed", errorCode: toolErrorCode(err) });
      }
    }
    if (saved.length > 0) {
      const at = new Date(clock.now()).toISOString();
      store.update((draft) => {
        const forDisk = draft.exhumed[card.diskId] ?? {};
        for (const s of saved) forDisk[String(s.entry)] = { outputPath: s.outputPath, at };
        draft.exhumed[card.diskId] = forDisk;
      });
    }
    return json(200, { results });
  };
  const exportCsv = () => {
    const body = toCsv(allViews(readCatalogue(store)));
    return Promise.resolve({
      kind: "text",
      status: 200,
      contentType: "text/csv; charset=utf-8",
      fileName: "exhume-catalogue.csv",
      body
    });
  };
  const exportMarkdown = () => {
    const body = toMarkdown(allViews(readCatalogue(store)));
    return Promise.resolve({
      kind: "text",
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      fileName: "exhume-catalogue.md",
      body
    });
  };
  return [
    { method: "GET", pattern: ["api", "library"], query: [], handler: getLibrary },
    { method: "PUT", pattern: ["api", "library"], query: [], handler: putLibrary },
    { method: "POST", pattern: ["api", "library", "demo"], query: [], handler: useDemo },
    { method: "GET", pattern: ["api", "scan"], query: [], handler: scanStatus },
    { method: "POST", pattern: ["api", "scan"], query: [], handler: rescan },
    { method: "GET", pattern: ["api", "disks"], query: [], handler: listDisks },
    { method: "GET", pattern: ["api", "disks", ":id"], query: [], handler: oneDisk },
    { method: "GET", pattern: ["api", "disks", ":id", "preview"], query: ["entry"], handler: preview },
    { method: "POST", pattern: ["api", "disks", ":id", "exhume-all"], query: [], handler: exhumeAll },
    { method: "GET", pattern: ["api", "export", "csv"], query: [], handler: exportCsv },
    { method: "GET", pattern: ["api", "export", "markdown"], query: [], handler: exportMarkdown }
  ];
}
function matchRoute(routes, method, segments) {
  const allow = [];
  for (const route of routes) {
    if (route.pattern.length !== segments.length) continue;
    const params = /* @__PURE__ */ Object.create(null);
    let fits = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const want = route.pattern[i];
      const got = segments[i];
      if (want === void 0 || got === void 0) {
        fits = false;
        break;
      }
      if (want.startsWith(":")) params[want.slice(1)] = got;
      else if (want !== got) {
        fits = false;
        break;
      }
    }
    if (!fits) continue;
    if (route.method === method) return { kind: "match", route, params };
    allow.push(route.method);
  }
  return allow.length > 0 ? { kind: "method", allow } : { kind: "none" };
}
function allQueryNames(routes) {
  return [...new Set(routes.flatMap((r) => r.query))];
}

// backend/src/scanner.ts
import { createHash } from "node:crypto";
import { constants as fsConstants3, watch as fsWatch } from "node:fs";
import { lstat as lstat5, open as open2, readdir as readdir2, realpath as realpath3 } from "node:fs/promises";
import path5 from "node:path";
var MAX_DEPTH = 8;
var MAX_ENTRIES = 1e4;
var MAX_IMAGE_BYTES = 2949120;
var SECTOR_BYTES = 512;
var EXHUMED_DIR2 = "exhumed";
var IMAGE_EXTENSIONS = [".img", ".ima", ".dsk", ".flp", ".vfd"];
var IGNORED_NAMES = /* @__PURE__ */ new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
var SCAN_MESSAGES = {
  NAME_CONTROL_CHARS: "The file name contains control characters and was skipped.",
  SYMLINK_SKIPPED: "Symbolic links are never followed and were skipped.",
  NOT_A_DISK_IMAGE: "Not a disk image (wrong extension, empty, or size is not a multiple of 512 bytes).",
  TOO_LARGE: "The file is larger than 2,949,120 bytes and was skipped.",
  DEPTH_LIMIT: "A folder is nested deeper than 8 levels and was not entered.",
  ENTRY_LIMIT: "The library has more than 10,000 entries; the rest were not scanned.",
  OPEN_READONLY_FAILED: "The image could not be opened read-only and was skipped.",
  OUTSIDE_LIBRARY: "The image resolves outside the library and was skipped.",
  IMAGE_CHANGED: "The image changed while it was being read and was skipped.",
  WALK_FAILED: "A folder could not be read and was skipped.",
  EXHUME_FAILED: "The exhume tool could not read this disk image.",
  EXHUME_TIMEOUT: "The exhume tool took too long on this disk image.",
  EXHUME_RESTARTED: "The exhume tool stopped unexpectedly and was restarted.",
  STORE_FAILED: "The catalogue could not be updated for this disk image."
};
function warn(code, relPath) {
  const w = { code, message: SCAN_MESSAGES[code] };
  if (relPath !== null) w.path = displayName(relPath);
  return w;
}
function hasControlChar(name) {
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 31 || cp >= 127 && cp <= 159) return true;
  }
  return false;
}
function isIgnoredName(name) {
  return IGNORED_NAMES.has(name) || name.startsWith("._");
}
function hasImageExtension(name) {
  return IMAGE_EXTENSIONS.includes(path5.extname(name).toLowerCase());
}
async function discoverImages(root) {
  const candidates = [];
  const warnings = [];
  const addWarning = (w) => {
    if (warnings.length < CAPS.libraryWarnings) warnings.push(w);
  };
  let entriesSeen = 0;
  let depthWarned = false;
  let capHit = false;
  const stack = [{ absDir: root, relDir: "", depth: 1 }];
  while (stack.length > 0 && !capHit) {
    const item = stack.pop();
    if (item === void 0) break;
    let names;
    try {
      names = await readdir2(item.absDir);
    } catch {
      addWarning(warn("WALK_FAILED", item.relDir === "" ? null : item.relDir));
      continue;
    }
    names.sort();
    const subdirs = [];
    for (const name of names) {
      if (isIgnoredName(name)) continue;
      if (entriesSeen >= MAX_ENTRIES) {
        addWarning(warn("ENTRY_LIMIT", null));
        capHit = true;
        break;
      }
      entriesSeen++;
      const rel = item.relDir === "" ? name : `${item.relDir}/${name}`;
      if (hasControlChar(name)) {
        addWarning(warn("NAME_CONTROL_CHARS", rel));
        continue;
      }
      let st;
      try {
        st = await lstat5(path5.join(item.absDir, name));
      } catch {
        addWarning(warn("WALK_FAILED", rel));
        continue;
      }
      if (st.isSymbolicLink()) {
        addWarning(warn("SYMLINK_SKIPPED", rel));
      } else if (st.isDirectory()) {
        if (item.relDir === "" && name === EXHUMED_DIR2) continue;
        if (item.depth >= MAX_DEPTH) {
          if (!depthWarned) {
            depthWarned = true;
            addWarning(warn("DEPTH_LIMIT", rel));
          }
        } else {
          subdirs.push({ absDir: path5.join(item.absDir, name), relDir: rel, depth: item.depth + 1 });
        }
      } else if (st.isFile()) {
        if (st.size > MAX_IMAGE_BYTES) {
          addWarning(warn("TOO_LARGE", rel));
        } else if (st.size === 0 || st.size % SECTOR_BYTES !== 0 || !hasImageExtension(name)) {
          addWarning(warn("NOT_A_DISK_IMAGE", rel));
        } else {
          candidates.push({ relPath: rel, size: st.size, mtimeMs: st.mtimeMs });
        }
      } else {
        addWarning(warn("NOT_A_DISK_IMAGE", rel));
      }
    }
    for (let i = subdirs.length - 1; i >= 0; i--) {
      const d = subdirs[i];
      if (d !== void 0) stack.push(d);
    }
  }
  return { candidates, warnings, entriesSeen };
}
async function hashCandidate(root, candidate) {
  const abs = path5.join(root, ...candidate.relPath.split("/"));
  let handle;
  try {
    handle = await open2(abs, fsConstants3.O_RDONLY | fsConstants3.O_NOFOLLOW);
  } catch {
    return { ok: false, warning: warn("OPEN_READONLY_FAILED", candidate.relPath) };
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size !== candidate.size || st.size > MAX_IMAGE_BYTES) {
      return { ok: false, warning: warn("IMAGE_CHANGED", candidate.relPath) };
    }
    let inside = false;
    try {
      const real = await realpath3(abs);
      inside = await isWithin(await realpath3(root), real);
    } catch {
      inside = false;
    }
    if (!inside) return { ok: false, warning: warn("OUTSIDE_LIBRARY", candidate.relPath) };
    const buf = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < st.size) {
      const { bytesRead } = await handle.read(buf, offset, st.size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== st.size) {
      return { ok: false, warning: warn("IMAGE_CHANGED", candidate.relPath) };
    }
    const sha256 = createHash("sha256").update(buf).digest("hex");
    return { ok: true, image: { relPath: candidate.relPath, size: st.size, sha256 } };
  } catch {
    return { ok: false, warning: warn("OPEN_READONLY_FAILED", candidate.relPath) };
  } finally {
    await handle.close().catch(() => void 0);
  }
}
var DISK_BUDGET_MS = 3e4;
var MAX_GRAVE_READS = 64;
var DEBOUNCE_MS = 2e3;
var POLL_MS = 15e3;
var MAX_POLLS = 2e4;
var realTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle);
  }
};
var realClock = { now: () => Date.now() };
var realWatch = (root, onChange, onError) => {
  const watcher = fsWatch(root, { recursive: true, persistent: false }, (_event, filename) => {
    onChange(typeof filename === "string" ? filename : null);
  });
  watcher.on("error", onError);
  return { close: () => watcher.close() };
};
var ScanFailure = class extends Error {
  code;
  constructor(code) {
    super(ERROR_MESSAGES[code]);
    this.name = "ScanFailure";
    this.code = code;
  }
};
var BudgetExceeded = class extends Error {
  constructor() {
    super("per-disk budget exceeded");
    this.name = "BudgetExceeded";
  }
};
function fingerprintOf(candidates) {
  return candidates.map((c) => `${c.relPath}|${c.size}|${c.mtimeMs}`).join("\n");
}
function isExhumedName(name) {
  return name.split(/[\\/]/, 1)[0] === EXHUMED_DIR2;
}
function emptyStatus() {
  return {
    state: "idle",
    scanned: 0,
    total: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    libraryWarnings: []
  };
}
function placeholderCard(rel, image, firstSeen) {
  return {
    diskId: image.sha256,
    relPath: rel,
    label: "",
    sizeBytes: image.size,
    geometry: { source: "none", label: null },
    fileCount: 0,
    totalEntries: 0,
    entriesTruncated: false,
    dateFirst: null,
    dateLast: null,
    formats: [],
    counts: { alive: 0, recovered: 0, partial: 0, lost: 0 },
    warnings: [],
    status: "new",
    firstSeen
  };
}
function toFilesDoc(diskId, report) {
  const entries = report.entries.map((e) => {
    const entry = {
      id: e.id,
      path: e.path,
      kind: e.kind,
      state: e.state,
      size: e.size,
      date: e.date
    };
    if (e.reason !== void 0) entry.reason = e.reason.slice(0, CAPS.reason);
    return entry;
  });
  return { schemaVersion: 1, diskId, totalEntries: report.totalEntries, truncated: report.truncated, entries };
}
var Scanner = class {
  client;
  store;
  clock;
  timers;
  watchFn;
  budgetMs;
  debounceMs;
  pollMs;
  maxPolls;
  root;
  status = emptyStatus();
  running = false;
  pendingRescan = false;
  current = Promise.resolve();
  fingerprint = null;
  watching = false;
  watchHandle = null;
  debounceTimer = null;
  pollTimer = null;
  pollsLeft = 0;
  polling = false;
  constructor(options) {
    this.client = options.client;
    this.store = options.store;
    this.root = options.root;
    this.clock = options.clock ?? realClock;
    this.timers = options.timers ?? realTimers;
    this.watchFn = options.watch ?? realWatch;
    this.budgetMs = options.diskBudgetMs ?? DISK_BUDGET_MS;
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.pollMs = options.pollMs ?? POLL_MS;
    this.maxPolls = options.maxPolls ?? MAX_POLLS;
  }
  // ------------------------------------------------------------- public
  /** Copy of the in-memory scan status. */
  getStatus() {
    return { ...this.status, error: this.status.error === null ? null : { ...this.status.error }, libraryWarnings: [...this.status.libraryWarnings] };
  }
  /** Resolves when no scan is running (including a queued follow-up scan). */
  async idle() {
    for (let i = 0; i < 8 && this.running; i++) await this.current;
  }
  /** Starts a scan unless one is already running; never touches a running scan. */
  triggerScan() {
    if (this.running) return { started: false, running: true };
    this.running = true;
    this.current = this.run();
    return { started: true, running: true };
  }
  /** Runs the initial scan and starts the watcher. */
  start() {
    this.triggerScan();
    this.startWatching();
  }
  /** Stops the watcher, polling and any pending debounce. A running scan finishes. */
  stop() {
    this.stopWatching();
    this.pendingRescan = false;
  }
  /** Points the scanner at a new Library_Root; the watcher follows. */
  setRoot(root) {
    if (root === this.root) return;
    this.root = root;
    this.fingerprint = null;
    if (this.running) this.pendingRescan = true;
    if (this.watching) {
      this.stopWatching();
      this.startWatching();
    }
  }
  startWatching() {
    if (this.watching) return;
    this.watching = true;
    try {
      this.watchHandle = this.watchFn(
        this.root,
        (name) => {
          if (name !== null && isExhumedName(name)) return;
          this.scheduleDebounced();
        },
        () => this.fallBackToPolling()
      );
    } catch {
      this.watchHandle = null;
      this.startPolling();
    }
  }
  stopWatching() {
    this.watching = false;
    this.closeWatchHandle();
    if (this.debounceTimer !== null) this.timers.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.pollTimer !== null) this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollsLeft = 0;
  }
  // ------------------------------------------------------------ watcher
  closeWatchHandle() {
    const handle = this.watchHandle;
    this.watchHandle = null;
    if (handle === null) return;
    try {
      handle.close();
    } catch {
    }
  }
  scheduleDebounced() {
    if (!this.watching) return;
    if (this.debounceTimer !== null) this.timers.clearTimeout(this.debounceTimer);
    this.debounceTimer = this.timers.setTimeout(() => {
      this.debounceTimer = null;
      if (!this.watching) return;
      if (this.running) this.pendingRescan = true;
      else this.triggerScan();
    }, this.debounceMs);
  }
  fallBackToPolling() {
    if (!this.watching) return;
    this.closeWatchHandle();
    this.startPolling();
  }
  startPolling() {
    if (this.pollTimer !== null) return;
    this.pollsLeft = this.maxPolls;
    this.schedulePoll();
  }
  schedulePoll() {
    if (!this.watching || this.pollsLeft <= 0) return;
    this.pollsLeft--;
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce().then(() => {
        if (this.watching && this.pollTimer === null) this.schedulePoll();
      });
    }, this.pollMs);
  }
  async pollOnce() {
    if (this.polling) return;
    this.polling = true;
    try {
      const { candidates } = await discoverImages(this.root);
      const next = fingerprintOf(candidates);
      const previous = this.fingerprint;
      this.fingerprint = next;
      if (previous !== null && previous !== next) this.scheduleDebounced();
    } catch {
    } finally {
      this.polling = false;
    }
  }
  // --------------------------------------------------------------- scan
  async run() {
    try {
      await this.scan();
    } catch (err) {
      const code = err instanceof ScanFailure ? err.code : "INTERNAL_ERROR";
      this.status = {
        ...this.status,
        state: "failed",
        error: { code, message: ERROR_MESSAGES[code] },
        finishedAt: new Date(this.clock.now()).toISOString()
      };
    } finally {
      this.running = false;
      if (this.pendingRescan) {
        this.pendingRescan = false;
        this.triggerScan();
      }
    }
  }
  nowIso() {
    return new Date(this.clock.now()).toISOString();
  }
  readCatalogue() {
    let result = this.store.read();
    if (!result.ok) result = this.store.read();
    if (!result.ok) throw new ScanFailure(result.error.code);
    return result.value;
  }
  addLibraryWarning(w) {
    if (this.status.libraryWarnings.length < CAPS.libraryWarnings) this.status.libraryWarnings.push(w);
  }
  async scan() {
    const root = this.root;
    this.status = { ...emptyStatus(), state: "running", startedAt: this.nowIso() };
    const discovery = await discoverImages(root);
    this.fingerprint = fingerprintOf(discovery.candidates);
    for (const w of discovery.warnings) this.addLibraryWarning(w);
    this.status.total = discovery.candidates.length;
    const incomplete = discovery.warnings.length >= CAPS.libraryWarnings || discovery.warnings.some((w) => w.code === "WALK_FAILED" || w.code === "ENTRY_LIMIT");
    const snapshot = this.readCatalogue();
    const handled = /* @__PURE__ */ new Set();
    const present = /* @__PURE__ */ new Set();
    let rootChanged = false;
    for (const candidate of discovery.candidates) {
      if (this.root !== root) {
        rootChanged = true;
        break;
      }
      present.add(candidate.relPath);
      const hashed = await hashCandidate(root, candidate);
      if (!hashed.ok) {
        this.addLibraryWarning(hashed.warning);
      } else {
        await this.processImage(root, hashed.image, snapshot, handled);
      }
      this.status.scanned++;
    }
    if (!rootChanged && !incomplete) this.prune(present);
    this.status = { ...this.status, state: "idle", finishedAt: this.nowIso() };
  }
  mapPath(rel, diskId) {
    const now = this.nowIso();
    return this.store.update((draft) => {
      if (draft.cards[diskId] === void 0) return;
      draft.paths[rel] = { diskId, firstSeen: draft.paths[rel]?.firstSeen ?? now };
    }).ok;
  }
  async processImage(root, image, snapshot, handled) {
    const rel = image.relPath;
    const id = image.sha256;
    const existing = snapshot.cards[id];
    if (handled.has(id) || existing !== void 0 && existing.status !== "new") {
      handled.add(id);
      if (snapshot.paths[rel]?.diskId === id && existing !== void 0) return;
      if (!this.mapPath(rel, id)) this.addLibraryWarning(this.storeWarning(rel));
      return;
    }
    handled.add(id);
    const now = this.nowIso();
    const placed = this.store.update((draft) => {
      const firstSeen = draft.paths[rel]?.firstSeen ?? now;
      draft.paths[rel] = { diskId: id, firstSeen };
      if (draft.cards[id] === void 0) draft.cards[id] = placeholderCard(rel, image, firstSeen);
    });
    if (!placed.ok) {
      this.addLibraryWarning(this.storeWarning(rel));
      return;
    }
    const warnings = [];
    try {
      const { report, formats } = await this.readDisk(rel);
      const wrote = this.store.writeFiles(id, toFilesDoc(id, report));
      if (!wrote.ok) throw new ScanFailure(wrote.error.code);
      const stored = this.store.update((draft) => {
        const firstSeen = draft.paths[rel]?.firstSeen ?? now;
        draft.paths[rel] = { diskId: id, firstSeen };
        const previous = draft.cards[id];
        draft.cards[id] = deriveCard({
          diskId: id,
          relPath: previous?.relPath ?? rel,
          sizeBytes: image.size,
          firstSeen: previous?.firstSeen ?? firstSeen,
          report,
          formats,
          hasSummary: draft.annotations[id]?.summary != null
        });
      });
      if (!stored.ok) throw new ScanFailure(stored.error.code);
      return;
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        warnings.push(warn("EXHUME_TIMEOUT", null));
      } else if (err instanceof ExhumeClientError) {
        if (err.code === "EXHUME_TIMEOUT") {
          warnings.push(warn("EXHUME_TIMEOUT", null));
        } else {
          warnings.push(warn("EXHUME_FAILED", null), warn("EXHUME_RESTARTED", null));
        }
        await this.client.restart(root).catch(() => void 0);
      } else if (err instanceof ScanFailure) {
        warnings.push(warn("STORE_FAILED", null));
      } else {
        warnings.push(warn("EXHUME_FAILED", null));
      }
    }
    this.store.update((draft) => {
      const card = draft.cards[id];
      if (card === void 0 || card.status !== "new") return;
      card.warnings = warnings.slice(0, CAPS.warnings);
    });
  }
  storeWarning(rel) {
    return warn("STORE_FAILED", rel);
  }
  /** `open_disk`, then up to 64 `read_grave` calls, all inside one per-disk budget. */
  async readDisk(rel) {
    const deadline = this.clock.now() + this.budgetMs;
    const report = await this.client.openDisk(rel);
    if (this.clock.now() > deadline) throw new BudgetExceeded();
    const formats = /* @__PURE__ */ new Set();
    let reads = 0;
    for (const entry of report.entries) {
      if (reads >= MAX_GRAVE_READS) break;
      if (entry.kind !== "file" || entry.state === "lost") continue;
      if (this.clock.now() > deadline) throw new BudgetExceeded();
      reads++;
      try {
        const grave = await this.client.readGrave(rel, entry.path, entry.id);
        formats.add(grave.format);
      } catch (err) {
        if (err instanceof ExhumeClientError) throw err;
      }
    }
    if (this.clock.now() > deadline) throw new BudgetExceeded();
    return { report, formats: [...formats] };
  }
  /** Removes paths whose files vanished and cards that no path maps to. */
  prune(present) {
    this.store.update((draft) => {
      for (const p of Object.keys(draft.paths)) {
        if (!present.has(p)) delete draft.paths[p];
      }
      const firstPath = /* @__PURE__ */ new Map();
      for (const p of Object.keys(draft.paths).sort()) {
        const rec = draft.paths[p];
        if (rec !== void 0 && !firstPath.has(rec.diskId)) firstPath.set(rec.diskId, p);
      }
      for (const id of Object.keys(draft.cards)) {
        const card = draft.cards[id];
        const first = firstPath.get(id);
        if (card === void 0) continue;
        if (first === void 0) {
          delete draft.cards[id];
        } else if (draft.paths[card.relPath]?.diskId !== id) {
          card.relPath = first;
        }
      }
    });
  }
};

// backend/src/server.ts
import http from "node:http";

// backend/src/auth.ts
import { createHash as createHash2, createHmac, timingSafeEqual } from "node:crypto";
var PROXY_HEADER_NAMES = ["x-kirocrew-proxy", "x-crew-proxy"];
var MAX_SKEW_SECONDS = 60;
var MAX_TS_DIGITS = 12;
var TS_PATTERN = /^[0-9]{1,12}$/;
var HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
function verifyProxyRequest(input) {
  const { headerValue, method, target, body, secret, now } = input;
  if (typeof secret !== "string" || secret.length === 0) return false;
  if (typeof headerValue !== "string") return false;
  if (!Number.isFinite(now)) return false;
  const parts = headerValue.split(":");
  if (parts.length !== 2) return false;
  const ts = parts[0];
  const hex = parts[1];
  if (ts === void 0 || hex === void 0) return false;
  if (ts.length > MAX_TS_DIGITS || !TS_PATTERN.test(ts)) return false;
  if (!HEX_PATTERN.test(hex)) return false;
  const tsNumber = Number(ts);
  if (!Number.isSafeInteger(tsNumber)) return false;
  if (Math.abs(now - tsNumber) > MAX_SKEW_SECONDS) return false;
  const bodyHash = createHash2("sha256").update(body).digest("hex");
  const message = `${ts}:${method.toUpperCase()}:${target}:${bodyHash}`;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(message).digest();
  const provided = Buffer.from(hex, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
function readProxyHeader(headers) {
  for (const name of PROXY_HEADER_NAMES) {
    const value = headers[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") return value[0];
  }
  return void 0;
}

// backend/src/server.ts
var MAX_BODY_BYTES = 64 * 1024;
var LISTEN_HOST = "127.0.0.1";
var HEALTH_PATH = "/health";
var BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store"
};
function send(res, status, contentType, payload, extra = {}, close = false) {
  if (res.headersSent || res.writableEnded) return;
  const bytes = Buffer.from(payload, "utf8");
  const headers = {
    ...BASE_HEADERS,
    ...extra,
    "Content-Type": contentType,
    "Content-Length": bytes.length
  };
  if (close) headers["Connection"] = "close";
  res.writeHead(status, headers);
  res.end(bytes);
}
function sendJson(res, status, body, close = false) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), {}, close);
}
function sendError(res, err, close = false) {
  const out = toErrorResponse(err);
  sendJson(res, out.status, out.body, close);
}
function sendResult(res, result) {
  if (result.kind === "json") {
    sendJson(res, result.status, result.body);
    return;
  }
  const name = sanitizeFileName(result.fileName);
  send(res, result.status, result.contentType, result.body, {
    "Content-Disposition": `attachment; filename="${name}"`
  });
}
function readBody(req) {
  return new Promise((resolve2) => {
    const declared = req.headers["content-length"];
    if (typeof declared === "string") {
      const n = Number(declared);
      if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
        resolve2({ ok: false, tooLarge: true });
        return;
      }
    }
    const chunks = [];
    let total = 0;
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      req.removeListener("data", onData);
      resolve2(outcome);
    };
    const onData = (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        chunks.length = 0;
        finish({ ok: false, tooLarge: true });
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.once("end", () => finish({ ok: true, body: Buffer.concat(chunks) }));
    req.once("error", () => finish({ ok: false, tooLarge: false }));
    req.once("aborted", () => finish({ ok: false, tooLarge: false }));
  });
}
function isHealthRequest(req) {
  return req.method === "GET" && req.url === HEALTH_PATH;
}
function createRequestListener(options) {
  const now = options.now ?? (() => Date.now());
  const queryNames = allQueryNames(options.routes);
  const handle = async (req, res) => {
    if (isHealthRequest(req)) {
      sendJson(res, 200, { ok: true });
      return;
    }
    const method = req.method ?? "";
    const target = req.url ?? "";
    const headerValue = readProxyHeader(req.headers);
    if (headerValue === void 0) {
      sendError(res, new ApiError("UNAUTHORIZED", 401), true);
      return;
    }
    const body = await readBody(req);
    if (!body.ok) {
      sendError(res, body.tooLarge ? new ApiError("BODY_TOO_LARGE", 413) : new ApiError("BAD_REQUEST", 400), true);
      return;
    }
    const verified = verifyProxyRequest({
      headerValue,
      method,
      target,
      body: body.body,
      secret: options.secret,
      now: Math.floor(now() / 1e3)
    });
    if (!verified) {
      sendError(res, new ApiError("UNAUTHORIZED", 401));
      return;
    }
    const guarded = guardParams(target, queryNames);
    if (!guarded.ok) {
      sendError(res, guarded.error);
      return;
    }
    const match = matchRoute(options.routes, method, guarded.params.segments);
    if (match.kind === "none") {
      sendError(res, new ApiError("NOT_FOUND", 404));
      return;
    }
    if (match.kind === "method") {
      if (!res.headersSent) res.setHeader("Allow", match.allow.join(", "));
      sendError(res, new ApiError("METHOD_NOT_ALLOWED", 405));
      return;
    }
    const allowedQuery = match.route.query;
    if (Object.keys(guarded.params.query).some((k) => !allowedQuery.includes(k))) {
      sendError(res, new ApiError("BAD_PARAMETER", 400));
      return;
    }
    try {
      const result = await match.route.handler({
        params: match.params,
        query: guarded.params.query,
        body: body.body
      });
      sendResult(res, result);
    } catch (err) {
      sendError(res, err);
    }
  };
  return (req, res) => {
    handle(req, res).catch((err) => {
      sendError(res, err);
    });
  };
}
function createApiServer(options) {
  const server = http.createServer(createRequestListener(options));
  server.on("clientError", (_err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    else socket.destroy();
  });
  return server;
}
function listen(server, port) {
  return new Promise((resolve2, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(port, LISTEN_HOST, () => {
      server.removeListener("error", onError);
      const address = server.address();
      resolve2(typeof address === "object" && address !== null ? address.port : port);
    });
  });
}

// backend/src/main.ts
var APP_VERSION = "0.1.0";
var APP_NAME = "exhume-crew";
var MAX_ROOT_SEARCH_LEVELS = 4;
var SHUTDOWN_GRACE_MS = 2e3;
function fail(message) {
  process.stderr.write(`exhume-crew backend: ${message}
`);
  process.exit(1);
}
function findAppRoot() {
  let dir = path6.dirname(realpathSync(fileURLToPath(import.meta.url)));
  for (let i = 0; i < MAX_ROOT_SEARCH_LEVELS; i++) {
    if (existsSync(path6.join(dir, "mcp", "exhume-mcp.mjs"))) return dir;
    const parent = path6.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fail("cannot locate the app folder (mcp/exhume-mcp.mjs not found).");
}
function parsePort(value) {
  if (value === void 0 || !/^[0-9]{1,5}$/.test(value)) return fail("PORT is not set to a valid port.");
  const port = Number(value);
  if (port < 1 || port > 65535) return fail("PORT is not set to a valid port.");
  return port;
}
function warnIfRootDisagrees(appRoot) {
  const home = process.env["KIROCREW_HOME"];
  const name = process.env["KIROCREW_APP_NAME"];
  if (home === void 0 || name === void 0) return;
  try {
    const expected = realpathSync(path6.join(home, "apps", name));
    if (expected !== appRoot) {
      process.stderr.write("exhume-crew backend: warning: app folder differs from KIROCREW_HOME.\n");
    }
  } catch {
    process.stderr.write("exhume-crew backend: warning: KIROCREW_HOME app folder could not be checked.\n");
  }
}
async function main() {
  const version = checkNodeVersion(process.version);
  if (!version.ok) fail(version.message);
  const port = parsePort(process.env["PORT"]);
  const secret = process.env["KIROCREW_PROXY_SECRET"];
  if (secret === void 0 || secret === "") {
    process.stderr.write("exhume-crew backend: warning: no proxy secret; every API request will be refused.\n");
  }
  const appRoot = findAppRoot();
  warnIfRootDisagrees(appRoot);
  const dataDir = path6.join(appRoot, "data");
  const home = homedir2();
  const store = createStore(dataDir);
  let scanner = null;
  const client = new StdioExhumeClient({
    appRoot,
    libraryRoot: path6.join(dataDir, "no-library"),
    version: APP_VERSION
  });
  const ensureScanner = (root) => {
    if (scanner === null) {
      scanner = new Scanner({ client, store, root });
      scanner.startWatching();
    } else {
      scanner.setRoot(root);
    }
    return scanner;
  };
  const library = new LibraryManager({
    dataDir,
    home,
    restartExhume: async (real) => {
      await client.restart(real);
      ensureScanner(real);
    },
    triggerScan: () => {
      scanner?.triggerScan();
    }
  });
  const status = await library.init();
  const initialRoot = library.getRealPath();
  if (initialRoot !== null) {
    await client.restart(initialRoot);
    ensureScanner(initialRoot).start();
  } else {
    process.stderr.write(`exhume-crew backend: no usable library (${status.error?.code ?? "none"}).
`);
  }
  const scannerPort = {
    getStatus: () => scanner?.getStatus() ?? {
      state: "idle",
      scanned: 0,
      total: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
      libraryWarnings: []
    },
    triggerScan: () => scanner?.triggerScan() ?? { started: false, running: false }
  };
  const routes = createRoutes({
    store,
    scanner: scannerPort,
    library,
    exhume: client,
    copyDemo: (typedPath) => {
      const expanded = typedPath === "~" ? home : typedPath.startsWith("~/") ? path6.join(home, typedPath.slice(2)) : typedPath;
      return copyDemoLibrary(appRoot, expanded, { userInitiated: true, home });
    },
    hashImage: async (relPath, sizeBytes) => {
      const root = library.getRealPath();
      if (root === null) return null;
      const outcome = await hashCandidate(root, { relPath, size: sizeBytes, mtimeMs: 0 });
      return outcome.ok ? outcome.image.sha256 : null;
    },
    clock: { now: () => Date.now() }
  });
  const server = createApiServer({ secret, routes });
  await listen(server, port);
  process.stderr.write(`exhume-crew backend: listening on 127.0.0.1:${port}
`);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
    timer.unref();
    scanner?.stop();
    client.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
process.on("unhandledRejection", () => {
  process.stderr.write("exhume-crew backend: an unexpected error was ignored.\n");
});
main().catch(() => {
  fail(`could not start (${APP_NAME}).`);
});
