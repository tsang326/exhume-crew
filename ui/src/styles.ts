/**
 * The single <style> element of the page (Requirements 15.4, 15.5). The text is a fixed constant;
 * no untrusted text is ever interpolated into it. It defines no Crew theme value: colours come
 * from host CSS variables with fallbacks only for the focus ring.
 *
 * Focus ring: 2 px, offset 2 px, `var(--accent)` with a fallback chosen by `data-mode`
 * (#1d4ed8 on light, #93c5fd on dark; both are above 3:1 against white and near-black).
 */
import { createElement, type ReactElement } from "react";

export const STYLE_TEXT = `
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
.ec-grave-mark { flex: none; align-self: flex-end; width: 22px; margin: 0 0 8px 12px; box-sizing: border-box; border: 2px solid currentColor; opacity: 0.7; }
.ec-grave-mark[data-shape="stone"] { border-radius: 11px 11px 2px 2px; background: color-mix(in srgb, currentColor 22%, transparent); }
.ec-grave-mark[data-shape="pit"] { width: 26px; border-radius: 2px 2px 13px 13px; border-style: dashed; background: #1f2937; height: 14px; }
.ec-grave-mark[data-h="0"] { height: 26px; }
.ec-grave-mark[data-h="1"] { height: 32px; }
.ec-grave-mark[data-h="2"] { height: 38px; }
.ec-grave-mark[data-h="3"] { height: 30px; }
.ec-grave .ec-badge[data-grade] { background: #1f2937; color: #f9fafb; border-color: #1f2937; box-shadow: 0 0 0 1px #9ca3af; padding: 1px 10px; }
.ec-header { display: flex; align-items: center; gap: 12px; }
.ec-header-lantern { flex: none; position: relative; display: block; width: 16px; height: 26px; margin: 6px 6px 6px 4px; border-radius: 4px; background: #ffb347; box-shadow: 0 0 12px 2px rgba(255, 179, 71, 0.45); }
.ec-header-lantern::before { content: ""; position: absolute; left: -2px; right: -2px; top: -5px; height: 4px; border-radius: 2px; background: #6b7280; }
.ec-header-lantern::after { content: ""; position: absolute; left: -2px; right: -2px; bottom: -5px; height: 4px; border-radius: 2px; background: #6b7280; }
.ec-title { margin: 0; font-size: 1.5em; line-height: 1.2; }
.ec-subtitle { margin: 2px 0 0 0; opacity: 0.8; }
.ec-settings-title { margin: 0; font-size: 1em; }
.ec-settings-toggle { font-weight: 600; }
.ec-settings-toggle::before { content: "\\25B8  "; }
.ec-settings-toggle[aria-expanded="true"]::before { content: "\\25BE  "; }
#ec-settings-body { margin-top: 8px; }
#ec-settings-body[hidden] { display: none; }
.ec-clamp { margin: 6px 0 4px 0; white-space: pre-wrap; }
.ec-clamp[data-clamped="true"] { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
.ec-clamp[data-clamped="true"][data-lines="4"] { -webkit-line-clamp: 4; line-clamp: 4; }
.ec-clamp[data-clamped="true"][data-lines="2"] { -webkit-line-clamp: 2; line-clamp: 2; }
.ec-toggle { padding: 0 8px; font-size: 0.85em; margin-bottom: 4px; }
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

/** The one <style> element. Its only child is the fixed text above. */
export function StyleElement(): ReactElement {
  return createElement("style", null, STYLE_TEXT);
}
