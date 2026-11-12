// ui/src/index.tsx
import { useCallback as useCallback2, useState as useState4 } from "react";
import { useAppApi, useChatLauncher, useTheme } from "@kirocrew/app-sdk";

// ui/src/DecorLayer.ts
import { createElement } from "react";
function DecorLayer() {
  return createElement(
    "div",
    { className: "ec-decor", "aria-hidden": "true", "data-testid": "decor-layer" },
    createElement(
      "svg",
      { viewBox: "0 0 400 300", preserveAspectRatio: "xMidYMid slice", focusable: "false" },
      createElement(
        "defs",
        null,
        createElement(
          "radialGradient",
          { id: "ec-lantern-grad" },
          createElement("stop", { offset: "0%", stopColor: "#ffb347", stopOpacity: 0.45 }),
          createElement("stop", { offset: "100%", stopColor: "#ffb347", stopOpacity: 0 })
        )
      ),
      createElement(
        "g",
        { className: "ec-fog" },
        createElement("ellipse", { cx: 90, cy: 250, rx: 150, ry: 28, fill: "#9aa5b1", fillOpacity: 0.12 }),
        createElement("ellipse", { cx: 300, cy: 270, rx: 170, ry: 24, fill: "#9aa5b1", fillOpacity: 0.1 })
      ),
      createElement(
        "g",
        { className: "ec-stones", fill: "#6b7280", fillOpacity: 0.12 },
        createElement("path", { d: "M30 300 V250 a16 16 0 0 1 32 0 V300 Z" }),
        createElement("path", { d: "M70 300 V262 a12 12 0 0 1 24 0 V300 Z" })
      ),
      createElement(
        "g",
        { className: "ec-lantern" },
        createElement("circle", { className: "ec-lantern-glow", cx: 350, cy: 50, r: 60, fill: "url(#ec-lantern-grad)" }),
        createElement("rect", { x: 343, y: 38, width: 14, height: 24, rx: 3, fill: "#ffb347", fillOpacity: 0.35 }),
        createElement("rect", { x: 341, y: 34, width: 18, height: 4, fill: "#6b7280", fillOpacity: 0.35 }),
        createElement("rect", { x: 341, y: 62, width: 18, height: 4, fill: "#6b7280", fillOpacity: 0.35 })
      )
    )
  );
}

// ui/src/DiskView.tsx
import { useEffect as useEffect2, useRef, useState as useState2 } from "react";

// ui/src/PreviewPane.ts
import { createElement as createElement2, useEffect, useState } from "react";

// ui/src/lib/csv.ts
var CSV_MAX_ROWS = 1e3;
var CSV_MAX_COLUMNS = 50;
function parseCsv(source) {
  const rows = [];
  let truncatedRows = false;
  let truncatedColumns = false;
  let row = [];
  let cellCount = 0;
  let cell = "";
  let inQuotes = false;
  let rowHasContent = false;
  const endCell = () => {
    if (cellCount < CSV_MAX_COLUMNS) row.push(cell);
    else truncatedColumns = true;
    cellCount += 1;
    cell = "";
  };
  const endRow = () => {
    endCell();
    const blank = !rowHasContent;
    const finished = row;
    row = [];
    cellCount = 0;
    rowHasContent = false;
    if (blank) return true;
    if (rows.length >= CSV_MAX_ROWS) {
      truncatedRows = true;
      return false;
    }
    rows.push(finished);
    return true;
  };
  const len = source.length;
  let i = 0;
  let stopped = false;
  while (i < len) {
    const ch = source.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (source.charAt(i + 1) === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        cell += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      rowHasContent = true;
      i += 1;
    } else if (ch === ",") {
      rowHasContent = true;
      endCell();
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      i += ch === "\r" && source.charAt(i + 1) === "\n" ? 2 : 1;
      if (!endRow()) {
        stopped = true;
        break;
      }
    } else {
      rowHasContent = true;
      cell += ch;
      i += 1;
    }
  }
  if (!stopped && (rowHasContent || cell !== "" || cellCount > 0)) {
    endRow();
  }
  return { rows, truncatedRows, truncatedColumns };
}

