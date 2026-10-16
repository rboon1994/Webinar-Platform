import { instant, range } from "./webinar-state.js";

export type RunWindow = { id: string; createdAt: Date; sessions: readonly { startsAt: Date; endsAt: Date }[] };

export type RunPhase = "live" | "upcoming" | "ended";

type Candidate = { runId: string; phase: RunPhase; rank: number; key: number; created: number };

// phase first (live, upcoming, ended), then the key within the phase, then the oldest run, then the smaller id
const before = (a: Candidate, b: Candidate) =>
  a.rank !== b.rank ? a.rank < b.rank : a.key !== b.key ? a.key < b.key : a.created !== b.created ? a.created < b.created : a.runId < b.runId;

// The run to show: a live one, else the one whose next session starts first, else the one that ended last.
// Runs without sessions are ignored. The caller filters out inactive and (for a logged-in viewer) non-enrolled runs.
// Pure; throws RangeError for an invalid Date or a session that does not end after it starts.
export function selectCurrentRun(runs: readonly RunWindow[], now: Date): { runId: string; phase: RunPhase } | null {
  const at = instant(now, "now");
  let best: Candidate | undefined;
  for (const [i, run] of runs.entries()) {
    const created = instant(run.createdAt, `runs[${i}].createdAt`);
    const spans = run.sessions.map((session, j) => range(session.startsAt, session.endsAt, `runs[${i}].sessions[${j}]`));
    if (spans.length === 0) continue;
    const future = spans.filter((span) => span.start > at).map((span) => span.start);
    const candidate: Candidate = spans.some((span) => span.start <= at && at < span.end)
      ? { runId: run.id, phase: "live", rank: 0, key: 0, created }
      : future.length > 0
        ? { runId: run.id, phase: "upcoming", rank: 1, key: Math.min(...future), created }
        : { runId: run.id, phase: "ended", rank: 2, key: -Math.max(...spans.map((span) => span.end)), created };
    if (!best || before(candidate, best)) best = candidate;
  }
  return best ? { runId: best.runId, phase: best.phase } : null;
}

// The run a new viewer can be enrolled in: the current run if it is live or upcoming, never one that has ended.
export function selectEnrollableRun(runs: readonly RunWindow[], now: Date): string | null {
  const current = selectCurrentRun(runs, now);
  return current && current.phase !== "ended" ? current.runId : null;
}
