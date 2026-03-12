# Ambient Factory

Automated ambient mix builder powered by Gemini API (free tier). Analyzes a database of ambient tracks (any size), selects candidates via AI metadata analysis, performs audio quality auditing by having Gemini listen to audio files, builds an optimal playback chain for a target duration, and generates FFmpeg commands for the final mix. A third session sends the completed mix back to Gemini for QA audit.

## Architecture

Three-session pipeline using two Gemini models:

- **Text model**: `gemini-3.1-flash-lite-preview` — metadata selection via TOON format (Session 1)
- **Audio model**: `gemini-2.5-flash-native-audio-latest` — native audio listening (Sessions 2 & 3)

```
SESSION 1: Metadata Selection (text-only, ~130K tokens)
┌──────────────────────────────────────────────────────────┐
│ Model:  gemini-3.1-flash-lite-preview                    │
│ Input:  All track records in TOON format                 │
│         + task description ("deep sleep, 120 min")       │
│                                                          │
│ Gemini analyzes metadata:                                │
│  - Circle of Fifths key compatibility                    │
│  - Energy profile (centroid, mood, danceability)          │
│  - BPM compatibility                                     │
│  - Excludes previously rejected tracks                   │
│                                                          │
│ Dynamic selection: candidateMinutes = targetMinutes × 2.5│
│ Output: selected track IDs (JSON, min 5, no max)         │
└──────────────────────────────────────────────────────────┘
                      │
                      ▼
SESSION 2: Audio Audit + Chain Building (multimodal, ~700K tokens)
┌──────────────────────────────────────────────────────────┐
│ Model:  gemini-2.5-flash-native-audio-latest             │
│ Input:  Candidate audio files (via File API, up to 3000) │
│         + track metadata + Audio Engine Rules             │
│                                                          │
│ Gemini listens to ALL tracks and:                        │
│  1. Scores each track 1-100                              │
│  2. Rejects defective tracks (forever)                   │
│  3. Builds chain targeting targetMinutes ± 10 min        │
│  4. Calculates crossfade durations                       │
│  5. Generates FFmpeg command (no re-encoding)             │
│                                                          │
│ Output: chain + scores + rejected + FFmpeg               │
└──────────────────────────────────────────────────────────┘
                      │
                      ▼
SESSION 3: QA Audit of Final Mix (multimodal)
┌──────────────────────────────────────────────────────────┐
│ Model:  gemini-2.5-flash-native-audio-latest             │
│ Input:  Completed MP3 mix (via File API)                 │
│         + chain metadata                                 │
│                                                          │
│ Gemini listens to the full mix and audits:               │
│  - Crossfade quality (per-transition scores)             │
│  - Tonal stitches between tracks                         │
│  - Clipping and volume balance                           │
│  - Energy curve and flow                                 │
│  - Scenario fitness                                      │
│                                                          │
│ Output: JSON report with overall score, per-transition   │
│         scores, issues with timecodes, verdict           │
└──────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- Gemini API key ([get one free](https://aistudio.google.com/apikey))
- A JSON database of tracks with analysis metadata

## Installation

```bash
git clone https://github.com/Vaytl/ambient-factory.git
cd ambient-factory
npm install
```

## Configuration

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_api_key_here
```

## Usage

### CLI

#### Full pipeline (Sessions 1 + 2)

```bash
npx tsx src/index.ts build \
  -d "path/to/database.json" \
  -t "deep sleep mix at 417 Hz" \
  --minutes 120
```

#### Skip Session 1 (reuse previous selection)

```bash
npx tsx src/index.ts build \
  -d "path/to/database.json" \
  -t "deep sleep mix at 417 Hz" \
  --minutes 120 \
  --skip-session1 \
  --selection output/last_session1_result.json
```

#### Start HTTP API server

```bash
npx tsx src/index.ts serve --port 3003
```

#### CLI Options

| Option | Required | Description |
|--------|----------|-------------|
| `-d, --database <path>` | Yes | Path to tracks database JSON file |
| `-t, --task <description>` | Yes | Task description (e.g. "deep sleep mix at 417 Hz") |
| `-m, --minutes <number>` | No | Target mix duration in minutes (default: 120) |
| `--skip-session1` | No | Skip metadata selection, use saved result |
| `--selection <path>` | No | Path to Session 1 output JSON |
| `-p, --port <number>` | No | Port for HTTP server (default: 3003) |

#### Example tasks

```bash
# Deep sleep
-t "deep sleep mix at 417 Hz frequency, dark and static"

# Focus / Study
-t "focus study mix, steady rhythm, balanced brightness"

# Meditation
-t "meditation mix, gentle and flowing, relaxed mood"
```

### HTTP API