// ui/src/lib/markdown.ts
var MAX_INLINE_DEPTH = 4;
var HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
var FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
var LIST_RE = /^[ \t]{0,}([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
function isWordChar(ch) {
  return ch !== void 0 && /[\p{L}\p{N}]/u.test(ch);
}
function pushText(out, text) {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last !== void 0 && last.type === "text") {
    out[out.length - 1] = { type: "text", text: last.text + text };
  } else {
    out.push({ type: "text", text });
  }
}
function parseInline(src, depth = 0) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i + 1) {
        out.push({ type: "code", text: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (depth < MAX_INLINE_DEPTH && (ch === "*" || ch === "_")) {
      if (src.startsWith(ch + ch, i)) {
        const close = src.indexOf(ch + ch, i + 2);
        const inner = close > i + 2 ? src.slice(i + 2, close) : "";
        if (inner !== "" && !/^\s|\s$/.test(inner) && (ch === "*" || !isWordChar(src[i - 1]))) {
          out.push({ type: "strong", children: parseInline(inner, depth + 1) });
          i = close + 2;
          continue;
        }
      } else {
        let close = src.indexOf(ch, i + 1);
        while (close !== -1 && src[close + 1] === ch) close = src.indexOf(ch, close + 2);
        const inner = close > i + 1 ? src.slice(i + 1, close) : "";
        if (inner !== "" && !/^\s|\s$/.test(inner) && (ch === "*" || !isWordChar(src[i - 1]) && !isWordChar(src[close + 1]))) {
          out.push({ type: "emphasis", children: parseInline(inner, depth + 1) });
          i = close + 1;
          continue;
        }
      }
    }
    pushText(out, ch ?? "");
    i += 1;
  }
  return out;
}
function parseMarkdown(source) {
  const lines = source.split(/\r\n|\r|\n/);
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
      para = [];
    }
  };
  const flushList = () => {
    if (list !== null) {
      blocks.push({
        type: "list",
        ordered: list.ordered,
        items: list.items.map((t) => ({ type: "list-item", children: parseInline(t) }))
      });
      list = null;
    }
  };
  let n = 0;
  while (n < lines.length) {
    const line = lines[n] ?? "";
    n += 1;
    const fence = FENCE_RE.exec(line);
    if (fence !== null) {
      flushPara();
      flushList();
      const marker = fence[1] ?? "```";
      const body = [];
      while (n < lines.length) {
        const next = lines[n] ?? "";
        n += 1;
        const t = next.trim();
        const fenceChar = marker.charAt(0);
        if (t.length >= marker.length && t.split(fenceChar).join("") === "") break;
        body.push(next);
      }
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      flushPara();
      flushList();
      const level = (heading[1] ?? "#").length;
      blocks.push({ type: "heading", level, children: parseInline((heading[2] ?? "").trim()) });
      continue;
    }
    const item = LIST_RE.exec(line);
    if (item !== null) {
      flushPara();
      const ordered = /^\d/.test(item[1] ?? "");
      if (list !== null && list.ordered !== ordered) flushList();
      if (list === null) list = { ordered, items: [] };
      list.items.push(item[2] ?? "");
      continue;
    }
    if (list !== null && /^[ \t]+/.test(line)) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""}
${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

// ui/src/PreviewPane.ts
var PNG_DATA_URL_PREFIX = "data:image/png;base64,";
var HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
function renderInline(nodes) {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text;
      case "code":
        return createElement2("code", { key: i }, n.text);
      case "emphasis":
        return createElement2("em", { key: i }, ...renderInline(n.children));
      case "strong":
        return createElement2("strong", { key: i }, ...renderInline(n.children));
    }
  });
}
function renderBlock(block, key) {
  switch (block.type) {
    case "heading":
      return createElement2(HEADING_TAGS[block.level - 1] ?? "h6", { key }, ...renderInline(block.children));
    case "paragraph":
      return createElement2("p", { key }, ...renderInline(block.children));
    case "code":
      return createElement2("pre", { key }, createElement2("code", null, block.text));
    case "list":
      return createElement2(
        block.ordered ? "ol" : "ul",
        { key },
        ...block.items.map((item, i) => createElement2("li", { key: i }, ...renderInline(item.children)))
      );
  }
}
function MarkdownPreview({ source }) {
  return createElement2("div", { "data-testid": "preview-markdown" }, ...parseMarkdown(source).map(renderBlock));
}
function CsvPreview({ source }) {
  const table = parseCsv(source);
  const notes = [];
  if (table.truncatedRows) notes.push("Only the first rows are shown.");
  if (table.truncatedColumns) notes.push("Only the first columns are shown.");
  return createElement2(
    "div",
    { "data-testid": "preview-csv" },
    createElement2(
      "table",
      { className: "ec-table" },
      createElement2(
        "tbody",
        null,
        ...table.rows.map(
          (row, r) => createElement2("tr", { key: r }, ...row.map((cell, c) => createElement2("td", { key: c }, cell)))
        )
      )
    ),
    ...notes.map((n, i) => createElement2("p", { key: `n${i}`, className: "ec-muted" }, n))
  );
}
function TextPreview({ source }) {
  return createElement2("pre", { "data-testid": "preview-text" }, source);
}
function PngPreview({
  width,
  height,
  bytes,
  imageDataUrl
}) {
  const showImage = imageDataUrl !== null && imageDataUrl.startsWith(PNG_DATA_URL_PREFIX);
  return createElement2(
    "div",
    { "data-testid": "preview-png" },
    createElement2("p", null, `PNG image: ${width} x ${height} pixels, ${bytes} bytes`),
    showImage ? createElement2("img", { src: imageDataUrl, alt: "PNG preview", style: { maxWidth: "100%" } }) : null
  );
}
function renderPreview(p) {
  if (p.kind === "png") {
    return createElement2(PngPreview, {
      width: p.width,
      height: p.height,
      bytes: p.bytes,
      imageDataUrl: p.imageDataUrl
    });
  }
  const body = p.format === "markdown" ? createElement2(MarkdownPreview, { source: p.text }) : p.format === "csv" ? createElement2(CsvPreview, { source: p.text }) : createElement2(TextPreview, { source: p.text });
  return createElement2(
    "div",
    null,
    body,
    p.truncated ? createElement2("p", { className: "ec-muted" }, "The preview was cut short.") : null,
    ...p.warnings.map((w, i) => createElement2("p", { key: `w${i}`, className: "ec-muted" }, w.message))
  );
}
function PreviewPane({ api, diskId, entry }) {
  const [state, setState] = useState({ phase: "idle" });
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
      }
    );
    return () => {
      live = false;
    };
  }, [api, diskId, entry]);
  let body;
  switch (state.phase) {
    case "idle":
      body = createElement2("p", { className: "ec-muted" }, "Select a file to preview it.");
      break;
    case "loading":
      body = createElement2("p", { role: "status" }, "Loading preview...");
      break;
    case "error":
      body = createElement2("p", { role: "alert", className: "ec-error" }, "The preview could not be loaded.");
      break;
    case "ready":
      body = renderPreview(state.data);
      break;
  }
  return createElement2("section", { className: "ec-preview", "aria-label": "Preview" }, body);
}

