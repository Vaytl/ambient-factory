import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { RejectedTrack } from "../types/index.js";

const DATA_DIR = path.resolve("data");
const REJECTED_PATH = path.join(DATA_DIR, "rejected.json");

export async function loadRejected(): Promise<RejectedTrack[]> {
  if (!existsSync(REJECTED_PATH)) return [];
  const raw = await readFile(REJECTED_PATH, "utf-8");
  return JSON.parse(raw);
}

export async function saveRejected(rejected: RejectedTrack[]): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(REJECTED_PATH, JSON.stringify(rejected, null, 2), "utf-8");
}

export async function addRejected(newRejected: RejectedTrack[]): Promise<void> {
  const existing = await loadRejected();
  const existingIds = new Set(existing.map((r) => r.id));
  const toAdd = newRejected.filter((r) => !existingIds.has(r.id));
  await saveRejected([...existing, ...toAdd]);
}

export async function getRejectedIds(): Promise<Set<string>> {
  const rejected = await loadRejected();
  return new Set(rejected.map((r) => r.id));
}
