import { z } from "zod";

export const TrackScoreSchema = z.object({
  id: z.string(),
  score: z.number().min(1).max(100),
  notes: z.string().optional(),
});

export const RejectedTrackSchema = z.object({
  id: z.string(),
  reason: z.string(),
  rejectedAt: z.string().optional(),
});

export const ChainEntrySchema = z.object({
  position: z.number(),
  trackId: z.string(),
  trackName: z.string(),
  crossfadeDuration: z.number(),
  crossfadeCurve: z.string(),
  volumeAdjustDb: z.number(),
  keyDetected: z.string(),
  bpmDetected: z.number(),
  spectralCentroid: z.number(),
});

export const Session2ResponseSchema = z.object({
  mixingStrategy: z.string(),
  chain: z.array(ChainEntrySchema).min(5),
  rejected: z.array(RejectedTrackSchema),
  scores: z.array(TrackScoreSchema),
  ffmpegCommand: z.string(),
});

export type TrackScore = z.infer<typeof TrackScoreSchema>;
export type RejectedTrack = z.infer<typeof RejectedTrackSchema>;
export type ChainEntry = z.infer<typeof ChainEntrySchema>;
export type Session2Response = z.infer<typeof Session2ResponseSchema>;
