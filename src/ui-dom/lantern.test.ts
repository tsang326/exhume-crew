// @vitest-environment happy-dom
/**
 * DOM tests for the code-drawn header lantern.
 * Validates: Requirements 13.1, 15.4, 15.5
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Lantern } from "../../ui/src/Lantern";
import { Header } from "../../ui/src/LibraryView";
import { STYLE_TEXT } from "../../ui/src/styles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

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

describe("Lantern", () => {
  it("is decorative and has a hot core with a gradient when lit", async () => {
    const c = await mount(createElement(Lantern, { lit: true }));
    const svg = c.querySelector('[data-testid="lantern"]');
    expect(svg?.tagName.toLowerCase()).toBe("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(c.querySelector('[data-testid="lantern-core"]')).not.toBeNull();
    expect(c.querySelector("radialGradient#ec-lantern-core, radialgradient#ec-lantern-core")).not.toBeNull();
    expect(c.querySelector('[data-testid="lantern-smoke"]')).toBeNull();
  });

  it("has no hot core and shows a reflection and smoke when unlit", async () => {
    const c = await mount(createElement(Lantern, { lit: false }));
    expect(c.querySelector('[data-testid="lantern"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(c.querySelector('[data-testid="lantern-core"]')).toBeNull();
    expect(c.querySelector("radialGradient, radialgradient")).toBeNull();
    expect(c.querySelector('[data-testid="lantern-reflection"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="lantern-smoke"]')).not.toBeNull();
  });

  it("sits in the page header, and the old CSS lantern rules are gone", async () => {
    const c = await mount(createElement(Header));
    expect(c.querySelector('[data-testid="app-header"] [data-testid="lantern"]')).not.toBeNull();
    expect(STYLE_TEXT).not.toContain(".ec-header-lantern::");
    expect(STYLE_TEXT).not.toContain("box-shadow: 0 0 12px 2px rgba(255, 179, 71");
  });
});
