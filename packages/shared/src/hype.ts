import { z } from "zod";

const MAX_COUNT = 1_000_000;

// The curve of the virtual audience: the base at second 0, then a straight line to each node, then flat after the last node.
export const hypeConfigSchema = z
  .strictObject({
    base: z.number().int().min(0).max(MAX_COUNT).default(0),
    nodes: z
      .array(z.strictObject({ minute: z.number().int().min(1).max(1440), count: z.number().int().min(0).max(MAX_COUNT) }))
      .max(100)
      .default([]),
    jitterPercent: z.number().int().min(0).max(100).default(0),
    jitterIntervalSeconds: z.number().int().min(1).max(300).default(10),
  })
  .refine((config) => config.nodes.every((node, i) => i === 0 || node.minute > config.nodes[i - 1].minute), {
    message: "node minutes must be strictly increasing",
    path: ["nodes"],
  });

export type HypeConfig = z.output<typeof hypeConfigSchema>;

// what the functions below read; read-only, so a frozen configuration is accepted too
export type HypeCurve = { readonly base: number; readonly nodes: readonly { readonly minute: number; readonly count: number }[] };
export type HypeSettings = HypeCurve & { readonly jitterPercent: number; readonly jitterIntervalSeconds: number };

const parsedDefault = hypeConfigSchema.parse({});
// frozen so nobody changes the shared default by accident
export const defaultHypeConfig: HypeConfig = Object.freeze({ ...parsedDefault, nodes: Object.freeze([...parsedDefault.nodes]) }) as HypeConfig;

// The curve value at a moment: straight lines between the points, the last count after the last point, rounded half up.
// Only + - * / are used, so every environment gives the same result. Throws RangeError for a time that is not finite
// and for nodes that are not finite or do not strictly increase in minutes (the schema already guarantees it).
export function computeHypeBase(config: HypeCurve, elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds)) throw new RangeError("elapsedSeconds must be a finite number");
  const points = [{ second: 0, count: config.base }, ...config.nodes.map((node) => ({ second: node.minute * 60, count: node.count }))];
  for (const [i, point] of points.entries()) {
    if (!Number.isFinite(point.second) || !Number.isFinite(point.count) || (i > 0 && point.second <= points[i - 1].second)) {
      throw new RangeError("the base and the nodes must be finite and the node minutes strictly increasing");
    }
  }
  const t = Math.max(elapsedSeconds, 0);
  const last = points[points.length - 1];
  if (t >= last.second) return Math.round(last.count);
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (t < to.second) return Math.round(from.count + ((to.count - from.count) * (t - from.second)) / (to.second - from.second));
  }
  throw new Error("unreachable: t is below the last point");
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// the finalizer of murmur3: spreads every input bit over the whole 32-bit result
function fmix32(value: number): number {
  let h = value;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// For this file and its tests only (not exported from the package).
// A number in [0, 1) that depends only on the session id and the time slice: FNV-1a over the id's UTF-16 code units,
// then the slice mixed in (low and high 32 bits), then divided by 2^32. Integer operations only (Math.imul, >>>, ^, +).
export function seededRandom(sessionId: string, slice: number): number {
  if (typeof sessionId !== "string" || sessionId === "") throw new RangeError("sessionId must not be empty");
  if (!Number.isSafeInteger(slice) || slice < 0) throw new RangeError("slice must be a non-negative integer");
  const low = slice % 4294967296;
  const high = (slice - low) / 4294967296;
  let h = fnv1a(sessionId);
  h = fmix32((h ^ Math.imul(low, 0x9e3779b1)) >>> 0);
  h = fmix32((h + Math.imul(high + 1, 0x7feb352d)) >>> 0);
  return h / 4294967296;
}

// The curve value moved by up to jitterPercent either way, the same for everyone in the same session and time slice.
export function seededJitter(sessionId: string, slice: number, curveValue: number, jitterPercent: number): number {
  if (!Number.isFinite(curveValue) || curveValue < 0) throw new RangeError("curveValue must be a finite number, not negative");
  if (!Number.isFinite(jitterPercent) || jitterPercent < 0 || jitterPercent > 100) throw new RangeError("jitterPercent must be between 0 and 100");
  const r = seededRandom(sessionId, slice);
  return Math.round(curveValue * (1 - jitterPercent / 100 + (r * 2 * jitterPercent) / 100));
}

// The number of people to show: the virtual audience plus the real one. Used by the browser and the server alike.
// The curve is read at the start of the time slice, so everyone in the same slice gets the same virtual audience.
export function computeHypeTarget(config: HypeSettings, sessionId: string, elapsedSeconds: number, realOnline: number): number {
  if (!Number.isInteger(realOnline) || realOnline < 0) throw new RangeError("realOnline must be a non-negative integer");
  if (!Number.isFinite(elapsedSeconds)) throw new RangeError("elapsedSeconds must be a finite number");
  const elapsed = Math.max(elapsedSeconds, 0);
  const slice = Math.floor(elapsed / config.jitterIntervalSeconds);
  const curve = computeHypeBase(config, slice * config.jitterIntervalSeconds);
  return seededJitter(sessionId, slice, curve, config.jitterPercent) + realOnline;
}
