/**
 * Grade badges shared by the disk page and the library cards. Colour is never the only signal:
 * every badge carries its text. Colours live in styles.ts (`.ec-badge[data-grade]`).
 */
import type { ReactElement } from "react";
import type { GraveState } from "../../src/shared/schema";

/** One coloured badge. `text` is the full visible label, for example "Recovered 3". */
export function GradeBadge({
  grade,
  text,
  testId,
  muted = false,
}: {
  grade: GraveState;
  text: string;
  testId?: string;
  /** A zero count: grey outline, no fill colour. */
  muted?: boolean;
}): ReactElement {
  return (
    <span className="ec-badge" data-grade={grade} data-muted={muted ? "true" : undefined} data-testid={testId}>
      {text}
    </span>
  );
}

/** Recovered, partial and lost counts as three badges (zero counts are shown muted). */
export function CountBadges({
  counts,
}: {
  counts: Record<GraveState, number>;
}): ReactElement {
  return (
    <span className="ec-badges" data-testid="count-badges">
      <GradeBadge grade="recovered" text={`Recovered ${counts.recovered}`} muted={counts.recovered === 0} />
      <GradeBadge grade="partial" text={`Partial ${counts.partial}`} muted={counts.partial === 0} />
      <GradeBadge grade="lost" text={`Lost ${counts.lost}`} muted={counts.lost === 0} />
    </span>
  );
}
