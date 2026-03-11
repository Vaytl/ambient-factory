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
  targetDurationHours: number;
}

export async function executeSession1(
  opts: Session1Options
): Promise<Session1Response> {
  const { tracks, task, targetDurationHours } = opts;

  // Convert to TOON format (tabular, token-efficient)
  console.log(`[Session1] Preparing ${tracks.length} tracks...`);
  const { toonString, trackCount } = await prepareForSession1(tracks);
  console.log(`[Session1] ${trackCount} tracks after excluding rejected`);

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
    targetDurationHours
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

  console.log(`[Session1] Selected ${validated.selectedTrackIds.length} tracks`);
  console.log(`[Session1] Reasoning: ${validated.reasoning.slice(0, 200)}...`);

  return validated;
}
