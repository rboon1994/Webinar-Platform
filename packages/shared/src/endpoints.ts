import { z } from "zod";

export const healthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// z.iso.datetime() accepts only the "Z" suffix unless { offset: true } is passed
export const timeResponseSchema = z.object({ now: z.iso.datetime() });
export type TimeResponse = z.infer<typeof timeResponseSchema>;
