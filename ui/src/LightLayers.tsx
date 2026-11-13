/**
 * Night light overlay (Photoshop colour-dodge technique). One decorative, `aria-hidden`,
 * `pointer-events: none` overlay inside the app root (the root is `isolation: isolate`, so the
 * blend modes only touch app content, never the Crew shell). Layer A is `color-dodge`, layer B is
 * `screen`; both are drawn by CSS gradients centred on `--ec-lx` / `--ec-ly`.
 *
 * The overlay is `position: absolute` and covers the root's whole box, so the lantern (which
 * scrolls with the page) and the light scroll together with no JS. The centre is measured from the
 * rendered lantern core relative to the root: on mount, on view change, on window resize and via
 * ResizeObserver only, never per frame. A view without a lit lantern sets `data-light="off"` on the
 * root and the CSS hides the layers there. In light mode the dodge and wash layers are not rendered
 * at all; a single static `ec-daylight` gradient is rendered instead. No network, no animation loop.
 */
import { useLayoutEffect, useRef, type ReactElement } from "react";

export interface LightLayersProps {
  mode: "dark" | "light";
  /** Changes when the page content changes (e.g. view switch) so the centre is re-measured. */
  remeasureKey?: string;
}

function measure(root: HTMLElement): void {
  const core = root.querySelector('[data-testid="lantern-core"]');
  if (core === null) {
    // No lit lantern on this view (e.g. the disk view): no light source, so the layers are hidden.
    root.setAttribute("data-light", "off");
    return;
  }
  root.setAttribute("data-light", "on");
  const c = core.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  root.style.setProperty("--ec-lx", `${Math.round(c.left - r.left + c.width / 2)}px`);
  root.style.setProperty("--ec-ly", `${Math.round(c.top - r.top + c.height / 2)}px`);
}

export function LightLayers({ mode, remeasureKey }: LightLayersProps): ReactElement {
  const dark = mode === "dark";
  const overlayRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // The overlay is a direct child of the app root; the CSS variables are written onto the root.
    const root = overlayRef.current?.parentElement;
    if (!dark || root === null || root === undefined) return undefined;
    const run = (): void => measure(root);
    run();
    window.addEventListener("resize", run);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(run) : null;
    ro?.observe(root);
    return () => {
      window.removeEventListener("resize", run);
      ro?.disconnect();
      root.removeAttribute("data-light");
    };
  }, [dark, remeasureKey]);
  // Day: one soft cool-white daylight gradient from the top left. No lantern light, no flicker, and
  // nothing to measure: the effect above is inert in light mode, so a switch leaves no listeners.
  if (!dark) return <div className="ec-daylight" aria-hidden="true" data-testid="daylight" />;
  return (
    <div ref={overlayRef} className="ec-light" aria-hidden="true" data-testid="light-overlay">
      <div className="ec-light-a ec-flicker" data-testid="light-dodge" data-layer="a" />
      <div className="ec-light-b ec-flicker" data-testid="light-wash" data-layer="b" />
    </div>
  );
}