The server runs on port 3003 (configurable) and uses an async job queue pattern. All POST endpoints return `202 { jobId }` immediately, and you poll `GET /api/jobs/:id` for results.

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/session1` | Run metadata selection (Session 1) |
| `POST` | `/api/session2` | Run audio audit + chain building (Session 2) |
| `POST` | `/api/session3` | QA audit of completed mix (Session 3) |
| `POST` | `/api/build` | Run full pipeline (Sessions 1 + 2) |
| `GET` | `/api/jobs` | List all jobs (summary) |
| `GET` | `/api/jobs/:id` | Get job status, progress, and result |
| `GET` | `/api/rejected` | Get persistent rejected tracks list |
| `DELETE` | `/api/rejected/:id` | Remove track from rejected list |
| `GET` | `/api/scores` | Get cumulative track scores |
| `GET` | `/api/rate-limits` | Current API rate limit usage stats |
| `GET` | `/api/health` | Health check (models, uptime, rate limits) |

#### POST /api/session1

Run metadata selection. Gemini selects candidates from the database.

```bash
curl -X POST http://localhost:3003/api/session1 \
  -H "Content-Type: application/json" \
  -d '{
    "task": "deep sleep mix at 417 Hz",
    "minutes": 120,
    "databasePath": "/path/to/database.json"
  }'
```

Response: `202 { "jobId": "...", "status": "pending" }`

#### POST /api/session2

Run audio audit and chain building. Requires track IDs from Session 1.

```bash
curl -X POST http://localhost:3003/api/session2 \
  -H "Content-Type: application/json" \
  -d '{
    "task": "deep sleep mix at 417 Hz",
    "minutes": 120,
    "databasePath": "/path/to/database.json",
    "trackIds": ["id1", "id2", "id3"]
  }'
```

Response: `202 { "jobId": "...", "status": "pending" }`

#### POST /api/session3

QA audit of a completed mix file. Requires the mix MP3 path and chain metadata.

```bash
curl -X POST http://localhost:3003/api/session3 \
  -H "Content-Type: application/json" \
  -d '{
    "task": "deep sleep mix at 417 Hz",
    "mixPath": "/path/to/completed_mix.mp3",
    "chain": [
      { "position": 1, "trackId": "abc", "trackName": "Track 1", "crossfadeDuration": 25.0 }
    ]
  }'
```

Response: `202 { "jobId": "...", "status": "pending" }`

#### POST /api/build

Run full pipeline (Session 1 + Session 2) in one job.

```bash
curl -X POST http://localhost:3003/api/build \
  -H "Content-Type: application/json" \
  -d '{
    "task": "deep sleep mix at 417 Hz",
    "minutes": 120,
    "databasePath": "/path/to/database.json"
  }'
```

Response: `202 { "jobId": "...", "status": "pending" }`

#### GET /api/jobs/:id

Poll job status and retrieve results when completed.

```bash
curl http://localhost:3003/api/jobs/abc123
```

Response:
```json
{
  "id": "abc123",
  "type": "build",
  "status": "completed",
  "progress": "Done! Chain: 35, Rejected: 3",
  "createdAt": "2026-03-12T10:00:00.000Z",
  "completedAt": "2026-03-12T10:05:00.000Z",
  "result": { "session1": { ... }, "session2": { ... } }
}
```

Job statuses: `pending` → `running` → `completed` | `failed`

#### GET /api/rate-limits

```bash
curl http://localhost:3003/api/rate-limits
```

Response:
```json
{
  "minute": {
    "requests": 3,
    "tokens": 150000,
    "fileUploads": 10,
    "remainingRequests": 12,
    "remainingTokens": 850000,
    "resetsInSeconds": 42
  },
  "daily": {
    "date": "2026-03-12",
    "requests": 25,
    "tokens": 500000,
    "fileUploads": 100,
    "remainingRequests": 1475
  },
  "limits": {
    "rpm": 15,
    "rpd": 1500,
    "tpm": 1000000,
    "fileUploadsPerMin": 30
  }
}
```

#### GET /api/health

```bash
curl http://localhost:3003/api/health
```

Response:
```json
{
  "ok": true,
  "models": {
    "text": "gemini-3.1-flash-lite-preview",
    "audio": "gemini-2.5-flash-native-audio-latest"
  },
  "uptime": 120.5,
  "rateLimits": {
    "minuteRequestsUsed": 0,
    "minuteRequestsRemaining": 15,
    "dailyRequestsUsed": 0,
    "dailyRequestsRemaining": 1500
  }
}
```

## Track Database Format

The input JSON file should be an array of track objects (any number of tracks):

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

### TOON encoding for Session 1

Track metadata is encoded in [TOON format](https://github.com/toon-format/toon) (Token-Oriented Object Notation) with 11 short-named fields:

| TOON field | Source field |
|------------|-------------|
| `id` | `id` |
| `name` | `name` |
| `key` | `keyDetected` |
| `scale` | `scaleDetected` |
| `bpm` | `bpmDetected` |
| `centroid` | `spectralCentroid` |
| `mood` | `mlMoodRelaxed` |
| `dance` | `mlDanceability` |
| `dur` | `durationSeconds` |
| `loud` | `loudnessDb` |
| `sharp` | `perceptualSharpness` |

TOON achieves ~7x compression vs full JSON by encoding uniform arrays as tabular data with headers declared once.

## Output

Each run creates timestamped files in `output/`:

```
output/
  2026-03-12T14-30-00_deep_sleep_chain.json      # Ordered track chain
  2026-03-12T14-30-00_deep_sleep_scores.json      # Quality scores (1-100)
  2026-03-12T14-30-00_deep_sleep_rejected.json    # Rejected tracks with reasons
  2026-03-12T14-30-00_deep_sleep_ffmpeg.sh        # Ready-to-run FFmpeg command
  2026-03-12T14-30-00_deep_sleep_summary.json     # Quick stats
  2026-03-12T14-30-00_deep_sleep_qa_report.json   # Session 3 QA report (JSON)
  2026-03-12T14-30-00_deep_sleep_qa_report.txt    # Session 3 QA report (human-readable)
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

