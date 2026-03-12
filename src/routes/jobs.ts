import { Router, type Request, type Response } from "express";
import { createJob, getJob, getAllJobs, updateJob } from "../services/jobQueue.js";
import { loadDatabase } from "../services/database.js";
import { executeSession1 } from "../sessions/session1.js";
import { executeSession2 } from "../sessions/session2.js";
import { executeSession3 } from "../sessions/session3.js";
import { addRejected } from "../storage/rejected.js";
import { mergeScores } from "../storage/scores.js";
import { writeResults, writeSession3Report } from "../services/output.js";

export const jobsRouter = Router();

// ─── POST /api/session1 ──────────────────────────────────────────────
jobsRouter.post("/session1", (req: Request, res: Response) => {
  const { task, minutes = 120, databasePath } = req.body;

  if (!task || !databasePath) {
    res.status(400).json({ error: "Missing required fields: task, databasePath" });
    return;
  }

  const job = createJob("session1");
  res.status(202).json({ jobId: job.id, status: job.status });

  // Run in background
  (async () => {
    try {
      updateJob(job.id, { status: "running", progress: "Loading database..." });

      const tracks = await loadDatabase(databasePath);
      updateJob(job.id, { progress: `Loaded ${tracks.length} tracks. Sending to Gemini...` });

      const result = await executeSession1({
        tracks,
        task,
        targetMinutes: Number(minutes),
      });

      updateJob(job.id, {
        status: "completed",
        progress: `Selected ${result.selectedTrackIds.length} tracks`,
        result,
      });
    } catch (err: any) {
      updateJob(job.id, {
        status: "failed",
        error: err.message ?? String(err),
      });
    }
  })();
});

// ─── POST /api/session2 ──────────────────────────────────────────────
jobsRouter.post("/session2", (req: Request, res: Response) => {
  const { task, minutes = 120, databasePath, trackIds } = req.body;

  if (!task || !databasePath || !trackIds || !Array.isArray(trackIds)) {
    res.status(400).json({
      error: "Missing required fields: task, databasePath, trackIds (array)",
    });
    return;
  }

  const job = createJob("session2");
  res.status(202).json({ jobId: job.id, status: job.status });

  (async () => {
    try {
      updateJob(job.id, { status: "running", progress: "Loading database..." });

      const allTracks = await loadDatabase(databasePath);
      const idSet = new Set(trackIds as string[]);
      const selectedTracks = allTracks.filter((t) => idSet.has(t.id));

      if (selectedTracks.length === 0) {
        throw new Error("No tracks matched the provided trackIds");
      }

      updateJob(job.id, {
        progress: `Resolved ${selectedTracks.length} tracks. Uploading audio...`,
      });

      const result = await executeSession2({
        tracks: selectedTracks,
        task,
        targetMinutes: Number(minutes),
      });

      // Persist rejected + scores
      if (result.rejected.length > 0) {
        const withDate = result.rejected.map((r) => ({
          ...r,
          rejectedAt: r.rejectedAt || new Date().toISOString(),
        }));
        await addRejected(withDate);
      }
      await mergeScores(result.scores);
      await writeResults(result, task);

      updateJob(job.id, {
        status: "completed",
        progress: `Chain: ${result.chain.length} tracks, Rejected: ${result.rejected.length}`,
        result,
      });
    } catch (err: any) {
      updateJob(job.id, {
        status: "failed",
        error: err.message ?? String(err),
      });
    }
  })();
});

// ─── POST /api/build (full pipeline) ─────────────────────────────────
jobsRouter.post("/build", (req: Request, res: Response) => {
  const { task, minutes = 120, databasePath } = req.body;

  if (!task || !databasePath) {
    res.status(400).json({ error: "Missing required fields: task, databasePath" });
    return;
  }

  const job = createJob("build");
  res.status(202).json({ jobId: job.id, status: job.status });

  (async () => {
    try {
      updateJob(job.id, { status: "running", progress: "Loading database..." });

      const targetMinutes = Number(minutes);
      const allTracks = await loadDatabase(databasePath);
      updateJob(job.id, { progress: `Loaded ${allTracks.length} tracks. Running Session 1...` });

      // Session 1
      const s1 = await executeSession1({
        tracks: allTracks,
        task,
        targetMinutes,
      });

      updateJob(job.id, {
        progress: `Session 1 done: ${s1.selectedTrackIds.length} selected. Uploading audio for Session 2...`,
      });

      // Resolve tracks
      const idSet = new Set(s1.selectedTrackIds);
      const selectedTracks = allTracks.filter((t) => idSet.has(t.id));

      if (selectedTracks.length === 0) {
        throw new Error("Session 1 returned IDs that don't match database");
      }

      // Session 2
      const s2 = await executeSession2({
        tracks: selectedTracks,
        task,
        targetMinutes,
      });

      // Persist
      if (s2.rejected.length > 0) {
        const withDate = s2.rejected.map((r) => ({
          ...r,
          rejectedAt: r.rejectedAt || new Date().toISOString(),
        }));
        await addRejected(withDate);
      }
      await mergeScores(s2.scores);
      await writeResults(s2, task);

      updateJob(job.id, {
        status: "completed",
        progress: `Done! Chain: ${s2.chain.length}, Rejected: ${s2.rejected.length}`,
        result: {
          session1: s1,
          session2: s2,
        },
      });
    } catch (err: any) {
      updateJob(job.id, {
        status: "failed",
        error: err.message ?? String(err),
      });
    }
  })();
});

// ─── POST /api/session3 ──────────────────────────────────────────────
jobsRouter.post("/session3", (req: Request, res: Response) => {
  const { task, mixPath, chain } = req.body;

  if (!task || !mixPath || !chain || !Array.isArray(chain)) {
    res.status(400).json({
      error: "Missing required fields: task, mixPath, chain (array of ChainEntry)",
    });
    return;
  }

  const job = createJob("session3");
  res.status(202).json({ jobId: job.id, status: job.status });

  (async () => {
    try {
      updateJob(job.id, { status: "running", progress: "Uploading mix to Gemini..." });

      const result = await executeSession3({
        mixPath,
        chain,
        task,
      });

      // Save QA report
      await writeSession3Report(result, task);

      updateJob(job.id, {
        status: "completed",
        progress: `QA done: ${result.overallScore}/100 (${result.overallVerdict}), ${result.issues.length} issues`,
        result,
      });
    } catch (err: any) {
      updateJob(job.id, {
        status: "failed",
        error: err.message ?? String(err),
      });
    }
  })();
});

// ─── GET /api/jobs ───────────────────────────────────────────────────
jobsRouter.get("/jobs", (_req: Request, res: Response) => {
  const jobs = getAllJobs().map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status,
    progress: j.progress,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
    hasResult: !!j.result,
    error: j.error,
  }));
  res.json(jobs);
});

// ─── GET /api/jobs/:id ──────────────────────────────────────────────
jobsRouter.get("/jobs/:id", (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const job = getJob(id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});
