import "dotenv/config";
import { Command } from "commander";
import { readFile } from "fs/promises";
import { initGemini, getModelNames } from "./services/gemini.js";
import { loadRateUsage } from "./services/rateLimiter.js";
import { loadDatabase } from "./services/database.js";
import { executeSession1 } from "./sessions/session1.js";
import { executeSession2 } from "./sessions/session2.js";
import { addRejected } from "./storage/rejected.js";
import { mergeScores } from "./storage/scores.js";
import { writeResults } from "./services/output.js";
import { createServer } from "./server.js";

const program = new Command();

program
  .name("ambient-factory")
  .description("Automated ambient mix builder powered by Gemini API")
  .version("1.0.0");

program
  .command("build")
  .description("Run full pipeline: select tracks -> audio audit -> build chain")
  .requiredOption("-d, --database <path>", "Path to tracks database JSON file")
  .requiredOption(
    "-t, --task <description>",
    'Task description, e.g. "deep sleep mix at 417 Hz"'
  )
  .option("-m, --minutes <number>", "Target mix duration in minutes", "120")
  .option("--skip-session1", "Skip Session 1, use previously saved selection")
  .option(
    "--selection <path>",
    "Path to Session 1 output JSON (used with --skip-session1)"
  )
  .action(async (opts) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error(
        "Error: GEMINI_API_KEY not set. Create .env file or set environment variable."
      );
      process.exit(1);
    }

    initGemini(apiKey);
    await loadRateUsage();

    const targetMinutes = parseInt(opts.minutes, 10);
    const models = getModelNames();
    console.log(`\n=== AMBIENT FACTORY ===`);
    console.log(`Task: ${opts.task}`);
    console.log(`Duration: ${targetMinutes} min (±10 min tolerance)`);
    console.log(`Models: text=${models.text}, audio=${models.audio}`);
    console.log();

    // Load database
    console.log(`--- Phase: Load Database ---`);
    const allTracks = await loadDatabase(opts.database);

    // Session 1: Metadata selection
    let selectedIds: string[];

    if (opts.skipSession1 && opts.selection) {
      const raw = await readFile(opts.selection, "utf-8");
      const data = JSON.parse(raw);
      selectedIds = data.selectedTrackIds ?? data;
      console.log(
        `[Skip] Loaded ${selectedIds.length} pre-selected track IDs from ${opts.selection}`
      );
    } else {
      console.log(`\n--- Session 1: Metadata Selection ---`);
      const session1Result = await executeSession1({
        tracks: allTracks,
        task: opts.task,
        targetMinutes,
      });
      selectedIds = session1Result.selectedTrackIds;

      // Save Session 1 result for potential reuse
      const { writeFile: wf } = await import("fs/promises");
      const { existsSync } = await import("fs");
      const { mkdir } = await import("fs/promises");
      const path = await import("path");
      const outDir = path.resolve("output");
      if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
      const s1Path = path.join(outDir, "last_session1_result.json");
      await wf(s1Path, JSON.stringify(session1Result, null, 2), "utf-8");
      console.log(`[Session1] Result saved to ${s1Path}`);
    }

    // Resolve selected tracks from database
    const idSet = new Set(selectedIds);
    const selectedTracks = allTracks.filter((t) => idSet.has(t.id));
    console.log(`\nResolved ${selectedTracks.length} tracks for audio audit`);

    if (selectedTracks.length === 0) {
      console.error(
        "Error: No tracks resolved. Check that IDs from Session 1 match database."
      );
      process.exit(1);
    }

    // Session 2: Audio audit + chain building
    console.log(`\n--- Session 2: Audio Audit + Chain Building ---`);
    const session2Result = await executeSession2({
      tracks: selectedTracks,
      task: opts.task,
      targetMinutes,
    });

    // Persist rejected tracks (forever)
    if (session2Result.rejected.length > 0) {
      const withDate = session2Result.rejected.map((r) => ({
        ...r,
        rejectedAt: r.rejectedAt || new Date().toISOString(),
      }));
      await addRejected(withDate);
      console.log(
        `\n[Storage] Added ${withDate.length} tracks to rejected database`
      );
    }

    // Persist scores
    await mergeScores(session2Result.scores);
    console.log(`[Storage] Updated scores for ${session2Result.scores.length} tracks`);

    // Write output files
    console.log(`\n--- Output ---`);
    await writeResults(session2Result, opts.task);

    console.log(`\n=== DONE ===`);
    console.log(`Chain: ${session2Result.chain.length} tracks`);
    console.log(`Rejected: ${session2Result.rejected.length} tracks`);
    console.log(`Average score: ${(session2Result.scores.reduce((s, x) => s + x.score, 0) / session2Result.scores.length).toFixed(1)}`);
    console.log(`Check output/ directory for results.`);
  });

program
  .command("serve")
  .description("Start HTTP API server")
  .option("-p, --port <number>", "Port to listen on", "3003")
  .action(async (opts) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error(
        "Error: GEMINI_API_KEY not set. Create .env file or set environment variable."
      );
      process.exit(1);
    }

    initGemini(apiKey);
    await loadRateUsage();

    const port = parseInt(opts.port, 10);
    const models = getModelNames();
    const app = createServer();

    app.listen(port, () => {
      console.log(`\n=== AMBIENT FACTORY API ===`);
      console.log(`Server running on http://localhost:${port}`);
      console.log(`Models: text=${models.text}, audio=${models.audio}`);
      console.log(`\nEndpoints:`);
      console.log(`  POST /api/session1      — Run metadata selection`);
      console.log(`  POST /api/session2      — Run audio audit + chain build`);
      console.log(`  POST /api/session3      — QA audit of final mix`);
      console.log(`  POST /api/build         — Run full pipeline`);
      console.log(`  GET  /api/jobs          — List all jobs`);
      console.log(`  GET  /api/jobs/:id      — Job status & result`);
      console.log(`  GET  /api/rejected      — Rejected tracks list`);
      console.log(`  DELETE /api/rejected/:id — Remove from rejected`);
      console.log(`  GET  /api/scores        — Cumulative track scores`);
      console.log(`  GET  /api/rate-limits   — API rate limit stats`);
      console.log(`  GET  /api/health        — Health check`);
      console.log();
    });
  });

program.parse();