| File | Description |
|------|-------------|
| `data/rejected.json` | Tracks marked as defective — excluded from ALL future selections permanently |
| `data/scores.json` | Cumulative quality scores, updated on each run |
| `data/rate_usage.json` | Daily rate limit counters (RPM, RPD, TPM, file uploads) |

## Rate Limiting

Built-in rate limiter tracks Gemini free tier limits:

| Limit | Value |
|-------|-------|
| Requests per minute (RPM) | 15 |
| Requests per day (RPD) | 1,500 |
| Tokens per minute (TPM) | 1,000,000 |
| File uploads per minute | 30 |

The rate limiter auto-throttles (waits) when approaching limits. Daily counters persist to `data/rate_usage.json` and reset automatically. File upload concurrency is set to 5 (conservative for free tier).

## Audio Engine Rules

### Crossfade durations
- **Deep Sleep**: 20-30s (ghostly, long fades)
- **Focus/Study**: 5-12s (tight, rhythmic transitions)
- **Meditation**: 12-20s

### Volume normalization
All tracks normalized to -14 LUFS target.

### FFmpeg
Preserves original audio quality/bitrate — no re-encoding.

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
      session1.ts       # Session 1 response schema (min 5, no max)
      session2.ts       # Session 2 response schema (chain, scores, rejected, FFmpeg)
      session3.ts       # Session 3 response schema (QA audit, transitions, issues)
      index.ts          # Barrel export
    services/
      gemini.ts         # Dual-model Gemini wrapper (text + audio) + File API upload
      database.ts       # JSON loader + TOON encoder
      output.ts         # Result file writer (Session 2 + Session 3 reports)
      jobQueue.ts       # In-memory async job queue
      rateLimiter.ts    # RPM/RPD/TPM tracking, auto-throttle, persistent counters
    storage/
      rejected.ts       # Persistent rejected track database
      scores.ts         # Persistent quality scores
    sessions/
      session1.ts       # Metadata selection runner (candidateMinutes = target × 2.5)
      session2.ts       # Audio audit + chain building runner (targetMinutes ± 10)
      session3.ts       # QA audit runner (upload mix, send chain metadata)
    prompts/
      session1.ts       # System prompt for metadata selection
      session2.ts       # System prompt for audio audit
      session3.ts       # System prompt for QA audit
    routes/
      jobs.ts           # POST session1/2/3/build, GET jobs
      storage.ts        # GET/DELETE rejected, GET scores, GET rate-limits
    index.ts            # CLI entry point (build + serve commands)
    server.ts           # Express app with health check
  data/
    rejected.json       # Cumulative rejected tracks
    scores.json         # Cumulative scores
    rate_usage.json     # Daily rate limit counters
  output/               # Generated per run (gitignored)
  .env                  # API key (not committed)
  .env.example          # Template
```

## Tech Stack

- **Runtime**: Node.js 18+ / TypeScript (ESM)
- **AI (text)**: Gemini 3.1 Flash Lite Preview (free tier, 1M context)
- **AI (audio)**: Gemini 2.5 Flash Native Audio Latest (native audio listening)
- **SDK**: @google/genai
- **Encoding**: @toon-format/toon (token-optimized tabular format for LLMs)
- **Validation**: Zod (schema validation for API responses)
- **HTTP**: Express.js (async job queue pattern)
- **CLI**: Commander.js

## License

MIT
