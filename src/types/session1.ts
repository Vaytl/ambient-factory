import { z } from "zod";

export const Session1ResponseSchema = z.object({
  selectedTrackIds: z.array(z.string()).min(5),
  reasoning: z.string(),
});

export type Session1Response = z.infer<typeof Session1ResponseSchema>;
