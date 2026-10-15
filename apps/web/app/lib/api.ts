import { healthResponseSchema, timeResponseSchema } from "@webinar/shared";

async function getJson(path: string): Promise<unknown> {
  const base = process.env.API_URL || "http://localhost:4000";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { cache: "no-store" });
  } catch (error) {
    // undici reports only "fetch failed"; the useful part (e.g. ECONNREFUSED) is in the cause
    const cause = error instanceof Error ? error.cause : undefined;
    const detail = (cause as { code?: string } | undefined)?.code ?? String(error);
    throw new Error(`GET ${path} failed: ${detail}`, { cause: error });
  }
  if (res.status !== 200) throw new Error(`GET ${path} returned HTTP ${res.status}`);
  return res.json();
}

export const fetchHealth = async () => healthResponseSchema.parse(await getJson("/health"));
export const fetchTime = async () => timeResponseSchema.parse(await getJson("/time"));
