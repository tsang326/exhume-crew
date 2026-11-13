/**
 * Preview pane for one selected file: Markdown, CSV, PNG facts and plain text
 * (Requirements 14.3, 14.4, 14.5, 14.10, 15.1, 15.9).
 *
 * Every piece of untrusted text is a React text child. The Markdown tree is turned into
 * elements chosen by node type only; no attribute is copied from the source.
 */
import { createElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { ExhumeApi, PreviewResponse } from "./lib/api";
import { parseCsv } from "./lib/csv";
import { parseMarkdown, type MdBlock, type MdInline } from "./lib/markdown";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function renderInline(nodes: readonly MdInline[]): ReactNode[] {
  return nodes.map((n, i): ReactNode => {
    switch (n.type) {
      case "text":
        return n.text;
      case "code":
        return createElement("code", { key: i }, n.text);
      case "emphasis":
        return createElement("em", { key: i }, ...renderInline(n.children));
      case "strong":
        return createElement("strong", { key: i }, ...renderInline(n.children));
    }
  });
}

function renderBlock(block: MdBlock, key: number): ReactElement {
  switch (block.type) {
    case "heading":
      return createElement(HEADING_TAGS[block.level - 1] ?? "h6", { key }, ...renderInline(block.children));
    case "paragraph":
      return createElement("p", { key }, ...renderInline(block.children));
    case "code":
      return createElement("pre", { key }, createElement("code", null, block.text));
    case "list":
      return createElement(
        block.ordered ? "ol" : "ul",
        { key },
        ...block.items.map((item, i) => createElement("li", { key: i }, ...renderInline(item.children))),
      );
  }
}

export function MarkdownPreview({ source }: { source: string }): ReactElement {
  return createElement("div", { "data-testid": "preview-markdown" }, ...parseMarkdown(source).map(renderBlock));
}

export function CsvPreview({ source }: { source: string }): ReactElement {
  const table = parseCsv(source);
  const notes: string[] = [];
  if (table.truncatedRows) notes.push("Only the first rows are shown.");
  if (table.truncatedColumns) notes.push("Only the first columns are shown.");
  return createElement(
    "div",
    { "data-testid": "preview-csv" },
    createElement(
      "table",
      { className: "ec-table" },
      createElement(
        "tbody",
        null,
        ...table.rows.map((row, r) =>
          createElement("tr", { key: r }, ...row.map((cell, c) => createElement("td", { key: c }, cell))),
        ),
      ),
    ),
    ...notes.map((n, i) => createElement("p", { key: `n${i}`, className: "ec-muted" }, n)),
  );
}

export function TextPreview({ source }: { source: string }): ReactElement {
  return createElement("pre", { "data-testid": "preview-text" }, source);
}

export function PngPreview({
  width,
  height,
  bytes,
  imageDataUrl,
}: {
  width: number;
  height: number;
  bytes: number;
  imageDataUrl: string | null;
}): ReactElement {
  const showImage = imageDataUrl !== null && imageDataUrl.startsWith(PNG_DATA_URL_PREFIX);
  return createElement(
    "div",
    { "data-testid": "preview-png" },
    createElement("p", null, `PNG image: ${width} x ${height} pixels, ${bytes} bytes`),
    showImage
      ? createElement("img", { src: imageDataUrl, alt: "PNG preview", style: { maxWidth: "100%" } })
      : null,
  );
}

/** Renders a successful preview response. */
export function renderPreview(p: PreviewResponse): ReactElement {
  if (p.kind === "png") {
    return createElement(PngPreview, {
      width: p.width,
      height: p.height,
      bytes: p.bytes,
      imageDataUrl: p.imageDataUrl,
    });
  }
  const body =
    p.format === "markdown"
      ? createElement(MarkdownPreview, { source: p.text })
      : p.format === "csv"
        ? createElement(CsvPreview, { source: p.text })
        : createElement(TextPreview, { source: p.text });
  return createElement(
    "div",
    null,
    body,
    p.truncated ? createElement("p", { className: "ec-muted" }, "The preview was cut short.") : null,
    ...p.warnings.map((w, i) => createElement("p", { key: `w${i}`, className: "ec-muted" }, w.message)),
  );
}

type PreviewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; data: PreviewResponse };

export interface PreviewPaneProps {
  api: ExhumeApi;
  diskId: string;
  /** Entry id of the selected file, or null when nothing is selected. */
  entry: number | null;
}

export function PreviewPane({ api, diskId, entry }: PreviewPaneProps): ReactElement {
  const [state, setState] = useState<PreviewState>({ phase: "idle" });

  useEffect(() => {
    if (entry === null) {
      setState({ phase: "idle" });
      return;
    }
    let live = true;
    setState({ phase: "loading" });
    api.getPreview(diskId, entry).then(
      (data) => {
        if (live) setState({ phase: "ready", data });
      },
      () => {
        if (live) setState({ phase: "error" });
      },
    );
    return () => {
      live = false;
    };
  }, [api, diskId, entry]);

  let body: ReactNode;
  switch (state.phase) {
    case "idle":
      body = createElement("p", { className: "ec-muted" }, "Select a file to preview it.");
      break;
    case "loading":
      body = createElement("p", { role: "status" }, "Loading preview...");
      break;
    case "error":
      body = createElement("p", { role: "alert", className: "ec-error" }, "The preview could not be loaded.");
      break;
    case "ready":
      body = renderPreview(state.data);
      break;
  }
  return createElement("section", { className: "ec-preview", "aria-label": "Preview" }, body);
}
