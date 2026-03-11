import { batchUploadAudio, runSession2 } from "../services/gemini.js";
import {
  SESSION2_SYSTEM_PROMPT,
  buildSession2UserPrompt,
} from "../prompts/session2.js";
import {
  Session2ResponseSchema,
  type Session2Response,
} from "../types/index.js";
import type { Track } from "../types/index.js";

export interface Session2Options {
  tracks: Track[];
  task: string;
  targetDurationHours: number;
}

export async function executeSession2(
  opts: Session2Options
): Promise<Session2Response> {
  const { tracks, task, targetDurationHours } = opts;

  // Upload all audio files via File API
  console.log(`[Session2] Uploading ${tracks.length} audio files...`);
  const filePaths = tracks.map((t) => t.localPath);

  const uploadMap = await batchUploadAudio(filePaths, 5, (done, total) => {
    process.stdout.write(`\r[Session2] Upload progress: ${done}/${total}`);
  });
  console.log(`\n[Session2] All files uploaded`);

  // Build audio references in same order as tracks
  const audioRefs = tracks.map((t) => {
    const ref = uploadMap.get(t.localPath);
    if (!ref) throw new Error(`Upload missing for: ${t.localPath}`);
    return ref;
  });

  // Build trimmed metadata for prompt context
  const tracksMeta = tracks.map((t) => ({
    id: t.id,
    name: t.name,
    key: t.analysis.keyDetected,
    scale: t.analysis.scaleDetected,
    bpm: t.analysis.bpmDetected,
    centroid: t.analysis.spectralCentroid,
    mood: t.analysis.mlMoodRelaxed,
    dance: t.analysis.mlDanceability,
    duration: t.analysis.durationSeconds,
    loudness: t.analysis.loudnessDb,
  }));

  const userPrompt = buildSession2UserPrompt(
    JSON.stringify(tracksMeta),
    task,
    targetDurationHours
  );

  // Call Gemini with audio + text
  console.log(
    `[Session2] Sending ${audioRefs.length} audio files + metadata to Gemini...`
  );
  const rawResponse = await runSession2(
    SESSION2_SYSTEM_PROMPT,
    audioRefs,
    userPrompt
  );

  // Parse and validate
  console.log(`[Session2] Parsing response (${rawResponse.length} chars)...`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (e) {
    console.error(`[Session2] Failed to parse JSON response:`);
    console.error(rawResponse.slice(0, 500));
    throw new Error("Gemini returned invalid JSON for Session 2");
  }

  const validated = Session2ResponseSchema.parse(parsed);

  console.log(`[Session2] Chain: ${validated.chain.length} tracks`);
  console.log(`[Session2] Rejected: ${validated.rejected.length} tracks`);
  console.log(`[Session2] Scores: ${validated.scores.length} tracks`);

  return validated;
}
