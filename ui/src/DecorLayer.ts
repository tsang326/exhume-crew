/**
 * Lantern and fog, drawn in code as SVG with translucent fills (Requirement 15.6).
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
      createElement(
        "defs",
        null,
        createElement(
          "radialGradient",
          { id: "ec-lantern-grad" },
          createElement("stop", { offset: "0%", stopColor: "#ffb347", stopOpacity: 0.45 }),
          createElement("stop", { offset: "100%", stopColor: "#ffb347", stopOpacity: 0 }),
        ),
      ),
      createElement("g", { className: "ec-fog" },
        createElement("ellipse", { cx: 90, cy: 250, rx: 150, ry: 28, fill: "#9aa5b1", fillOpacity: 0.12 }),
        createElement("ellipse", { cx: 300, cy: 270, rx: 170, ry: 24, fill: "#9aa5b1", fillOpacity: 0.1 }),
      ),
      createElement("g", { className: "ec-lantern" },
        createElement("circle", { className: "ec-lantern-glow", cx: 350, cy: 50, r: 60, fill: "url(#ec-lantern-grad)" }),
        createElement("rect", { x: 343, y: 38, width: 14, height: 24, rx: 3, fill: "#ffb347", fillOpacity: 0.35 }),
        createElement("rect", { x: 341, y: 34, width: 18, height: 4, fill: "#6b7280", fillOpacity: 0.35 }),
        createElement("rect", { x: 341, y: 62, width: 18, height: 4, fill: "#6b7280", fillOpacity: 0.35 }),
      ),
    ),
  );
}
