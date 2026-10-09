import { z } from "zod";

const subtitleLocatorSchema = z.object({
  v: z.literal(1),
  kind: z.literal("subtitle"),
  cueStart: z.number().int().positive(),
  cueEnd: z.number().int().positive(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
});

const textLocatorSchema = z.object({
  v: z.literal(1),
  kind: z.literal("text"),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  headingPath: z.array(z.string()),
});

export const knowledgeLocatorSchema = z.discriminatedUnion("kind", [subtitleLocatorSchema, textLocatorSchema]);

