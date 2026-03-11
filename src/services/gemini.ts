import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI;

const MODEL = "gemini-3.1-flash-lite";

export function initGemini(apiKey: string): void {
  ai = new GoogleGenAI({ apiKey });
}

/**
 * Session 1: Send JSON metadata, get selected track IDs.
 * Text-only request, ~300K tokens input.
 */
export async function runSession1(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  return response.text ?? "";
}

/**
 * Upload a single audio file via File API.
 * Waits until processing is complete.
 */
export async function uploadAudio(
  filePath: string
): Promise<{ uri: string; mimeType: string }> {
  const file = await ai.files.upload({
    file: filePath,
    config: { mimeType: "audio/mpeg" },
  });

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
 * Session 2: Send audio files + metadata, get audit + chain + FFmpeg.
 * Multimodal request with ~100 audio files.
 */
export async function runSession2(
  systemPrompt: string,
  audioRefs: { uri: string; mimeType: string }[],
  userPrompt: string
): Promise<string> {
  const parts: Array<
    | { text: string }
    | { fileData: { fileUri: string; mimeType: string } }
  > = [];

  // Attach all audio files first
  for (const ref of audioRefs) {
    parts.push({
      fileData: { fileUri: ref.uri, mimeType: ref.mimeType },
    });
  }

  // Then the text prompt with metadata
  parts.push({ text: userPrompt });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  return response.text ?? "";
}
