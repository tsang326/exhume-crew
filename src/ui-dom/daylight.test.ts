// @vitest-environment happy-dom
/**
 * DOM tests for the daytime light theme and runtime theme switching.
 * Validates: Requirements 13.1, 15.3, 15.4, 15.5, 15.6
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LightLayers } from "../../ui/src/LightLayers";
import { Header } from "../../ui/src/LibraryView";
import { STYLE_TEXT, StyleElement } from "../../ui/src/styles";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
function Page({ mode }: { mode: "dark" | "light" }): ReactElement {
  return createElement(
    "div",
    { className: "ec-root", "data-mode": mode, "data-testid": "root" },
    createElement(StyleElement),
    createElement("div", { className: "ec-content" }, createElement(Header, { mode })),
    createElement(LightLayers, { mode }),
  );
}
async function render(mode: "dark" | "light"): Promise<HTMLElement> {
  if (host === null) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(createElement(Page, { mode }));
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
describe("daylight theme", () => {
  it("light: unlit lantern, no dodge/wash layers, one inert daylight layer", async () => {
    const c = await render("light");
    expect(c.querySelector('[data-testid="lantern"]')?.getAttribute("data-lit")).toBe("false");
    expect(c.querySelector('[data-testid="lantern-core"]')).toBeNull();
    expect(c.querySelector('[data-testid="light-dodge"], [data-testid="light-wash"], .ec-light')).toBeNull();
    const day = c.querySelector(".ec-daylight");
    expect(day?.getAttribute("aria-hidden")).toBe("true");
    expect(day?.parentElement).toBe(c.querySelector('[data-testid="root"]'));
    expect(day?.className).not.toContain("flicker");
    expect(STYLE_TEXT).toMatch(/\.ec-daylight \{[^}]*pointer-events: none/);
    expect(STYLE_TEXT).toMatch(/\.ec-daylight \{[^}]*rgba\(244,248,255,\.35\)/);
    expect(STYLE_TEXT).not.toMatch(/\.ec-daylight \{[^}]*mix-blend-mode/);
    expect(c.querySelectorAll("style")).toHaveLength(1);
  });
  it("dark: lit lantern, both layers, no daylight", async () => {
    const c = await render("dark");
    expect(c.querySelector('[data-testid="lantern"]')?.getAttribute("data-lit")).toBe("true");
    expect(c.querySelector('[data-testid="lantern-core"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="light-dodge"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="light-wash"]')).not.toBeNull();
    expect(c.querySelector(".ec-daylight")).toBeNull();
  });
  it("swaps night and day on a mounted tree without remount errors or stale state", async () => {
    const c = await render("dark");
    const rootEl = c.querySelector<HTMLElement>('[data-testid="root"]');
    expect(rootEl?.getAttribute("data-light")).toBe("on");
    await render("light");
    expect(c.querySelector('[data-testid="root"]')).toBe(rootEl);
    expect(rootEl?.getAttribute("data-mode")).toBe("light");
    expect(rootEl?.hasAttribute("data-light")).toBe(false);
    expect(c.querySelector('[data-testid="lantern-core"]')).toBeNull();
    expect(c.querySelector(".ec-light")).toBeNull();
    expect(c.querySelector(".ec-daylight")).not.toBeNull();
    await render("dark");
    expect(rootEl?.getAttribute("data-light")).toBe("on");
    expect(c.querySelector('[data-testid="lantern-core"]')).not.toBeNull();
    expect(c.querySelector(".ec-daylight")).toBeNull();
    expect(c.querySelectorAll("style")).toHaveLength(1);
  });
  it("styles cards and mist for light mode only via data-mode", () => {
    expect(STYLE_TEXT).toContain('.ec-root[data-mode="light"] .ec-card');
    expect(STYLE_TEXT).toContain("box-shadow: 3px 4px 10px rgba(30,41,59,.12)");
    expect(STYLE_TEXT).toContain('.ec-root[data-mode="light"] .ec-fog ellipse');
  });
});
