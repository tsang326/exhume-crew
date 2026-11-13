/**
 * API error values. Every message comes from a fixed table of constants.
 * `err.message`, stack traces and absolute paths are never copied into a
 * response (Requirement 7.6).
 */

/** Fixed message per error code. Messages never contain a path or user text. */
export const ERROR_MESSAGES = {
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
  INTERNAL_ERROR: "Something went wrong.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string };
}

export interface ErrorResponse {
  readonly status: number;
  readonly body: ErrorBody;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number) {
    super(ERROR_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Last-resort backstop for text that was not built from constants: replaces
 * any run of one or more `/segment` parts (an absolute path) with `<path>`.
 * A slash that follows a word character (as in "and/or") is left alone.
 */
export function redactPaths(text: string): string {
  return text
    .replace(/(?<![\w.~-])(?:\/[^\s/"'`<>|:;,()[\]{}\\]+)+\/?/g, "<path>")
    .replace(/(?<![\w])[A-Za-z]:\\(?:[^\s\\"'`<>|:;,()[\]{}]+\\?)*/g, "<path>");
}

function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}

/**
 * Maps any thrown value to a safe response. Only `ApiError` carries its code
 * and status through; everything else becomes a 500 `INTERNAL_ERROR`.
 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof ApiError && isErrorCode(err.code)) {
    const status =
      Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
    return {
      status,
      body: { error: { code: err.code, message: redactPaths(ERROR_MESSAGES[err.code]) } },
    };
  }
  return {
    status: 500,
    body: {
      error: { code: "INTERNAL_ERROR", message: redactPaths(ERROR_MESSAGES.INTERNAL_ERROR) },
    },
  };
}
