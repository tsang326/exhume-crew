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
}: {
  grade: GraveState;
  text: string;
  testId?: string;
}): ReactElement {
  return (
    <span className="ec-badge" data-grade={grade} data-testid={testId}>
      {text}
    </span>
  );
}

/** Recovered, partial and lost counts as three badges (zero counts are shown too). */
export function CountBadges({
  counts,
}: {
  counts: Record<GraveState, number>;
}): ReactElement {
  return (
    <span className="ec-badges" data-testid="count-badges">
      <GradeBadge grade="recovered" text={`Recovered ${counts.recovered}`} />
      <GradeBadge grade="partial" text={`Partial ${counts.partial}`} />
      <GradeBadge grade="lost" text={`Lost ${counts.lost}`} />
    </span>
  );
}
