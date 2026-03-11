# Ambient Factory

Automated ambient mix builder powered by Gemini API. Analyzes a database of 7000+ ambient tracks, selects the best candidates via AI metadata analysis, performs audio quality audit, builds an optimal playback chain with crossfades, and generates a ready-to-run FFmpeg command.

## Architecture

Two-session pipeline using Gemini 3.1 Flash Lite (free tier, 1M token context):

```
SESSION 1: Metadata Selection (text-only, ~130K tokens)
┌─────────────────────────────────────────────────┐
│ Input:  7000 track records in TOON format       │
│         + task description ("deep sleep, 2h")   │
│                                                 │
│ Gemini analyzes metadata:                       │
│  - Circle of Fifths key compatibility           │
│  - Energy profile (centroid, mood, danceability) │
│  - BPM compatibility                            │
│  - Excludes previously rejected tracks          │
│                                                 │
│ Output: ~100 selected track IDs (JSON)          │
└─────────────────────────────────────────────────┘
                      │
                      ▼
SESSION 2: Audio Audit + Chain Building (multimodal, ~700K tokens)
┌─────────────────────────────────────────────────┐
│ Input:  ~100 audio files (via File API)         │
│         + track metadata + Audio Engine Rules   │
│                                                 │
│ Gemini listens to ALL tracks and:               │
│  1. Scores each track 1-100                     │
│  2. Rejects defective tracks (forever)          │
│  3. Builds optimal chain of ~40 tracks          │
│  4. Calculates crossfade durations              │
│  5. Generates FFmpeg command                    │
│                                                 │
│ Output: chain + scores + rejected + FFmpeg      │
└─────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- Gemini API key ([get one free](https://aistudio.google.com/apikey))
- A JSON database of tracks with analysis metadata

## Installation

```bash
git clone https://github.com/YOUR_USER/ambient-factory.git
cd ambient-factory
npm install
```

## Configuration

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_api_key_here
```

## Usage

### Full pipeline

```bash
npx tsx src/index.ts build \
  -d "path/to/database_7000.json" \
  -t "deep sleep mix at 417 Hz" \
  --hours 2
```

### Skip Session 1 (reuse previous selection)

```bash
npx tsx src/index.ts build \
  -d "path/to/database_7000.json" \
  -t "deep sleep mix at 417 Hz" \
  --hours 2 \
  --skip-session1 \
  --selection output/last_session1_result.json
```

### CLI Options

| Option | Required | Description |
|--------|----------|-------------|
| `-d, --database <path>` | Yes | Path to tracks database JSON file |
| `-t, --task <description>` | Yes | Task description (e.g. "deep sleep mix at 417 Hz") |
| `--hours <number>` | No | Target mix duration in hours (default: 2) |
| `--skip-session1` | No | Skip metadata selection, use saved result |
| `--selection <path>` | No | Path to Session 1 output JSON |

### Example tasks

```bash
# Deep sleep
-t "deep sleep mix at 417 Hz frequency, dark and static"

# Focus / Study
-t "focus study mix, steady rhythm, balanced brightness"

# Meditation
-t "meditation mix, gentle and flowing, relaxed mood"
```

## Track Database Format

The input JSON file should be an array of track objects:

```json
[
  {
    "id": "unique-track-id",
    "name": "417 Hz - C Major #001",
    "localPath": "F:\\path\\to\\track.mp3",
    "analysis": {
      "durationSeconds": 273.6,
      "loudnessDb": -22.86,
      "spectralCentroid": 38.49,
      "keyDetected": "G",
      "scaleDetected": "major",
      "bpmDetected": 89.88,
      "mlMoodRelaxed": 0.98,
      "mlDanceability": 0.36,
      "perceptualSharpness": 0.67
    }
  }
]
```

### Required fields in `analysis`

| Field | Type | Description |
|-------|------|-------------|
| `durationSeconds` | number | Track length in seconds |
| `loudnessDb` | number | Loudness in dB (LUFS) |
| `spectralCentroid` | number | Brightness (10-30 = deep sleep, 50+ = active focus) |
| `keyDetected` | string | Musical key (C, D, E, F, G, A, B with sharps/flats) |
| `scaleDetected` | string | "major" or "minor" |
| `bpmDetected` | number | Tempo in BPM (>110 is halved automatically) |
| `mlMoodRelaxed` | number | Relaxation score 0-1 (0.95+ for sleep) |
| `mlDanceability` | number | Rhythmic stability 0-1 (0.7+ = pulse, <0.4 = amorphous) |

