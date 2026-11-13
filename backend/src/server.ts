/**
 * HTTP server for the Page API (Requirement 7). Bound to 127.0.0.1 only.
 *
 * Per request, in this order:
 *   1. `/health` (GET) answers `{"ok":true}` with no signature and does nothing else;
 *   2. the Proxy_Signature header must be present, else 401;
 *   3. the body is read, capped at 64 KiB, else 413;
 *   4. the HMAC is verified over method, raw target and body, else 401 (no handler runs);
 *   5. the parameter guard runs on the URL;
 *   6. the route handler runs.
 * Every response carries `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sanitizeFileName } from "../../src/shared/sanitize";
import { readProxyHeader, verifyProxyRequest } from "./auth";
import { ApiError, toErrorResponse } from "./errors";
import { guardParams } from "./params";
import { allQueryNames, matchRoute } from "./routes";
import type { Route, RouteResult } from "./routes";

export const MAX_BODY_BYTES = 64 * 1024;
export const LISTEN_HOST = "127.0.0.1";
export const HEALTH_PATH = "/health";

export interface ServerOptions {
  /** Per-app secret; when missing or empty every Page_API request is refused (fails closed). */
  secret: string | undefined;
  routes: readonly Route[];
  /** Milliseconds since the epoch. */
  now?: () => number;
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
} as const;

type BodyOutcome =
  | { readonly ok: true; readonly body: Buffer }
  | { readonly ok: false; readonly tooLarge: true }
  | { readonly ok: false; readonly tooLarge: false };

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  payload: string,
  extra: Readonly<Record<string, string>> = {},
  close = false,
): void {
  if (res.headersSent || res.writableEnded) return;
  const bytes = Buffer.from(payload, "utf8");
  const headers: Record<string, string | number> = {
    ...BASE_HEADERS,
    ...extra,
    "Content-Type": contentType,
    "Content-Length": bytes.length,
  };
  if (close) headers["Connection"] = "close";
  res.writeHead(status, headers);
  res.end(bytes);
}

function sendJson(res: ServerResponse, status: number, body: unknown, close = false): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), {}, close);
}

function sendError(res: ServerResponse, err: unknown, close = false): void {
  const out = toErrorResponse(err);
  sendJson(res, out.status, out.body, close);
}

function sendResult(res: ServerResponse, result: RouteResult): void {
  if (result.kind === "json") {
    sendJson(res, result.status, result.body);
    return;
  }
  const name = sanitizeFileName(result.fileName);
  send(res, result.status, result.contentType, result.body, {
    "Content-Disposition": `attachment; filename="${name}"`,
  });
}

/** Reads the request body, giving up as soon as it passes the cap. */
function readBody(req: IncomingMessage): Promise<BodyOutcome> {
  return new Promise<BodyOutcome>((resolve) => {
    const declared = req.headers["content-length"];
    if (typeof declared === "string") {
      const n = Number(declared);
      if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
        resolve({ ok: false, tooLarge: true });
        return;
      }
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (outcome: BodyOutcome): void => {
      if (done) return;
      done = true;
      req.removeListener("data", onData);
      resolve(outcome);
    };
    const onData = (chunk: Buffer): void => {
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

function isHealthRequest(req: IncomingMessage): boolean {
  return req.method === "GET" && req.url === HEALTH_PATH;
}

export function createRequestListener(
  options: ServerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const now = options.now ?? ((): number => Date.now());
  const queryNames = allQueryNames(options.routes);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (isHealthRequest(req)) {
      sendJson(res, 200, { ok: true });
      return;
    }

    const method = req.method ?? "";
    const target = req.url ?? "";

    // (1) A signature header must be present before anything else happens.
    const headerValue = readProxyHeader(req.headers);
    if (headerValue === undefined) {
      sendError(res, new ApiError("UNAUTHORIZED", 401), true);
      return;
    }

    // (2) Body, capped.
    const body = await readBody(req);
    if (!body.ok) {
      sendError(res, body.tooLarge ? new ApiError("BODY_TOO_LARGE", 413) : new ApiError("BAD_REQUEST", 400), true);
      return;
    }

    // (3) HMAC before any handler looks at parameters or body.
    const verified = verifyProxyRequest({
      headerValue,
      method,
      target,
      body: body.body,
      secret: options.secret,
      now: Math.floor(now() / 1000),
    });
    if (!verified) {
      sendError(res, new ApiError("UNAUTHORIZED", 401));
      return;
    }

    // (4) Parameter guard.
    const guarded = guardParams(target, queryNames);
    if (!guarded.ok) {
      sendError(res, guarded.error);
      return;
    }

    // (5) Route and handler.
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
        body: body.body,
      });
      sendResult(res, result);
    } catch (err) {
      sendError(res, err);
    }
  };

  return (req, res) => {
    handle(req, res).catch((err: unknown) => {
      sendError(res, err);
    });
  };
}

export function createApiServer(options: ServerOptions): http.Server {
  const server = http.createServer(createRequestListener(options));
  server.on("clientError", (_err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    else socket.destroy();
  });
  return server;
}

/** Starts listening on 127.0.0.1. Port 0 picks a free port (tests). */
export function listen(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(port, LISTEN_HOST, () => {
      server.removeListener("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    });
  });
}