// ui/src/DiskView.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var EXHUME_ALL_TOOLTIP = "Exhumes live files and deleted entries graded recovered.";
function Grave({
  entry,
  selected,
  onSelect
}) {
  const deleted = entry.state !== "alive";
  const isFile = entry.kind === "file";
  const label = deleted ? `Open grave: ${entry.path}` : `Tombstone: ${entry.path}`;
  return /* @__PURE__ */ jsxs(
    "li",
    {
      className: "ec-grave",
      "data-testid": deleted ? "open-grave" : "tombstone",
      "data-selected": selected ? "true" : "false",
      children: [
        /* @__PURE__ */ jsx("span", { className: "ec-grave-mark", "aria-hidden": "true" }),
        isFile ? /* @__PURE__ */ jsxs(
          "button",
          {
            className: "ec-grave-btn",
            type: "button",
            "aria-pressed": selected,
            "aria-label": label,
            onClick: () => onSelect(entry.id),
            children: [
              /* @__PURE__ */ jsx("span", { className: "ec-grave-name", children: entry.path }),
              deleted ? /* @__PURE__ */ jsxs("span", { className: "ec-grave-grade", "data-testid": "grave-grade", children: [
                /* @__PURE__ */ jsx("span", { className: "ec-badge", "data-grade": entry.state, children: `Grade: ${entry.state}` }),
                entry.reason !== void 0 ? /* @__PURE__ */ jsx("span", { children: ` ${entry.reason}` }) : null
              ] }) : null
            ]
          }
        ) : /* @__PURE__ */ jsxs("div", { className: "ec-grave-static", children: [
          /* @__PURE__ */ jsx("span", { className: "ec-grave-name", children: entry.path }),
          deleted ? /* @__PURE__ */ jsxs("span", { className: "ec-grave-grade", "data-testid": "grave-grade", children: [
            /* @__PURE__ */ jsx("span", { className: "ec-badge", "data-grade": entry.state, children: `Grade: ${entry.state}` }),
            entry.reason !== void 0 ? /* @__PURE__ */ jsx("span", { children: ` ${entry.reason}` }) : null
          ] }) : null
        ] })
      ]
    }
  );
}
function Graveyard({
  files,
  selected,
  onSelect
}) {
  return /* @__PURE__ */ jsx("ul", { className: "ec-graveyard", "aria-label": "Graveyard", "data-testid": "graveyard", children: files.map((f) => /* @__PURE__ */ jsx(Grave, { entry: f, selected: selected === f.id, onSelect }, f.id)) });
}
function NotFound({ onBack }) {
  return /* @__PURE__ */ jsxs("div", { className: "ec-content", "data-testid": "disk-not-found", children: [
    /* @__PURE__ */ jsx("button", { className: "ec-btn", type: "button", onClick: onBack, children: "Back to library" }),
    /* @__PURE__ */ jsx("p", { role: "alert", className: "ec-error", children: "This disk does not exist." })
  ] });
}
function DiskView({ api, diskId, onBack, onAskUndertaker }) {
  const [load, setLoad] = useState2({ phase: "loading" });
  const [selected, setSelected] = useState2(null);
  const [exhume, setExhume] = useState2({ phase: "idle" });
  const live = useRef(true);
  useEffect2(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect2(() => {
    let current = true;
    setLoad({ phase: "loading" });
    setSelected(null);
    setExhume({ phase: "idle" });
    (async () => {
      try {
        const list = await api.listDisks();
        if (!current) return;
        if (!list.disks.some((d) => d.diskId === diskId)) {
          setLoad({ phase: "notfound" });
          return;
        }
        const detail2 = await api.getDisk(diskId);
        if (current) setLoad({ phase: "ready", detail: detail2 });
      } catch {
        if (current) setLoad({ phase: "error" });
      }
    })();
    return () => {
      current = false;
    };
  }, [api, diskId]);
  if (load.phase === "notfound") return /* @__PURE__ */ jsx(NotFound, { onBack });
  if (load.phase !== "ready") {
    return /* @__PURE__ */ jsxs("div", { className: "ec-content", "data-testid": "disk-view", children: [
      /* @__PURE__ */ jsx("button", { className: "ec-btn", type: "button", onClick: onBack, children: "Back to library" }),
      load.phase === "loading" ? /* @__PURE__ */ jsx("p", { role: "status", children: "Loading disk..." }) : /* @__PURE__ */ jsx("p", { role: "alert", className: "ec-error", children: "The disk could not be loaded." })
    ] });
  }
  const { detail } = load;
  const running = exhume.phase === "running";
  const truncated = detail.truncated || detail.card.entriesTruncated;
  const onExhumeAll = () => {
    setExhume({ phase: "running" });
    api.exhumeAll(diskId).then(
      (r) => {
        if (live.current) setExhume({ phase: "done", results: r.results });
      },
      () => {
        if (live.current) setExhume({ phase: "error" });
      }
    );
  };
  const nameFor = (r) => detail.files.find((f) => f.id === r.entry)?.path ?? r.path;
  return /* @__PURE__ */ jsxs("div", { className: "ec-content", "data-testid": "disk-view", children: [
    /* @__PURE__ */ jsxs("div", { className: "ec-row", children: [
      /* @__PURE__ */ jsx("button", { className: "ec-btn", type: "button", onClick: onBack, children: "Back to library" }),
      /* @__PURE__ */ jsx("h1", { children: detail.card.label === "" ? "Untitled disk" : detail.card.label }),
      /* @__PURE__ */ jsx("button", { className: "ec-btn", type: "button", onClick: () => onAskUndertaker(diskId), children: "Ask the undertaker" })
    ] }),
    truncated ? /* @__PURE__ */ jsx("p", { role: "note", className: "ec-card", "data-testid": "truncation-notice", children: `Showing ${detail.files.length} of ${detail.totalEntries} entries. "Exhume all recoverable" covers only the entries shown.` }) : null,
    /* @__PURE__ */ jsxs("div", { className: "ec-row", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          className: "ec-btn",
          type: "button",
          disabled: running,
          title: EXHUME_ALL_TOOLTIP,
          "aria-describedby": "ec-exhume-tip",
          onClick: onExhumeAll,
          children: "Exhume all recoverable"
        }
      ),
      /* @__PURE__ */ jsx("span", { id: "ec-exhume-tip", className: "ec-muted", children: EXHUME_ALL_TOOLTIP })
    ] }),
    exhume.phase === "error" ? /* @__PURE__ */ jsx("p", { role: "alert", className: "ec-error", "data-testid": "exhume-error", children: "The exhume request failed." }) : null,
    exhume.phase === "done" ? /* @__PURE__ */ jsx("ul", { "aria-label": "Exhume results", "data-testid": "exhume-results", children: exhume.results.map((r, i) => /* @__PURE__ */ jsx("li", { "data-outcome": r.outcome, children: `${nameFor(r)}: ${r.outcome === "exhumed" ? "succeeded" : "failed"}` }, `${r.entry}-${i}`)) }) : null,
    /* @__PURE__ */ jsx(Graveyard, { files: detail.files, selected, onSelect: setSelected }),
    /* @__PURE__ */ jsx(PreviewPane, { api, diskId, entry: selected })
  ] });
}

