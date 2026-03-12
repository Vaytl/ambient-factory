import { prepareForSession1 } from "../services/database.js";
import { runSession1 } from "../services/gemini.js";
import {
  SESSION1_SYSTEM_PROMPT,
  buildSession1UserPrompt,
} from "../prompts/session1.js";
import {
  Session1ResponseSchema,
  type Session1Response,
} from "../types/index.js";
import type { Track } from "../types/index.js";

export interface Session1Options {
  tracks: Track[];
  task: string;
  targetMinutes: number;
}

/** Selection multiplier: select 2.5x target duration in candidates */
const SELECTION_MULTIPLIER = 2.5;

export async function executeSession1(
  opts: Session1Options
): Promise<Session1Response> {
  const { tracks, task, targetMinutes } = opts;

  const candidateMinutes = Math.round(targetMinutes * SELECTION_MULTIPLIER);

  // Convert to TOON format (tabular, token-efficient)
  console.log(`[Session1] Preparing ${tracks.length} tracks...`);
  const { toonString, trackCount } = await prepareForSession1(tracks);
  console.log(`[Session1] ${trackCount} tracks after excluding rejected`);
  console.log(`[Session1] Target: ${targetMinutes} min, selecting candidates for ~${candidateMinutes} min (${SELECTION_MULTIPLIER}x)`);

  const tokenEstimate = Math.ceil(toonString.length / 4);
  console.log(
    `[Session1] TOON payload: ${(toonString.length / 1024).toFixed(0)} KB (~${tokenEstimate} tokens)`
  );

  if (tokenEstimate > 900_000) {
    throw new Error(
      `Token estimate ${tokenEstimate} exceeds safe limit (900K). ` +
        `Database has too many tracks for a single request.`
    );
  }

  // Call Gemini API
  console.log(`[Session1] Sending to Gemini...`);
  const userPrompt = buildSession1UserPrompt(
    toonString,
    task,
    targetMinutes,
    candidateMinutes
  );
  const rawResponse = await runSession1(SESSION1_SYSTEM_PROMPT, userPrompt);

  // Parse and validate JSON response
  console.log(`[Session1] Parsing response (${rawResponse.length} chars)...`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    console.error(`[Session1] Failed to parse JSON response:`);
    console.error(rawResponse.slice(0, 500));
    throw new Error("Gemini returned invalid JSON for Session 1");
  }

  const validated = Session1ResponseSchema.parse(parsed);

  // Post-validation: check total duration of selected tracks
  const selectedSet = new Set(validated.selectedTrackIds);
  const selectedTracks = tracks.filter((t) => selectedSet.has(t.id));
  const totalDurationMin = selectedTracks.reduce(
    (sum, t) => sum + t.analysis.durationSeconds / 60,
    0
  );

  console.log(`[Session1] Selected ${validated.selectedTrackIds.length} tracks`);
  console.log(`[Session1] Total duration of selected: ${totalDurationMin.toFixed(1)} min (target: ~${candidateMinutes} min)`);
  console.log(`[Session1] Reasoning: ${validated.reasoning.slice(0, 200)}...`);

  if (totalDurationMin < targetMinutes * 1.5) {
    console.warn(
      `[Session1] WARNING: Selected tracks total ${totalDurationMin.toFixed(1)} min, ` +
        `which is less than 1.5x target (${targetMinutes * 1.5} min). May not have enough material.`
    );
  }

  return validated;
}
