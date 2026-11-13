/**
 * Minimal Markdown parser for the Disk page preview.
 *
 * Pure TypeScript: no DOM, no React. It produces a tree that contains only
 * heading, paragraph, list, list item, emphasis, strong, code and text nodes.
 * Links and images are not interpreted (their syntax stays as literal text),
 * and raw HTML is never interpreted (it stays as literal text). No node carries
 * an attribute derived from the source other than the heading level and the
 * list ordering flag, both of which are computed here, not copied.
 *
 * Requirements 14.3, 15.9.
 */

export type MdText = { readonly type: 'text'; readonly text: string };
export type MdCode = { readonly type: 'code'; readonly text: string };
export type MdEmphasis = { readonly type: 'emphasis'; readonly children: readonly MdInline[] };
export type MdStrong = { readonly type: 'strong'; readonly children: readonly MdInline[] };
export type MdInline = MdText | MdCode | MdEmphasis | MdStrong;

export type MdHeading = {
  readonly type: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly children: readonly MdInline[];
};
export type MdParagraph = { readonly type: 'paragraph'; readonly children: readonly MdInline[] };
export type MdListItem = { readonly type: 'list-item'; readonly children: readonly MdInline[] };
export type MdList = {
  readonly type: 'list';
  readonly ordered: boolean;
  readonly items: readonly MdListItem[];
};

/** A block-level node. Fenced code blocks are a `code` node. */
export type MdBlock = MdHeading | MdParagraph | MdList | MdCode;

export type MdNode = MdBlock | MdListItem | MdInline;

const MAX_INLINE_DEPTH = 4;

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_RE = /^[ \t]{0,}([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function pushText(out: MdInline[], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last !== undefined && last.type === 'text') {
    out[out.length - 1] = { type: 'text', text: last.text + text };
  } else {
    out.push({ type: 'text', text });
  }
}

/** Parse inline syntax: `code`, **strong**, *emphasis*, _emphasis_. Everything else is text. */
export function parseInline(src: string, depth = 0): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '`') {
      const close = src.indexOf('`', i + 1);
      if (close > i + 1) {
        out.push({ type: 'code', text: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (depth < MAX_INLINE_DEPTH && (ch === '*' || ch === '_')) {
      if (src.startsWith(ch + ch, i)) {
        const close = src.indexOf(ch + ch, i + 2);
        const inner = close > i + 2 ? src.slice(i + 2, close) : '';
        if (inner !== '' && !/^\s|\s$/.test(inner) && (ch === '*' || !isWordChar(src[i - 1]))) {
          out.push({ type: 'strong', children: parseInline(inner, depth + 1) });
          i = close + 2;
          continue;
        }
      } else {
        let close = src.indexOf(ch, i + 1);
        // A doubled marker inside is not a single closer.
        while (close !== -1 && src[close + 1] === ch) close = src.indexOf(ch, close + 2);
        const inner = close > i + 1 ? src.slice(i + 1, close) : '';
        if (
          inner !== '' &&
          !/^\s|\s$/.test(inner) &&
          (ch === '*' || (!isWordChar(src[i - 1]) && !isWordChar(src[close + 1])))
        ) {
          out.push({ type: 'emphasis', children: parseInline(inner, depth + 1) });
          i = close + 1;
          continue;
        }
      }
    }

    pushText(out, ch ?? '');
    i += 1;
  }
  return out;
}

/** Parse Markdown source into a block tree. Never throws. */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.split(/\r\n|\r|\n/);
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
      para = [];
    }
  };
  const flushList = (): void => {
    if (list !== null) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        items: list.items.map((t): MdListItem => ({ type: 'list-item', children: parseInline(t) })),
      });
      list = null;
    }
  };

  let n = 0;
  while (n < lines.length) {
    const line = lines[n] ?? '';
    n += 1;

    const fence = FENCE_RE.exec(line);
    if (fence !== null) {
      flushPara();
      flushList();
      const marker = fence[1] ?? '```';
      const body: string[] = [];
      while (n < lines.length) {
        const next = lines[n] ?? '';
        n += 1;
        const t = next.trim();
        const fenceChar = marker.charAt(0);
        if (t.length >= marker.length && t.split(fenceChar).join('') === '') break;
        body.push(next);
      }
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      flushPara();
      flushList();
      const level = (heading[1] ?? '#').length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, children: parseInline((heading[2] ?? '').trim()) });
      continue;
    }

    const item = LIST_RE.exec(line);
    if (item !== null) {
      flushPara();
      const ordered = /^\d/.test(item[1] ?? '');
      if (list !== null && list.ordered !== ordered) flushList();
      if (list === null) list = { ordered, items: [] };
      list.items.push(item[2] ?? '');
      continue;
    }

    if (list !== null && /^[ \t]+/.test(line)) {
      // Continuation of the last list item.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ''}\n${line.trim()}`;
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