// ui/src/LibraryView.tsx
import { useCallback, useEffect as useEffect3, useRef as useRef2, useState as useState3 } from "react";

// ui/src/lib/messages.ts
var DISK_ID = /^[0-9a-f]{64}$/;
var SUMMARISE_PREFIX = "Summarise these disks using the floppy-archive skill. Disk ids: ";
var UNDERTAKER_PREFIX = "Help me with the disk with id ";
var ARCHIVIST_AGENT = "exhume-archivist";
var UNDERTAKER_AGENT = "exhume-undertaker";
function isValidDiskId(id) {
  return typeof id === "string" && DISK_ID.test(id);
}
function assertDiskId(id) {
  if (!isValidDiskId(id)) throw new RangeError("Invalid Disk_Id");
}
function buildSummariseMessage(ids) {
  if (ids.length === 0) return null;
  for (const id of ids) assertDiskId(id);
  return SUMMARISE_PREFIX + ids.join(" ");
}
function buildUndertakerMessage(id) {
  assertDiskId(id);
  return UNDERTAKER_PREFIX + id;
}

// ui/src/LibraryView.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var GENERIC_SAVE_ERROR = "The library folder could not be set.";
var MAX_ERROR_TEXT = 300;
function errorText(err, fallback) {
  if (err instanceof Error && err.message.trim() !== "") return err.message.slice(0, MAX_ERROR_TEXT);
  return fallback;
}
function SettingsArea(props) {
  const { library, disabled, saveError, demoError, onSave, onUseDemo } = props;
  const [path, setPath] = useState3("");
  const shownPath = library?.path ?? "";
  useEffect3(() => {
    setPath(shownPath);
  }, [shownPath]);
  return /* @__PURE__ */ jsxs2("section", { className: "ec-card", "aria-label": "Settings", "data-testid": "settings-area", children: [
    /* @__PURE__ */ jsx2("h2", { children: "Library folder" }),
    /* @__PURE__ */ jsxs2(
      "form",
      {
        className: "ec-row",
        onSubmit: (e) => {
          e.preventDefault();
          onSave(path);
        },
        children: [
          /* @__PURE__ */ jsx2("label", { htmlFor: "ec-library-path", children: "Library path" }),
          /* @__PURE__ */ jsx2(
            "input",
            {
              id: "ec-library-path",
              className: "ec-input",
              type: "text",
              value: path,
              onChange: (e) => setPath(e.target.value)
            }
          ),
          /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "submit", disabled: disabled || path.trim() === "", children: "Save" }),
          /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "button", disabled, onClick: onUseDemo, children: "Use demo library" })
        ]
      }
    ),
    /* @__PURE__ */ jsxs2("p", { className: "ec-muted", children: [
      "Current library: ",
      /* @__PURE__ */ jsx2("span", { "data-testid": "library-path", children: library?.path ?? "not set" })
    ] }),
    library?.error ? /* @__PURE__ */ jsx2("p", { role: "alert", className: "ec-error", "data-testid": "library-error", children: library.error.message }) : null,
    saveError ? /* @__PURE__ */ jsx2("p", { role: "alert", className: "ec-error", children: saveError }) : null,
    demoError ? /* @__PURE__ */ jsx2("p", { role: "alert", className: "ec-error", children: demoError }) : null
  ] });
}
function Toolbar(props) {
  const { scanning, hasDisks, onRescan, onExportCsv, onExportMarkdown, onSummarise } = props;
  const needDisks = scanning || !hasDisks;
  return /* @__PURE__ */ jsxs2("div", { className: "ec-row", role: "toolbar", "aria-label": "Library actions", children: [
    /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "button", disabled: scanning, onClick: onRescan, children: "Rescan" }),
    /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "button", disabled: needDisks, onClick: onExportCsv, children: "Export CSV" }),
    /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "button", disabled: needDisks, onClick: onExportMarkdown, children: "Export Markdown" }),
    /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "button", disabled: needDisks, onClick: onSummarise, children: "Summarise new disks" })
  ] });
}
function ScanProgress({ scan }) {
  if (scan === null) return null;
  if (scan.state === "running") {
    return /* @__PURE__ */ jsx2("p", { role: "status", "data-testid": "scan-progress", children: `Scanned ${scan.scanned} of ${scan.total} disks` });
  }
  if (scan.state === "failed") {
    return /* @__PURE__ */ jsx2("p", { role: "alert", className: "ec-error", "data-testid": "scan-error", children: "The scan failed." });
  }
  return null;
}
function EmptyState({ disabled, onUseDemo }) {
  return /* @__PURE__ */ jsxs2("section", { className: "ec-card", "aria-label": "Empty library", "data-testid": "empty-state", children: [
    /* @__PURE__ */ jsx2("h2", { children: "No disks yet" }),
    /* @__PURE__ */ jsx2("p", { children: "Put disk image files (.img) into your library folder and press Rescan, or type a different folder in the settings above and press Save." }),
    /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "button", disabled, onClick: onUseDemo, children: "Use demo library" })
  ] });
}
function DiskCard({ card, onOpen }) {
  return /* @__PURE__ */ jsxs2("li", { className: "ec-card ec-disk", "data-testid": "disk-card", children: [
    /* @__PURE__ */ jsx2("span", { className: "ec-disk-shutter", "aria-hidden": "true" }),
    /* @__PURE__ */ jsx2("h3", { className: "ec-disk-label", children: /* @__PURE__ */ jsx2("button", { className: "ec-btn", type: "button", onClick: () => onOpen(card.diskId), children: card.label === "" ? "Untitled disk" : card.label }) }),
    /* @__PURE__ */ jsx2("p", { children: /* @__PURE__ */ jsx2("span", { className: "ec-badge", "data-testid": "card-status", children: card.status }) }),
    /* @__PURE__ */ jsx2("p", { "data-testid": "card-counts", children: `Recovered ${card.counts.recovered}, partial ${card.counts.partial}, lost ${card.counts.lost}` }),
    /* @__PURE__ */ jsx2("p", { "data-testid": "card-warnings", children: `Warnings: ${card.warnings.length}` }),
    /* @__PURE__ */ jsx2("p", { "data-testid": "card-summary", className: card.summary ? void 0 : "ec-muted", children: card.summary ? card.summary.text : "No summary yet" }),
    card.notes.length > 0 ? /* @__PURE__ */ jsx2("ul", { "data-testid": "card-notes", children: card.notes.map((n) => /* @__PURE__ */ jsx2("li", { children: n.text }, n.id)) }) : /* @__PURE__ */ jsx2("p", { "data-testid": "card-notes", className: "ec-muted", children: "No notes yet" })
  ] });
}
function Shelf({ disks, onOpen }) {
  return /* @__PURE__ */ jsx2("ul", { className: "ec-shelf", "aria-label": "Disks", "data-testid": "shelf", children: disks.map((c) => /* @__PURE__ */ jsx2(DiskCard, { card: c, onOpen }, c.diskId)) });
}
function LibraryView({ api, onOpenDisk, onSummarise }) {
  const [library, setLibrary] = useState3(null);
  const [scan, setScan] = useState3(null);
  const [disks, setDisks] = useState3(null);
  const [notice, setNotice] = useState3(null);
  const [saveError, setSaveError] = useState3(null);
  const [demoError, setDemoError] = useState3(null);
  const [busy, setBusy] = useState3(false);
  const live = useRef2(true);
  useEffect3(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const refreshDisks = useCallback(async () => {
    try {
      const r = await api.listDisks();
      if (live.current) setDisks(r.disks);
    } catch {
      if (live.current) setNotice("The disk list could not be loaded.");
    }
  }, [api]);
  const refreshScan = useCallback(async () => {
    try {
      const s = await api.getScan();
      if (live.current) setScan(s);
    } catch {
    }
  }, [api]);
  useEffect3(() => {
    api.getLibrary().then(
      (l) => {
        if (live.current) setLibrary(l);
      },
      () => {
        if (live.current) setNotice("The library folder could not be read.");
      }
    );
    void refreshScan();
    void refreshDisks();
  }, [api, refreshDisks, refreshScan]);
  const scanning = scan?.state === "running";
  useEffect3(() => {
    if (!scanning) return;
    const timer = setInterval(() => {
      api.getScan().then(
        (s) => {
          if (!live.current) return;
          setScan(s);
          if (s.state !== "running") void refreshDisks();
        },
        () => {
        }
      );
    }, 1e3);
    return () => clearInterval(timer);
  }, [api, scanning, refreshDisks]);
  const startScan = useCallback(async () => {
    try {
      await api.startScan();
    } catch {
      if (live.current) setNotice("The scan could not be started.");
    }
    await refreshScan();
  }, [api, refreshScan]);
  const onSave = (path) => {
    setSaveError(null);
    setBusy(true);
    api.setLibrary(path).then(
      async (l) => {
        if (!live.current) return;
        setLibrary({ ...l, error: null });
        setBusy(false);
        await refreshScan();
        await refreshDisks();
      },
      (err) => {
        if (!live.current) return;
        setBusy(false);
        setSaveError(errorText(err, GENERIC_SAVE_ERROR));
      }
    );
  };
  const onUseDemo = () => {
    setDemoError(null);
    setBusy(true);
    api.copyDemoLibrary().then(async () => {
      if (live.current) setLibrary((prev) => prev === null ? prev : { ...prev, error: null });
      try {
        const fresh = await api.getLibrary();
        if (live.current && fresh.path !== null && fresh.error === null) setLibrary(fresh);
      } catch {
      }
      await startScan();
      await refreshDisks();
    }).catch(() => {
      if (live.current) setDemoError("Copying the demo library failed.");
    }).finally(() => {
      if (live.current) setBusy(false);
    });
  };
  const exportWith = (run) => {
    setNotice(null);
    run().catch(() => {
      if (live.current) setNotice("The export failed.");
    });
  };
  const onSummariseNew = () => {
    const ids = (disks ?? []).filter((d) => d.summary === null && isValidDiskId(d.diskId)).map((d) => d.diskId);
    const message = buildSummariseMessage(ids);
    if (message === null) {
      setNotice("There are no new disks to summarise.");
      return;
    }
    setNotice(null);
    onSummarise(message);
  };
  const hasDisks = disks !== null && disks.length > 0;
  return /* @__PURE__ */ jsxs2("div", { className: "ec-content", "data-testid": "library-view", children: [
    /* @__PURE__ */ jsx2("h1", { children: "Exhume Crew" }),
    /* @__PURE__ */ jsx2(
      SettingsArea,
      {
        library,
        disabled: busy,
        saveError,
        demoError,
        onSave,
        onUseDemo
      }
    ),
    /* @__PURE__ */ jsx2(
      Toolbar,
      {
        scanning,
        hasDisks,
        onRescan: () => void startScan(),
        onExportCsv: () => exportWith(() => api.downloadCsv()),
        onExportMarkdown: () => exportWith(() => api.downloadMarkdown()),
        onSummarise: onSummariseNew
      }
    ),
    /* @__PURE__ */ jsx2(ScanProgress, { scan }),
    /* @__PURE__ */ jsx2("div", { role: "status", "data-testid": "notice", children: notice }),
    disks !== null && disks.length === 0 ? /* @__PURE__ */ jsx2(EmptyState, { disabled: busy, onUseDemo }) : null,
    disks !== null && disks.length > 0 ? /* @__PURE__ */ jsx2(Shelf, { disks, onOpen: onOpenDisk }) : null
  ] });
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
function sanitizeFileName(name) {
  let out = "";
  for (const ch of toWellFormed(name)) {
    out += /^[A-Za-z0-9._-]$/.test(ch) ? ch : "_";
  }
  out = out.slice(0, MAX_FILE_NAME_LENGTH);
  if (out === "" || /^\.+$/.test(out)) return FALLBACK_FILE_NAME;
  return out;
}

// ui/src/lib/download.ts
var MIME = {
  csv: "text/csv",
  markdown: "text/markdown",
  binary: "application/octet-stream"
};
function makeDownloadBlob(kind, data) {
  return new Blob([data], { type: MIME[kind] });
}
function saveBlob(kind, data, fileName) {
  const blob = makeDownloadBlob(kind, data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFileName(fileName);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ui/src/lib/api.ts
var API_BASE = "/apps/exhume-crew/api";
function diskPath(id) {
  if (!isValidDiskId(id)) throw new RangeError("Invalid Disk_Id");
  return `${API_BASE}/disks/${id}`;
}
function entryNumber(entry) {
  if (!Number.isSafeInteger(entry) || entry < 0) throw new RangeError("Invalid entry id");
  return entry;
}
var EXPORT_CSV_PATH = `${API_BASE}/export/csv`;
var EXPORT_MARKDOWN_PATH = `${API_BASE}/export/markdown`;
function createApi(app) {
  async function download(path, kind, fileName) {
    const res = await app.raw(path);
    if (!res.ok) throw new Error("Export failed");
    saveBlob(kind, await res.arrayBuffer(), fileName);
  }
  return {
    getLibrary: () => app.get(`${API_BASE}/library`),
    setLibrary: (path) => app.put(`${API_BASE}/library`, { path }),
    copyDemoLibrary: () => app.post(`${API_BASE}/library/demo`),
    getScan: () => app.get(`${API_BASE}/scan`),
    startScan: () => app.post(`${API_BASE}/scan`),
    listDisks: () => app.get(`${API_BASE}/disks`),
    getDisk: (id) => app.get(diskPath(id)),
    getPreview: (id, entry) => app.get(`${diskPath(id)}/preview?entry=${entryNumber(entry)}`),
    exhumeAll: (id) => app.post(`${diskPath(id)}/exhume-all`),
    downloadCsv: () => download(EXPORT_CSV_PATH, "csv", "exhume-catalogue.csv"),
    downloadMarkdown: () => download(EXPORT_MARKDOWN_PATH, "markdown", "exhume-catalogue.md")
  };
}

// ui/src/styles.ts
import { createElement as createElement3 } from "react";
var STYLE_TEXT = `
.ec-root { position: relative; min-height: 100%; isolation: isolate; }
.ec-content { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.ec-decor { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.ec-decor svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ec-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ec-shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px 16px; list-style: none; margin: 0; padding: 0; }
.ec-card { border: 1px solid currentColor; border-radius: 8px; padding: 12px; background: color-mix(in srgb, currentColor 5%, transparent); overflow-wrap: anywhere; }
.ec-disk { position: relative; border-radius: 4px 14px 4px 4px; padding: 12px 12px 16px 12px; margin-bottom: 10px; border-width: 2px; }
.ec-disk::before { content: ""; position: absolute; top: 0; right: 0; width: 14px; height: 14px; border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; border-radius: 0 12px 0 6px; background: color-mix(in srgb, currentColor 14%, transparent); }
.ec-disk::after { content: ""; position: absolute; left: -6px; right: -6px; bottom: -10px; height: 6px; border-radius: 2px; background: color-mix(in srgb, currentColor 22%, transparent); border-top: 1px solid currentColor; }
.ec-disk-shutter { display: block; width: 46%; height: 14px; margin: -4px 0 8px 18px; border: 1px solid currentColor; border-radius: 0 0 4px 4px; background: color-mix(in srgb, currentColor 16%, transparent); }
.ec-disk-label { padding: 4px 6px; border: 1px dashed currentColor; border-radius: 3px; background: color-mix(in srgb, currentColor 8%, transparent); }
.ec-card h3, .ec-card h2 { margin: 0 0 6px 0; }
.ec-badge { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 0 8px; font-size: 0.8em; }
.ec-muted { opacity: 0.75; }
.ec-error { border-left: 4px solid currentColor; padding-left: 8px; font-weight: 600; }
.ec-graveyard { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ec-grave { position: relative; display: flex; border: 1px solid currentColor; border-radius: 22px 22px 4px 4px; overflow-wrap: anywhere; background: color-mix(in srgb, currentColor 6%, transparent); }
.ec-grave[data-testid="open-grave"] { border-style: dashed; border-radius: 4px 4px 22px 22px; background: color-mix(in srgb, currentColor 14%, transparent); box-shadow: inset 0 -8px 10px -6px color-mix(in srgb, currentColor 35%, transparent); }
.ec-grave[data-selected="true"] { border-width: 3px; }
.ec-grave-mark { flex: none; width: 10px; margin: 8px 0 8px 12px; border-top: 2px solid currentColor; border-left: 2px solid currentColor; border-right: 2px solid currentColor; border-radius: 6px 6px 0 0; opacity: 0.6; }
.ec-grave-btn { display: block; flex: 1 1 auto; width: 100%; min-width: 0; text-align: left; background: transparent; border: 0; border-radius: inherit; color: inherit; font: inherit; cursor: pointer; padding: 8px 12px; }
.ec-grave-btn:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.ec-grave-static { flex: 1 1 auto; padding: 8px 12px; }
.ec-grave-name { display: block; }
.ec-grave-grade { display: block; margin-top: 2px; }
.ec-preview { border: 1px solid currentColor; border-radius: 8px; padding: 12px; overflow: auto; max-height: 60vh; overflow-wrap: anywhere; }
.ec-preview pre { white-space: pre-wrap; margin: 0; }
.ec-table { border-collapse: collapse; }
.ec-table td { border: 1px solid currentColor; padding: 2px 6px; }
.ec-btn { border: 1px solid currentColor; border-radius: 6px; padding: 4px 12px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.ec-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ec-input { border: 1px solid currentColor; border-radius: 6px; padding: 4px 8px; background: transparent; color: inherit; font: inherit; min-width: 260px; }
.ec-root :focus-visible { outline: 2px solid var(--accent, #1d4ed8); outline-offset: 2px; }
.ec-root[data-mode="dark"] :focus-visible { outline-color: var(--accent, #93c5fd); }
@media (prefers-reduced-motion: no-preference) {
  @keyframes ec-flicker { 0% { opacity: 0.85; } 50% { opacity: 1; } 100% { opacity: 0.8; } }
  @keyframes ec-drift { 0% { transform: translateX(-3%); } 100% { transform: translateX(3%); } }
  @keyframes ec-rise { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
  .ec-grave, .ec-disk { animation: ec-rise 0.35s ease-out both; }
  .ec-lantern-glow { animation: ec-flicker 2.4s ease-in-out infinite alternate; }
  .ec-fog { animation: ec-drift 18s ease-in-out infinite alternate; }
}
`;
function StyleElement() {
  return createElement3("style", null, STYLE_TEXT);
}

// ui/src/view-state.ts
function parseViewFromSearch(search) {
  const id = new URLSearchParams(search).get("id");
  return id !== null && isValidDiskId(id) ? { kind: "disk", id } : { kind: "library" };
}
function searchForView(view) {
  return view.kind === "disk" ? `?id=${view.id}` : "";
}
function writeViewToUrl(view) {
  try {
    const { pathname, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${searchForView(view)}${hash}`);
  } catch {
  }
}

// ui/src/index.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function ExhumeCrewApp() {
  const app = useAppApi();
  const theme = useTheme();
  const chat = useChatLauncher();
  const [api] = useState4(() => createApi(app));
  const [view, setView] = useState4(() => parseViewFromSearch(window.location.search));
  const go = useCallback2((next) => {
    setView(next);
    writeViewToUrl(next);
  }, []);
  return /* @__PURE__ */ jsxs3(
    "div",
    {
      className: "ec-root",
      "data-mode": theme.mode === "dark" ? "dark" : "light",
      "data-accent": theme.accent,
      children: [
        /* @__PURE__ */ jsx3(StyleElement, {}),
        /* @__PURE__ */ jsx3(DecorLayer, {}),
        view.kind === "disk" ? /* @__PURE__ */ jsx3(
          DiskView,
          {
            api,
            diskId: view.id,
            onBack: () => go({ kind: "library" }),
            onAskUndertaker: (id) => {
              void chat.openChat({ agent: UNDERTAKER_AGENT, message: buildUndertakerMessage(id) });
            }
          }
        ) : /* @__PURE__ */ jsx3(
          LibraryView,
          {
            api,
            onOpenDisk: (id) => go({ kind: "disk", id }),
            onSummarise: (message) => {
              void chat.openChat({ agent: ARCHIVIST_AGENT, message });
            }
          }
        )
      ]
    }
  );
}
export {
  ExhumeCrewApp as default
};
