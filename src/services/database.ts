import { readFile } from "fs/promises";
import { encode } from "@toon-format/toon";
import { TrackSchema, type Track, type TrackMetaTrimmed } from "../types/index.js";
import { getRejectedIds } from "../storage/rejected.js";

/**
 * Load full track database from JSON file.
 * Validates each track against schema, skips invalid entries.
 */
export async function loadDatabase(dbPath: string): Promise<Track[]> {
  const raw = await readFile(dbPath, "utf-8");
  const data: unknown[] = JSON.parse(raw);

  const tracks: Track[] = [];
  let errorCount = 0;

  for (let i = 0; i < data.length; i++) {
    const result = TrackSchema.safeParse(data[i]);
    if (result.success) {
      tracks.push(result.data);
    } else {
      errorCount++;
    }
  }

  if (errorCount > 0) {
    console.warn(`[DB] Skipped ${errorCount} invalid tracks out of ${data.length}`);
  }

  console.log(`[DB] Loaded ${tracks.length} valid tracks`);
  return tracks;
}

/**
 * Convert tracks to TOON format for Session 1.
 * TOON (Token-Oriented Object Notation) minimizes token usage
 * by encoding uniform arrays as tabular data with headers declared once.
 *
 * Output example:
 *   tracks[3]{id,name,key,scale,bpm,centroid,mood,dance,dur,loud,sharp}:
 *     abc,417 Hz - C Major #001,G,major,89.88,38.49,0.98,0.36,273.6,-22.86,0.67
 *     def,528 Hz - F Major #002,F,major,72.5,25.1,0.95,0.22,310.5,-19.4,0.45
 *
 * ~70 chars/track vs ~500 chars/track in full JSON = ~7x token savings.
 */
export async function prepareForSession1(tracks: Track[]): Promise<{
  toonString: string;
  trackCount: number;
}> {
  const rejectedIds = await getRejectedIds();

  const filtered = tracks.filter((t) => !rejectedIds.has(t.id));
  console.log(`[DB] ${filtered.length} tracks after excluding ${rejectedIds.size} rejected`);

  // Trim to essential fields for metadata selection
  const trimmed: TrackMetaTrimmed[] = filtered.map((t) => ({
    id: t.id,
    name: t.name,
    key: t.analysis.keyDetected,
    scale: t.analysis.scaleDetected,
    bpm: t.analysis.bpmDetected,
    centroid: t.analysis.spectralCentroid,
    mood: t.analysis.mlMoodRelaxed,
    dance: t.analysis.mlDanceability,
    dur: t.analysis.durationSeconds,
    loud: t.analysis.loudnessDb,
    sharp: t.analysis.perceptualSharpness ?? 0,
  }));

  // Encode as TOON — uniform array of objects becomes tabular automatically
  const toonString = encode({ tracks: trimmed });

  return { toonString, trackCount: trimmed.length };
}
