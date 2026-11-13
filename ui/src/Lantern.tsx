/**
 * The header lantern, drawn in code as inline SVG from fixed constants only (no untrusted data).
 * Decoration: hidden from assistive technology and not focusable. No network requests.
 *
 * `lit` shows a hot core (radial gradient). Unlit shows clear grey glass with a faint reflection
 * and a thin static wisp of smoke above the cap. The core centre in SVG user units is exported as
 * `LANTERN_CORE` so a light overlay can be positioned from the rendered `lantern-core` element.
 */
import type { ReactElement } from "react";

/** SVG user-unit box of the lantern. */
export const LANTERN_VIEWBOX = { width: 40, height: 72 } as const;
/** Centre and radius of the hot core in SVG user units. */
export const LANTERN_CORE = { cx: 20, cy: 42, r: 10 } as const;

const BRASS = "#b08d57";
const CORE_GRADIENT_ID = "ec-lantern-core";

export function Lantern({ lit }: { lit: boolean }): ReactElement {
  return (
    <svg
      className="ec-header-lantern"
      data-testid="lantern"
      data-lit={lit ? "true" : "false"}
      viewBox={`0 0 ${LANTERN_VIEWBOX.width} ${LANTERN_VIEWBOX.height}`}
      width={30}
      height={54}
      aria-hidden="true"
      focusable="false"
    >
      {lit ? (
        <defs>
          <radialGradient id={CORE_GRADIENT_ID} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff7d6" />
            <stop offset="45%" stopColor="#ffd27a" />
            <stop offset="100%" stopColor="#ffd27a" stopOpacity={0} />
          </radialGradient>
        </defs>
      ) : null}
      {lit ? null : (
        <path
          data-testid="lantern-smoke"
          d="M20 12 C16 9 24 6 20 3 C18 1.5 19 1 20 0.5"
          fill="none"
          stroke="#8b94a1"
          strokeOpacity={0.5}
          strokeWidth={1}
          strokeLinecap="round"
        />
      )}
      {/* Glass first so the frame is drawn over it. */}
      <rect
        x={11}
        y={28}
        width={18}
        height={28}
        rx={3}
        fill={lit ? "#ffd27a" : "#9aa5b1"}
        fillOpacity={lit ? 0.14 : 0.18}
      />
      {lit ? (
        <circle
          data-testid="lantern-core"
          cx={LANTERN_CORE.cx}
          cy={LANTERN_CORE.cy}
          r={LANTERN_CORE.r}
          fill={`url(#${CORE_GRADIENT_ID})`}
        />
      ) : (
        <path
          data-testid="lantern-reflection"
          d="M14.5 32 V46"
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.45}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      )}
      <g fill="none" stroke={BRASS} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
        {/* Handle ring */}
        <circle cx={20} cy={17} r={4.5} />
        {/* Cap */}
        <path d="M13 28 L16.5 22 H23.5 L27 28 Z" />
        {/* Glass outline and its two thin bars */}
        <rect x={11} y={28} width={18} height={28} rx={3} />
        <path d="M17 28 V56 M23 28 V56" strokeWidth={0.8} />
        {/* Base */}
        <rect x={9} y={56} width={22} height={5} rx={1.5} />
      </g>
    </svg>
  );
}
