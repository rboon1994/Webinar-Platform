// Where in the video a viewer should be: seconds since the session started, held between 0 and the video length. Not rounded.
export function computeTargetSeconds(serverNowMs: number, startsAtMs: number, durationSeconds: number): number {
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(startsAtMs) || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new RangeError("serverNowMs, startsAtMs and durationSeconds must be finite and durationSeconds must not be negative");
  }
  return Math.min(Math.max((serverNowMs - startsAtMs) / 1000, 0), durationSeconds);
}
