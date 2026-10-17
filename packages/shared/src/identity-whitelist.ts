import type { CountryCode } from "libphonenumber-js/max";
import { selectCurrentRun, type RunPhase, type RunWindow } from "./current-run.js";
import { normalizeEmail } from "./email.js";
import type { OpenRejectionReason } from "./identity-open.js";
import { parsePhone } from "./phone.js";
import { instant } from "./webinar-state.js";

export type ParsedWhitelistInput = { kind: "email"; email: string } | { kind: "phone"; phone: string } | { kind: "invalid" };

// Classifies what a viewer typed; does no lookup. Only input with an ASCII @ is an e-mail (and then only an e-mail),
// everything else is a phone number. A full-width @ is not an @. Ready and review phone numbers both count.
export function parseWhitelistInput(raw: string, defaultCountry: CountryCode): ParsedWhitelistInput {
  if (raw.includes("@")) {
    const email = normalizeEmail(raw);
    return email === null ? { kind: "invalid" } : { kind: "email", email };
  }
  const { e164 } = parsePhone(raw, defaultCountry);
  return e164 === null ? { kind: "invalid" } : { kind: "phone", phone: e164 };
}

// the person the caller found on the list, with the runs they are enrolled in (inactive runs already filtered out)
export type WhitelistMatch = { id: string; status: "ACTIVE" | "KICKED"; enrolledRuns: readonly RunWindow[] } | null;

export type WhitelistDenialReason = "NOT_FOUND" | "KICKED" | "NOT_ENROLLED";

export type WhitelistAccess =
  | { kind: "allowed"; attendeeId: string; runId: string; phase: RunPhase }
  | { kind: "denied"; reason: WhitelistDenialReason };

// Not found, then kicked (before "not enrolled"), then the current run among the runs the person is enrolled in.
// A run that has ended still lets the person in (the page then says the series is over). Pure; throws RangeError for an
// invalid now (checked first) and, from selectCurrentRun, for an invalid session; neither is caught.
export function resolveWhitelistAccess(match: WhitelistMatch, now: Date): WhitelistAccess {
  instant(now, "now"); // a bad now is a programming error, also when nobody was found or the person is kicked
  if (match === null) return { kind: "denied", reason: "NOT_FOUND" };
  if (match.status === "KICKED") return { kind: "denied", reason: "KICKED" };
  const current = selectCurrentRun(match.enrolledRuns, now);
  if (current === null) return { kind: "denied", reason: "NOT_ENROLLED" };
  return { kind: "allowed", attendeeId: match.id, runId: current.runId, phase: current.phase };
}

export type PublicReason = "NOT_FOUND" | "REVOKED" | "NO_RUN";

// What a viewer is told. "Not enrolled" says the same as "not found" so the answer does not reveal which condition failed.
export function publicReason(reason: WhitelistDenialReason | OpenRejectionReason): PublicReason {
  switch (reason) {
    case "NOT_FOUND":
    case "NOT_ENROLLED":
      return "NOT_FOUND";
    case "KICKED":
      return "REVOKED";
    case "NO_RUN":
      return "NO_RUN";
    default: {
      const unknown: never = reason;
      throw new RangeError(`unknown reason: ${String(unknown)}`);
    }
  }
}
