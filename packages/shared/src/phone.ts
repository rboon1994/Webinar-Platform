import { parseIncompletePhoneNumber, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type PhoneReason =
  | "CONTAINS_LETTERS"
  | "UNPARSEABLE"
  | "NOT_POSSIBLE"
  | "E164_OUT_OF_RANGE"
  | "E164_NOT_STABLE"
  | "NOT_VALID_RANGE"
  | "LOOKS_LIKE_INCLUDES_COUNTRY_CODE"
  | "UNEXPECTED_CHARACTERS";

export type PhoneParse = {
  status: "ready" | "review" | "invalid";
  e164: string | null;
  country: string | null;
  reasons: PhoneReason[];
};

// the rule of the database CHECK on Attendee.phone (the library accepts a few numbers outside it); shared with resolveIdentity
export const E164_CHECK = /^\+[1-9][0-9]{6,14}$/;

// layout characters carry no meaning: format characters (zero-width, direction marks, BOM) go, every kind of whitespace
// becomes a plain space, every kind of dash and the minus sign become "-"
const clean = (text: string) => text.replace(/\p{Cf}/gu, "").replace(/\s/gu, " ").replace(/[\p{Pd}\u{2212}]/gu, "-");

// anything left that a person would not write inside a phone number
const UNEXPECTED = /[^\p{Nd} +\-().]/u;

const invalid = (reason: PhoneReason): PhoneParse => ({ status: "invalid", e164: null, country: null, reasons: [reason] });

// invalid: letters, unparseable, not even possible, or outside the database CHECK (e164 is null).
// review: possible but not valid, typed without +/00 yet the digits already equal the result (country code typed twice),
// or other characters the library silently ignored (it may have read only the first of several numbers).
// An unknown defaultCountry never throws: local numbers come back UNPARSEABLE, "+" numbers parse normally.
export function parsePhone(raw: string, defaultCountry: CountryCode): PhoneParse {
  const normalized = raw.normalize("NFKC"); // full-width digits and "＋" become ASCII
  const text = clean(normalized);
  if (/[A-Za-z]/.test(normalized) || /[A-Za-z]/.test(text)) return invalid("CONTAINS_LETTERS");
  const phone = parsePhoneNumberFromString(text, defaultCountry);
  if (!phone) return invalid("UNPARSEABLE");
  if (!phone.isPossible()) return invalid("NOT_POSSIBLE");
  if (!E164_CHECK.test(phone.number)) return invalid("E164_OUT_OF_RANGE");
  // the library may keep a zero after the country code once and strip it on the next parse; reject those so
  // that normalizing an already-normalized number never changes it
  if (parsePhoneNumberFromString(phone.number)?.number !== phone.number) return invalid("E164_NOT_STABLE");

  const reasons: PhoneReason[] = [];
  if (!phone.isValid()) reasons.push("NOT_VALID_RANGE");
  const typed = parseIncompletePhoneNumber(text.trim()); // ASCII digits, a leading "+" kept
  if (!/^(\+|00)/.test(typed) && typed.replace(/\D/g, "") === phone.number.slice(1)) reasons.push("LOOKS_LIKE_INCLUDES_COUNTRY_CODE");
  if (UNEXPECTED.test(text)) reasons.push("UNEXPECTED_CHARACTERS");
  return { status: reasons.length > 0 ? "review" : "ready", e164: phone.number, country: phone.country ?? null, reasons };
}

// E.164 for ready and review results, null for invalid ones; allowedCountries (when given) must contain the number's country
export function normalizePhone(raw: string, defaultCountry: CountryCode, allowedCountries?: string[]): string | null {
  const { e164, country } = parsePhone(raw, defaultCountry);
  if (e164 === null) return null;
  if (allowedCountries && (country === null || !allowedCountries.includes(country))) return null;
  return e164;
}
