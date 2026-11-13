// @vitest-environment happy-dom
/**
 * DOM tests for the night light overlay (colour-dodge + screen layers).
 * Validates: Requirements 13.1, 15.4, 15.5, 15.6
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LightLayers } from "../../ui/src/LightLayers";
import { Header } from "../../ui/src/LibraryView";
import { STYLE_TEXT, StyleElement } from "../../ui/src/styles";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
/** Mirrors the app root of ui/src/index.tsx (which needs the host-only SDK to mount). */
function Page({ mode, withLantern }: { mode: "dark" | "light"; withLantern: boolean }): ReactElement {
  return createElement(
    "div",
    { className: "ec-root", "data-mode": mode, "data-testid": "root" },
    createElement(StyleElement),
    createElement("div", { className: "ec-content" }, withLantern ? createElement(Header) : null),
    createElement(LightLayers, { mode }),
  );
}
async function mount(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(el);
  });
  return host;
}
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});
/** The declaration block of the first top-level rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = STYLE_TEXT.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return STYLE_TEXT.slice(start, STYLE_TEXT.indexOf("}", start));
}
function noPreferenceBlock(): string {
  const start = STYLE_TEXT.indexOf("@media (prefers-reduced-motion: no-preference)");
  expect(start).toBeGreaterThanOrEqual(0);
  return STYLE_TEXT.slice(start);
}
describe("night light overlay", () => {
  it("renders both layers in dark mode with colour-dodge and screen blend modes", async () => {
    const c = await mount(createElement(Page, { mode: "dark", withLantern: true }));
    expect(c.querySelector('[data-testid="light-dodge"].ec-light-a')).not.toBeNull();
    expect(c.querySelector('[data-testid="light-wash"].ec-light-b')).not.toBeNull();
    expect(rule(".ec-light-a")).toContain("mix-blend-mode: color-dodge");
    expect(rule(".ec-light-a")).toContain("at var(--ec-lx");
    expect(rule(".ec-light-a")).toContain("rgba(255,214,140,.70) 0");
    expect(rule(".ec-light-b")).toContain("mix-blend-mode: screen");
    expect(rule(".ec-light-b")).toContain("rgba(255,170,70,.16) 0");
    expect(c.querySelectorAll("style")).toHaveLength(1);
  });
  it("is aria-hidden, ignores the pointer and sits inside an isolated root", async () => {
    const c = await mount(createElement(Page, { mode: "dark", withLantern: true }));
    const overlay = c.querySelector('[data-testid="light-overlay"]');
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.parentElement).toBe(c.querySelector('[data-testid="root"]'));
    expect(rule(".ec-light")).toContain("pointer-events: none");
    expect(rule(".ec-root")).toContain("isolation: isolate");
    // The real app root renders the overlay as a child of .ec-root.
    const index = readFileSync(resolve(process.cwd(), "ui/src/index.tsx"), "utf8");
    const open = index.indexOf('className="ec-root"');
    const layers = index.indexOf("<LightLayers");
    expect(open).toBeGreaterThan(0);
    expect(layers).toBeGreaterThan(open);
    expect(layers).toBeLessThan(index.lastIndexOf("</div>"));
  });
  it("sets the light centre from the lantern core and turns off without a lantern", async () => {
    const lit = await mount(createElement(Page, { mode: "dark", withLantern: true }));
    const r1 = lit.querySelector<HTMLElement>('[data-testid="root"]');
    expect(r1?.getAttribute("data-light")).toBe("on");
    expect(r1?.style.getPropertyValue("--ec-lx")).toMatch(/^-?\d+px$/);
    expect(r1?.style.getPropertyValue("--ec-ly")).toMatch(/^-?\d+px$/);
    await act(async () => {
      root?.unmount();
    });
    host?.remove();
    const dim = await mount(createElement(Page, { mode: "dark", withLantern: false }));
    expect(dim.querySelector('[data-testid="root"]')?.getAttribute("data-light")).toBe("off");
    expect(STYLE_TEXT).toContain('.ec-root[data-light="off"] .ec-light { display: none; }');
  });
  it("flickers only on the layers, with keyframes inside the no-preference media query", async () => {
    const c = await mount(createElement(Page, { mode: "dark", withLantern: true }));
    const flicker = Array.from(c.querySelectorAll(".ec-flicker"));
    expect(flicker.map((e) => e.getAttribute("data-layer"))).toEqual(["a", "b"]);
    const before = STYLE_TEXT.slice(0, STYLE_TEXT.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(before).not.toMatch(/ec-flicker|@keyframes/);
    const block = noPreferenceBlock();
    expect(block).toContain("@keyframes ec-flicker-a");
    expect(block).toContain("@keyframes ec-flicker-b");
    expect(block).toMatch(/\.ec-light-a\.ec-flicker \{ animation: ec-flicker-a 3\.7s/);
    expect(block).toMatch(/\.ec-light-b\.ec-flicker \{ animation: ec-flicker-b 4\.9s/);
    // Opacity stays within +/-5%.
    for (const m of block.matchAll(/@keyframes ec-flicker-[ab] \{([^\n]*)\}/g)) {
      for (const o of (m[1] ?? "").matchAll(/opacity: ([\d.]+)/g)) {
        expect(Number(o[1])).toBeGreaterThanOrEqual(0.95);
        expect(Number(o[1])).toBeLessThanOrEqual(1);
      }
    }
  });
  it("declares no animation for the flicker or light layers outside the no-preference media block", () => {
    const outside = STYLE_TEXT.slice(0, STYLE_TEXT.indexOf("@media (prefers-reduced-motion: no-preference)"));
    for (const line of outside.split("\n")) {
      if (/\.ec-flicker|\.ec-light/.test(line)) expect(line).not.toMatch(/animation|@keyframes/);
    }
    expect(outside).not.toMatch(/@keyframes ec-flicker/);
  });
  it("renders no light layers when the theme is not dark", async () => {
    const c = await mount(createElement(Page, { mode: "light", withLantern: true }));
    expect(c.querySelector('[data-testid="light-overlay"]')).toBeNull();
    expect(c.querySelector(".ec-light-a, .ec-light-b")).toBeNull();
  });
  it("keeps a single lantern: the decor layer draws no lantern of its own", () => {
    const decor = readFileSync(resolve(process.cwd(), "ui/src/DecorLayer.ts"), "utf8");
    expect(decor).not.toMatch(/ec-lantern|radialGradient/);
    expect(STYLE_TEXT).not.toContain("ec-lantern-glow");
  });
});
