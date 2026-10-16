export type SessionWindow = { id: string; startsAt: Date; endsAt: Date };

export type WebinarState =
  | { state: "live"; session: SessionWindow }
  | { state: "upcoming"; phase: "before_first" | "between_days"; next: SessionWindow }
  | { state: "ended"; lastEnded: SessionWindow }
  | { state: "no_schedule" };

// the time of a valid Date, otherwise RangeError (a value that is not a Date counts as invalid)
export function instant(date: Date, name: string): number {
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (Number.isNaN(time)) throw new RangeError(`${name} is not a valid date`);
  return time;
}

// start and end times of a session, RangeError unless it ends after it starts
export function range(startsAt: Date, endsAt: Date, name: string): { start: number; end: number } {
  const start = instant(startsAt, `${name}.startsAt`);
  const end = instant(endsAt, `${name}.endsAt`);
  if (end <= start) throw new RangeError(`${name}.endsAt must be after startsAt`);
  return { start, end };
}

type Span = { session: SessionWindow; start: number; end: number };

// the span with the lowest `by`; ties go to the smaller id (UTF-16 code unit order, like a < b)
function lowest(spans: Span[], by: (span: Span) => number): Span | undefined {
  let best: Span | undefined;
  for (const span of spans) {
    if (!best || by(span) < by(best) || (by(span) === by(best) && span.session.id < best.session.id)) best = span;
  }
  return best;
}

// Pure: all times come from the arguments. Throws RangeError for an invalid Date or a session that does not end after it starts.
export function getWebinarState(sessions: readonly SessionWindow[], now: Date): WebinarState {
  const at = instant(now, "now");
  const spans = sessions.map((session, i) => ({ session, ...range(session.startsAt, session.endsAt, `sessions[${i}]`) }));

  const live = lowest(spans.filter((span) => span.start <= at && at < span.end), (span) => span.start);
  if (live) return { state: "live", session: live.session };

  const next = lowest(spans.filter((span) => span.start > at), (span) => span.start);
  if (next) return { state: "upcoming", phase: spans.some((span) => span.end <= at) ? "between_days" : "before_first", next: next.session };

  const lastEnded = lowest(spans, (span) => -span.end);
  return lastEnded ? { state: "ended", lastEnded: lastEnded.session } : { state: "no_schedule" };
}
