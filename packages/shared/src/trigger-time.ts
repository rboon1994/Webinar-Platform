const WHOLE = /^\d+$/;
const SECONDS = /^\d+(\.\d+)?$/;

// Whole seconds from "90", 90, "mm:ss" or "h:mm:ss" (full-width colons allowed), or null.
// With two parts the minutes may exceed 59; with three they may not. Seconds must be below 60 before rounding.
export function parseTriggerSeconds(input: string | number, opts: { maxSeconds?: number } = {}): number | null {
  let total: number;
  if (typeof input === "number") {
    if (input < 0) return null;
    total = input;
  } else if (typeof input === "string") {
    const parts = input.trim().replaceAll("：", ":").split(":");
    if (parts.length > 3) return null;
    const last = parts.pop()!;
    if (!SECONDS.test(last) || !parts.every((part) => WHOLE.test(part))) return null;
    const seconds = Number(last);
    const [larger = 0, smaller = 0] = parts.map(Number); // minutes; or hours then minutes
    if (parts.length > 0 && seconds >= 60) return null;
    if (parts.length === 2 && smaller >= 60) return null;
    total = parts.length === 2 ? larger * 3600 + smaller * 60 + seconds : larger * 60 + seconds;
  } else {
    return null;
  }
  if (!Number.isFinite(total)) return null;
  const rounded = Math.round(total) + 0; // + 0 turns -0 into 0
  return opts.maxSeconds !== undefined && rounded > opts.maxSeconds ? null : rounded;
}
