/**
 * Sanitisers for untrusted text (agent text, CSV cells, display names, download names).
 * Pure functions, no I/O.
 */

/** Name used when a download file name has nothing usable left. */
export const FALLBACK_FILE_NAME = "exhume-export";

const MAX_FILE_NAME_LENGTH = 255;

/** Replaces lone surrogates with U+FFFD (same result as String.prototype.toWellFormed). */
function toWellFormed(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text.slice(i, i + 2);
        i++;
      } else {
        out += "\uFFFD";
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}

/** C0 controls, DEL and C1 controls. */
function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/** Zero-width chars, line/paragraph separators, bidi embedding/override/isolate controls and the BOM. */
function isInvisibleFormat(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200d) ||
    cp === 0x2060 ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

function filterCodePoints(text: string, drop: (cp: number) => boolean): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!drop(cp)) out += ch;
  }
  return out;
}

/**
 * Agent text rule: well-formed UTF-16, then every control, separator, bidi control
 * and BOM code point is removed. Idempotent.
 */
export function sanitizeAgentText(text: string): string {
  return filterCodePoints(toWellFormed(text), (cp) => isControl(cp) || isInvisibleFormat(cp));
}

const FORMULA_PREFIXES: ReadonlySet<string> = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * CSV cell text: removes control characters except tab, CR and LF, then prefixes a single
 * quote when the first character could start a spreadsheet formula.
 */
export function cellText(value: string): string {
  const cleaned = filterCodePoints(
    toWellFormed(value),
    (cp) => isControl(cp) && cp !== 0x09 && cp !== 0x0d && cp !== 0x0a,
  );
  const first = cleaned.charAt(0);
  return FORMULA_PREFIXES.has(first) ? `'${cleaned}` : cleaned;
}

/**
 * Display form of a relative path or label: controls (line breaks and tabs become a space),
 * separators, bidi controls and the BOM are removed.
 */
export function displayName(value: string): string {
  let out = "";
  for (const ch of toWellFormed(value)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x2028 || cp === 0x2029) {
      out += " ";
    } else if (!isControl(cp) && !isInvisibleFormat(cp)) {
      out += ch;
    }
  }
  return out;
}

/**
 * Download file name: only A-Z, a-z, 0-9, '.', '-', '_' (everything else becomes '_'),
 * at most 255 characters, a fixed fallback when nothing meaningful remains.
 */
export function sanitizeFileName(name: string): string {
  let out = "";
  for (const ch of toWellFormed(name)) {
    out += /^[A-Za-z0-9._-]$/.test(ch) ? ch : "_";
  }
  out = out.slice(0, MAX_FILE_NAME_LENGTH);
  if (out === "" || /^\.+$/.test(out)) return FALLBACK_FILE_NAME;
  return out;
}
