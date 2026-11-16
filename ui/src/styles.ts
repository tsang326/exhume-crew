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
.ec-light { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
.ec-light-a, .ec-light-b { position: absolute; inset: 0; }
.ec-light-a { mix-blend-mode: color-dodge; background: radial-gradient(circle at var(--ec-lx, calc(100% - 48px)) var(--ec-ly, 56px), rgba(255,214,140,.45) 0, rgba(255,196,110,.20) 56px, rgba(255,170,80,.06) 170px, rgba(255,150,60,0) 300px); }
.ec-light-b { mix-blend-mode: screen; background: radial-gradient(circle at var(--ec-lx, calc(100% - 48px)) var(--ec-ly, 56px), rgba(255,170,70,.10) 0, rgba(255,170,70,0) 240px); }
.ec-root[data-light="off"] .ec-light { display: none; }
.ec-daylight { position: absolute; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(circle farthest-corner at 0 0, rgba(255,240,205,.55) 0, rgba(255,240,205,.18) 35%, rgba(255,240,205,0) 65%), linear-gradient(135deg, rgba(30,41,59,0) 45%, rgba(30,41,59,.06) 100%); }
.ec-root[data-mode="light"] .ec-card, .ec-root[data-mode="light"] .ec-preview { box-shadow: 4px 6px 14px rgba(30,41,59,.20), 1px 2px 3px rgba(30,41,59,.10); }
.ec-root[data-mode="light"] .ec-fog ellipse { fill: #dbe3ec; fill-opacity: 0.07; }
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
.ec-badge[data-grade] { padding: 1px 10px; font-weight: 600; border-color: currentColor; }
.ec-badge[data-grade="recovered"] { background: #dcfce7; color: #14532d; }
.ec-badge[data-grade="partial"] { background: #fef3c7; color: #78350f; }
.ec-badge[data-grade="lost"] { background: #fee2e2; color: #7f1d1d; }
.ec-root[data-mode="dark"] .ec-badge[data-grade="recovered"] { background: #bbf7d0; color: #03140a; }
.ec-root[data-mode="dark"] .ec-badge[data-grade="partial"] { background: #fde68a; color: #140a01; }
.ec-root[data-mode="dark"] .ec-badge[data-grade="lost"] { background: #fecaca; color: #160404; }
.ec-badge[data-muted="true"] { background: transparent; color: #4b5563; border-color: #6b7280; font-weight: 400; }
.ec-root[data-mode="dark"] .ec-badge[data-muted="true"] { background: transparent; color: #cbd5e1; border-color: #94a3b8; }
.ec-badges { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.ec-diskhead { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; max-width: 100%; overflow-wrap: anywhere; }
.ec-diskhead .ec-title { font-size: 1.75em; }
.ec-facts { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 0; }
.ec-facts li + li::before { content: "\\00B7"; margin: 0 8px; opacity: 0.6; }
.ec-warnings { margin: 0; padding-left: 20px; }
.ec-notes { margin: 4px 0 0 0; padding-left: 20px; }
.ec-grave-mark[data-shape="folder"] { position: relative; width: 26px; height: 18px; margin-bottom: 12px; border-radius: 2px 6px 2px 2px; background: color-mix(in srgb, currentColor 12%, transparent); }
.ec-grave-mark[data-shape="folder"]::before { content: ""; position: absolute; left: -2px; top: -7px; width: 11px; height: 5px; border: 2px solid currentColor; border-bottom: 0; border-radius: 3px 3px 0 0; }
li[data-testid="directory"].ec-grave { border-radius: 4px; border-style: solid; background: color-mix(in srgb, currentColor 3%, transparent); }
.ec-grave-meta { display: block; font-size: 0.85em; }
.ec-disk-grid { display: flex; flex-direction: column; gap: 16px; }
.ec-disk-side { min-width: 0; }
.ec-header { display: flex; align-items: center; gap: 12px; }
.ec-header-lantern { flex: none; display: block; margin: 0 4px 0 auto; overflow: visible; }
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
.ec-btn-primary { background: #1d4ed8; color: #ffffff; border-color: #1d4ed8; font-weight: 600; padding: 6px 16px; }
.ec-btn-primary:hover:not(:disabled) { background: #1e40af; border-color: #1e40af; }
.ec-root[data-mode="dark"] .ec-btn-primary { background: #93c5fd; color: #030712; border-color: #93c5fd; }
.ec-root[data-mode="dark"] .ec-btn-primary:hover:not(:disabled) { background: #bfdbfe; border-color: #bfdbfe; }
.ec-btn-secondary { background: color-mix(in srgb, currentColor 6%, transparent); }
.ec-btn-group { display: inline-flex; flex-wrap: wrap; gap: 6px; margin: 0 6px; }
.ec-btn-open { font-weight: 600; margin-top: 6px; }
.ec-disk-facts { margin: 4px 0; font-size: 0.9em; }
.ec-disk-counts { margin: 6px 0; }
.ec-input { border: 1px solid currentColor; border-radius: 6px; padding: 4px 8px; background: transparent; color: inherit; font: inherit; min-width: 260px; }
.ec-root :focus-visible { outline: 2px solid var(--accent, #1d4ed8); outline-offset: 2px; }
.ec-root[data-mode="dark"] :focus-visible { outline-color: var(--accent, #93c5fd); }
@media (min-width: 1100px) {
  .ec-disk-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px 24px; align-items: start; }
  .ec-disk-side { position: sticky; top: 16px; }
  .ec-disk-side .ec-preview { max-height: calc(100vh - 48px); }
}
@media (prefers-reduced-motion: no-preference) {
  @keyframes ec-flicker-a { 0% { opacity: 0.96; } 38% { opacity: 1; } 71% { opacity: 0.95; } 100% { opacity: 0.99; } }
  @keyframes ec-flicker-b { 0% { opacity: 1; } 27% { opacity: 0.95; } 64% { opacity: 0.99; } 100% { opacity: 0.96; } }
  @keyframes ec-drift { 0% { transform: translateX(-3%); } 100% { transform: translateX(3%); } }
  @keyframes ec-rise { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
  .ec-grave, .ec-disk { animation: ec-rise 0.35s ease-out both; }
  .ec-light-a.ec-flicker { animation: ec-flicker-a 3.7s ease-in-out infinite; }
  .ec-light-b.ec-flicker { animation: ec-flicker-b 4.9s ease-in-out -1.8s infinite; }
  .ec-fog { animation: ec-drift 18s ease-in-out infinite alternate; }
}
`;

/** The one <style> element. Its only child is the fixed text above. */
export function StyleElement(): ReactElement {
  return createElement("style", null, STYLE_TEXT);
}
