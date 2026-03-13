import { GoogleGenAI } from "@google/genai";
import { waitIfNeeded, trackRequest } from "./rateLimiter.js";

let ai: GoogleGenAI;

/** Text-only model for Session 1 (metadata selection) */
const MODEL_TEXT = "gemini-3.1-flash-lite-preview";

/** Multimodal model for Session 2 & 3 (audio analysis via File API) */
const MODEL_AUDIO = "gemini-2.5-flash";

export function initGemini(apiKey: string): void {
  ai = new GoogleGenAI({ apiKey });
}

export function getModelNames() {
  return { text: MODEL_TEXT, audio: MODEL_AUDIO };
}

/**
 * Session 1: Send TOON metadata, get selected track IDs.
 * Text-only request — uses lightweight model.
 */
export async function runSession1(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const estimatedTokens = Math.ceil(userPrompt.length / 4);
  await waitIfNeeded("generate", estimatedTokens);

  const response = await ai.models.generateContent({
    model: MODEL_TEXT,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const tokensUsed = response.usageMetadata?.totalTokenCount ?? estimatedTokens;
  await trackRequest("generate", tokensUsed);

  return response.text ?? "";
}

/**
 * Upload a single audio file via File API.
 * Waits until processing is complete.
 */
export async function uploadAudio(
  filePath: string
): Promise<{ uri: string; mimeType: string }> {
  await waitIfNeeded("upload");

  const file = await ai.files.upload({
    file: filePath,
    config: { mimeType: "audio/mpeg" },
  });

  await trackRequest("upload");

  // Poll until file is ready
  let uploaded = file;
  while (uploaded.state === "PROCESSING") {
    await new Promise((r) => setTimeout(r, 2000));
    uploaded = await ai.files.get({ name: uploaded.name! });
  }

  if (uploaded.state === "FAILED") {
    throw new Error(`File upload failed: ${filePath}`);
  }

  return { uri: uploaded.uri!, mimeType: uploaded.mimeType! };
}

/**
 * Batch upload audio files with concurrency limit and progress callback.
 * Returns a map of localPath -> { uri, mimeType }.
 */
export async function batchUploadAudio(
  filePaths: string[],
  concurrency: number = 5,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, { uri: string; mimeType: string }>> {
  const results = new Map<string, { uri: string; mimeType: string }>();
  let done = 0;

  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    const uploads = batch.map(async (fp) => {
      const ref = await uploadAudio(fp);
      results.set(fp, ref);
      done++;
      onProgress?.(done, filePaths.length);
    });
    await Promise.all(uploads);
  }

  return results;
}

/**
 * Session 2: Send interleaved audio+label parts, get audit + chain + FFmpeg.
 * Parts are pre-built by session2.ts: [label1][audio1][label2][audio2]...[userPrompt]
 */
export async function runSession2(
  systemPrompt: string,
  parts: Array<
    | { text: string }
    | { fileData: { fileUri: string; mimeType: string } }
  >
): Promise<string> {
  await waitIfNeeded("generate");

  const response = await ai.models.generateContent({
    model: MODEL_AUDIO,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  const tokensUsed = response.usageMetadata?.totalTokenCount ?? 0;
  await trackRequest("generate", tokensUsed);

  return response.text ?? "";
}

/**
 * Session 3: Send complete mix audio + chain metadata for QA audit.
 * Uses native audio model for accurate listening.
 */
export async function runSession3(
  systemPrompt: string,
  mixFileRef: { uri: string; mimeType: string },
  userPrompt: string
): Promise<string> {
  const parts: Array<
    | { text: string }
    | { fileData: { fileUri: string; mimeType: string } }
  > = [];

  // Attach the complete mix audio
  parts.push({
    fileData: { fileUri: mixFileRef.uri, mimeType: mixFileRef.mimeType },
  });

  // Then the text prompt with chain metadata
  parts.push({ text: userPrompt });

  await waitIfNeeded("generate");

  const response = await ai.models.generateContent({
    model: MODEL_AUDIO,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const tokensUsed = response.usageMetadata?.totalTokenCount ?? 0;
  await trackRequest("generate", tokensUsed);

  return response.text ?? "";
}
