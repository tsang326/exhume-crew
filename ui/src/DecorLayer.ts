/**
 * Fog and tombstone silhouettes (the lantern is the header SVG plus the light overlay), drawn in code as SVG with translucent fills (Requirement 15.6).
 * Hidden from assistive technology; ignores pointer events; no network requests.
 * Animation is applied by CSS classes that exist only inside `prefers-reduced-motion: no-preference`.
 */
import { createElement, type ReactElement } from "react";

export function DecorLayer(): ReactElement {
  return createElement(
    "div",
    { className: "ec-decor", "aria-hidden": "true", "data-testid": "decor-layer" },
    createElement(
      "svg",
      { viewBox: "0 0 400 300", preserveAspectRatio: "xMidYMid slice", focusable: "false" },
      createElement("g", { className: "ec-fog" },
        createElement("ellipse", { cx: 90, cy: 250, rx: 150, ry: 28, fill: "#9aa5b1", fillOpacity: 0.12 }),
        createElement("ellipse", { cx: 300, cy: 270, rx: 170, ry: 24, fill: "#9aa5b1", fillOpacity: 0.1 }),
      ),
      createElement("g", { className: "ec-stones", fill: "#6b7280", fillOpacity: 0.12 },
        createElement("path", { d: "M30 300 V250 a16 16 0 0 1 32 0 V300 Z" }),
        createElement("path", { d: "M70 300 V262 a12 12 0 0 1 24 0 V300 Z" }),
      ),
    ),
  );
}
