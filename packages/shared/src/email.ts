// A part of the address may not start or end with a dot or contain two dots in a row
const badDots = (part: string) => part.startsWith(".") || part.endsWith(".") || part.includes("..");

// Lower-cased address, or null when it cannot be one. "+" suffixes and Gmail dots are kept.
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim();
  if (email.length === 0 || email.length > 254) return null;
  // printable ASCII only: no whitespace, control characters or non-ASCII
  if (!/^[\x21-\x7e]+$/.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local === "" || domain === "" || !domain.includes(".") || badDots(local) || badDots(domain)) return null;
  return email.toLowerCase();
}
