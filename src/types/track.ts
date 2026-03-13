import { z } from "zod";

export const TrackAnalysisSchema = z.object({
  durationSeconds: z.number(),
  loudnessDb: z.number(),
  dynamicRangeDb: z.number().optional(),
  spectralCentroid: z.number(),
  spectralCentroidStd: z.number().optional(),
  spectralFlatness: z.number().optional(),
  perceptualSharpness: z.number().optional(),
  rms: z.number().optional(),
  rmsStd: z.number().optional(),
  zcr: z.number().optional(),
  keyDetected: z.string(),
  scaleDetected: z.string(),
  keyConfidence: z.number().optional(),
  bpmDetected: z.number(),
  danceability: z.number().optional(),
  dynamicComplexity: z.number().optional(),
  mlMoodRelaxed: z.number(),
  mlMoodAggressive: z.number().optional(),
  mlDanceability: z.number(),
  mlInstrumental: z.number().optional(),
  mlGenres: z
    .array(z.union([z.string(), z.object({ label: z.string(), score: z.number() })]))
    .optional(),
});

export const TrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  localPath: z.string(),
  createdAt: z.string().optional(),
  analysis: TrackAnalysisSchema,
});

export type Track = z.infer<typeof TrackSchema>;
export type TrackAnalysis = z.infer<typeof TrackAnalysisSchema>;

/**
 * Trimmed track object for Session 1 TOON encoding.
 * Only fields relevant for metadata selection.
 */
export interface TrackMetaTrimmed {
  id: string;
  name: string;
  key: string;
  scale: string;
  bpm: number;
  centroid: number;
  mood: number;
  dance: number;
  dur: number;
  loud: number;
  sharp: number;
}
