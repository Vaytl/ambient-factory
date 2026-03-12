import { z } from "zod";

export const TransitionAuditSchema = z.object({
  fromTrack: z.string(),
  toTrack: z.string(),
  timecode: z.string(),
  crossfadeScore: z.number().min(1).max(100),
  tonalScore: z.number().min(1).max(100),
  volumeScore: z.number().min(1).max(100),
  issues: z.array(z.string()),
});

export const MixIssueSchema = z.object({
  timecode: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string(),
});

export const Session3ResponseSchema = z.object({
  overallScore: z.number().min(1).max(100),
  overallVerdict: z.enum(["pass", "fail"]),
  scenarioFit: z.string(),
  transitions: z.array(TransitionAuditSchema),
  energyCurve: z.string(),
  issues: z.array(MixIssueSchema),
});

export type TransitionAudit = z.infer<typeof TransitionAuditSchema>;
export type MixIssue = z.infer<typeof MixIssueSchema>;
export type Session3Response = z.infer<typeof Session3ResponseSchema>;
