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
  targetMinutes: number;
  toleranceMinutes?: number;
}

const DEFAULT_TOLERANCE = 10;

/**
 * Build a text label for a single track to precede its audio in the parts array.
 * This ensures Gemini can reliably match each audio file to its metadata.
 */
function buildTrackLabel(track: Track, index: number, total: number): string {
  const a = track.analysis;
  return [
    `=== Track ${index + 1}/${total} ===`,
    `id: ${track.id}`,
    `name: ${track.name}`,
    `localPath: ${track.localPath}`,
    `key: ${a.keyDetected} ${a.scaleDetected}`,
    `bpm: ${a.bpmDetected}`,
    `centroid: ${a.spectralCentroid}`,
    `mood: ${a.mlMoodRelaxed}`,
    `dance: ${a.mlDanceability}`,
    `dur: ${a.durationSeconds}s (${(a.durationSeconds / 60).toFixed(1)} min)`,
    `loud: ${a.loudnessDb} dB`,
    `sharp: ${a.perceptualSharpness ?? 0}`,
  ].join("\n");
}

export async function executeSession2(
  opts: Session2Options
): Promise<Session2Response> {
  const {
    tracks,
    task,
    targetMinutes,
    toleranceMinutes = DEFAULT_TOLERANCE,
  } = opts;

  // Upload all audio files via File API
  console.log(`[Session2] Uploading ${tracks.length} audio files...`);
  const filePaths = tracks.map((t) => t.localPath);

  const uploadMap = await batchUploadAudio(filePaths, 5, (done, total) => {
    process.stdout.write(`\r[Session2] Upload progress: ${done}/${total}`);
  });
  console.log(`\n[Session2] All files uploaded`);

  // Build interleaved parts: [label1][audio1][label2][audio2]...[userPrompt]
  const parts: Array<
    | { text: string }
    | { fileData: { fileUri: string; mimeType: string } }
  > = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const ref = uploadMap.get(track.localPath);
    if (!ref) throw new Error(`Upload missing for: ${track.localPath}`);

    // Text label with metadata
    parts.push({ text: buildTrackLabel(track, i, tracks.length) });
    // Audio file
    parts.push({ fileData: { fileUri: ref.uri, mimeType: ref.mimeType } });
  }

  // Final user prompt with task and target
  const userPrompt = buildSession2UserPrompt(
    task,
    targetMinutes,
    toleranceMinutes,
    tracks.length
  );
  parts.push({ text: userPrompt });

  // Call Gemini with interleaved audio + text parts
  console.log(
    `[Session2] Sending ${tracks.length} audio files (interleaved with labels) to Gemini...`
  );
  console.log(
    `[Session2] Target: ${targetMinutes} ± ${toleranceMinutes} min`
  );
  const rawResponse = await runSession2(SESSION2_SYSTEM_PROMPT, parts);

  // Parse and validate
  console.log(`[Session2] Parsing response (${rawResponse.length} chars)...`);

  // Save raw response for debugging
  const { writeFile: wf, mkdir } = await import("fs/promises");
  const { existsSync } = await import("fs");
  const path = await import("path");
  const outDir = path.resolve("output");
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
  await wf(
    path.join(outDir, "session2_raw_response.txt"),
    rawResponse,
    "utf-8"
  );
  console.log(
    `[Session2] Raw response saved to output/session2_raw_response.txt`
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (e) {
    console.error(`[Session2] Failed to parse JSON response:`);
    console.error(rawResponse.slice(0, 1000));
    throw new Error("Gemini returned invalid JSON for Session 2");
  }

  const validated = Session2ResponseSchema.parse(parsed);

  // Fill in rejectedAt programmatically
  validated.rejected = validated.rejected.map((r) => ({
    ...r,
    rejectedAt: r.rejectedAt || new Date().toISOString(),
  }));

  console.log(`[Session2] Strategy: ${validated.mixingStrategy.slice(0, 100)}...`);
  console.log(`[Session2] Chain: ${validated.chain.length} tracks`);
  console.log(`[Session2] Rejected: ${validated.rejected.length} tracks`);
  console.log(`[Session2] Scores: ${validated.scores.length} tracks`);

  return validated;
}
