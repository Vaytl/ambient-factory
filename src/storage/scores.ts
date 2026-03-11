import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { TrackScore } from "../types/index.js";

const DATA_DIR = path.resolve("data");
const SCORES_PATH = path.join(DATA_DIR, "scores.json");

interface ScoresDb {
  [trackId: string]: TrackScore & { updatedAt: string };
}

export async function loadScores(): Promise<ScoresDb> {
  if (!existsSync(SCORES_PATH)) return {};
  const raw = await readFile(SCORES_PATH, "utf-8");
  return JSON.parse(raw);
}

export async function mergeScores(newScores: TrackScore[]): Promise<void> {
  const existing = await loadScores();
  const now = new Date().toISOString();
  for (const s of newScores) {
    existing[s.id] = { ...s, updatedAt: now };
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SCORES_PATH, JSON.stringify(existing, null, 2), "utf-8");
}
