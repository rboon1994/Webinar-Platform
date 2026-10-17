import { E164_CHECK } from "./phone.js";

export type KnownPerson = {
  id: string;
  phone: string | null;
  email: string | null;
  status: "ACTIVE" | "KICKED";
  enrolledRunIds: readonly string[];
};

// the caller has normalized the three fields (phone as E.164, e-mail in lower case)
export type OpenInput = { name: string; phone: string; email: string };

// byEmail is "A" and byPhone is "B" in the rules: the people the caller found by e-mail and by phone
export type OpenLookup = { byEmail: KnownPerson | null; byPhone: KnownPerson | null };

// who is let in: an existing person, or the one that createAttendee is about to create
export type AttendeeRef = { kind: "existing"; attendeeId: string } | { kind: "new" };

// plain data; the function never does any of it
export type OpenWrite =
  | { type: "createAttendee"; name: string; phone: string; email: string; source: "SELF_REGISTERED" }
  | { type: "fillPhone"; attendeeId: string; phone: string }
  | { type: "fillEmail"; attendeeId: string; email: string }
  | { type: "enroll"; runId: string; attendee: AttendeeRef };

export type OpenWarning = { code: "EMAIL_PHONE_CONFLICT"; emailPersonId: string; phonePersonId: string };

export type OpenRejectionReason = "KICKED" | "NO_RUN";

// a rejection carries no writes at all: the type has no such field
export type OpenResolution =
  | { kind: "rejected"; reason: OpenRejectionReason }
  | { kind: "proceed"; attendee: AttendeeRef; runId: string; writes: OpenWrite[]; warnings: OpenWarning[] };

// The OPEN rules of "身份匹配规则", in their order: check the input, refuse anyone kicked, refuse when there is no run,
// and only then work out the writes. A (found by e-mail) wins over B (found by phone). A person's name is never changed.
// Pure. Throws RangeError for input that is a programming error: the input is not normalized, or a found person does not
// carry the e-mail / phone they were found by.
export function resolveIdentity(input: OpenInput, lookup: OpenLookup, enrollableRunId: string | null): OpenResolution {
  const name = input.name.trim();
  if (name === "") throw new RangeError("name must not be empty");
  if (!E164_CHECK.test(input.phone)) throw new RangeError("phone must be an E.164 number");
  if (input.email === "" || input.email !== input.email.toLowerCase()) throw new RangeError("email must be non-empty and in lower case");
  const { byEmail: a, byPhone: b } = lookup;
  if (a !== null && a.email !== input.email) throw new RangeError("byEmail must carry the e-mail it was found by");
  if (b !== null && b.phone !== input.phone) throw new RangeError("byPhone must carry the phone it was found by");

  if (a?.status === "KICKED" || b?.status === "KICKED") return { kind: "rejected", reason: "KICKED" };
  if (enrollableRunId === null) return { kind: "rejected", reason: "NO_RUN" };

  const runId = enrollableRunId;
  if (a === null && b === null) {
    const attendee: AttendeeRef = { kind: "new" };
    const writes: OpenWrite[] = [
      { type: "createAttendee", name, phone: input.phone, email: input.email, source: "SELF_REGISTERED" },
      { type: "enroll", runId, attendee },
    ];
    return { kind: "proceed", attendee, runId, writes, warnings: [] };
  }

  const person = a ?? (b as KnownPerson);
  const attendee: AttendeeRef = { kind: "existing", attendeeId: person.id };
  const writes: OpenWrite[] = [];
  const warnings: OpenWarning[] = [];
  const conflict = a !== null && b !== null && a.id !== b.id;
  if (conflict) warnings.push({ code: "EMAIL_PHONE_CONFLICT", emailPersonId: a.id, phonePersonId: b.id });
  else if (a !== null && b === null && a.phone === null) writes.push({ type: "fillPhone", attendeeId: a.id, phone: input.phone });
  else if (b !== null && a === null && b.email === null) writes.push({ type: "fillEmail", attendeeId: b.id, email: input.email });
  if (!person.enrolledRunIds.includes(runId)) writes.push({ type: "enroll", runId, attendee });
  return { kind: "proceed", attendee, runId, writes, warnings };
}