### Optional fields

`dynamicRangeDb`, `spectralCentroidStd`, `spectralFlatness`, `perceptualSharpness`, `rms`, `rmsStd`, `zcr`, `keyConfidence`, `danceability`, `dynamicComplexity`, `mlMoodAggressive`, `mlInstrumental`, `mlGenres`

## Output

Each run creates timestamped files in `output/`:

```
output/
  2026-03-11T14-30-00_deep_sleep_chain.json      # Ordered track chain
  2026-03-11T14-30-00_deep_sleep_scores.json      # Quality scores (1-100)
  2026-03-11T14-30-00_deep_sleep_rejected.json    # Rejected tracks with reasons
  2026-03-11T14-30-00_deep_sleep_ffmpeg.sh        # Ready-to-run FFmpeg command
  2026-03-11T14-30-00_deep_sleep_summary.json     # Quick stats
  last_session1_result.json                        # Reusable for --skip-session1
```

### Chain entry format

```json
{
  "position": 1,
  "trackId": "abc123",
  "trackName": "417 Hz - C Major #001",
  "crossfadeDuration": 25.0,
  "volumeAdjustDb": 8.86,
  "keyDetected": "G",
  "bpmDetected": 89.88,
  "spectralCentroid": 38.49
}
```

## Persistent Storage

Stored in `data/` and persists between runs:

- **`data/rejected.json`** — Tracks marked as defective are excluded from ALL future selections permanently
- **`data/scores.json`** — Cumulative quality scores, updated on each run

## Token Efficiency

Track metadata is encoded in [TOON format](https://github.com/toon-format/toon) (Token-Oriented Object Notation) for minimal token usage:

| Format | Tokens for 7000 tracks |
|--------|----------------------|
| Full JSON | ~1,000,000 (won't fit) |
| JSON short keys | ~300,000 |
| **TOON** | **~130,000** |

TOON encodes uniform arrays as tabular data with headers declared once, achieving ~7x compression vs full JSON.

## Audio Engine Rules

### Crossfade durations
- **Deep Sleep**: 20-30s (ghostly, long fades)
- **Focus/Study**: 5-12s (tight, rhythmic transitions)
- **Meditation**: 12-20s

### Volume normalization
All tracks normalized to -14 LUFS target.

### Key transitions
Only adjacent keys on the Circle of Fifths: C-G-D-A-E-B-F#-C#-Ab-Eb-Bb-F-C

### Energy curve
Intro (moderate centroid) → Deep phase (low centroid, minimal danceability) → Gentle ending

## Project Structure

```
ambient-factory/
  src/
    types/
      track.ts          # Zod schemas for track metadata
      session1.ts       # Session 1 response schema
      session2.ts       # Session 2 response schema (chain, scores, rejected)
      index.ts          # Barrel export
    services/
      gemini.ts         # Gemini API wrapper + File API upload
      database.ts       # JSON loader + TOON encoder
      output.ts         # Result file writer
    storage/
      rejected.ts       # Persistent rejected track database
      scores.ts         # Persistent quality scores
    sessions/
      session1.ts       # Metadata selection runner
      session2.ts       # Audio audit + chain building runner
    prompts/
      session1.ts       # System prompt for metadata selection
      session2.ts       # System prompt for audio audit
    index.ts            # CLI entry point (Commander.js)
  data/
    rejected.json       # Cumulative rejected tracks
    scores.json         # Cumulative scores
  output/               # Generated per run
  .env                  # API key (not committed)
  .env.example          # Template
```

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **AI**: Gemini 3.1 Flash Lite Preview (free tier, 1M context)
- **SDK**: @google/genai
- **Encoding**: @toon-format/toon (token-optimized data format for LLMs)
- **Validation**: Zod (schema validation for API responses)
- **CLI**: Commander.js

## License

MIT
