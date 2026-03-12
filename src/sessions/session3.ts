import { uploadAudio, runSession3 } from "../services/gemini.js";
import { SESSION3_SYSTEM_PROMPT, buildSession3UserPrompt } from "../prompts/session3.js";
import { Session3ResponseSchema, type Session3Response } from "../types/index.js";
import type { ChainEntry } from "../types/index.js";

export interface Session3Input {
  mixPath: string;
  chain: ChainEntry[];
  task: string;
}

/**
 * Execute Session 3: QA audit of the complete mixed audio file.
 *
 * 1. Upload the final MP3 mix via File API
 * 2. Send mix audio + chain metadata to Gemini
 * 3. Parse and validate the QA report
 */
export async function executeSession3(input: Session3Input): Promise<Session3Response> {
  const { mixPath, chain, task } = input;

  // Step 1: Upload the mix file
  console.log(`[Session3] Uploading mix: ${mixPath}`);
  const mixRef = await uploadAudio(mixPath);
  console.log(`[Session3] Mix uploaded: ${mixRef.uri}`);

  // Step 2: Build prompts
  const chainJson = JSON.stringify(chain, null, 2);
  const userPrompt = buildSession3UserPrompt(chainJson, task);

  console.log(`[Session3] Sending mix + chain (${chain.length} tracks) to Gemini for QA audit...`);

  // Step 3: Call Gemini
  const rawResponse = await runSession3(SESSION3_SYSTEM_PROMPT, mixRef, userPrompt);

  // Step 4: Parse and validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    console.error("[Session3] Failed to parse JSON response");
    console.error("[Session3] Raw response:", rawResponse.slice(0, 500));
    throw new Error("Session 3 returned invalid JSON");
  }

  const result = Session3ResponseSchema.parse(parsed);

  console.log(`[Session3] QA audit complete:`);
  console.log(`  Overall score: ${result.overallScore}/100`);
  console.log(`  Verdict: ${result.overallVerdict}`);
  console.log(`  Transitions audited: ${result.transitions.length}`);
  console.log(`  Issues found: ${result.issues.length}`);

  return result;
}
