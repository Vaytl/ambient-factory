import { Router, type Request, type Response } from "express";
import {
  loadRejected,
  saveRejected,
} from "../storage/rejected.js";
import { loadScores } from "../storage/scores.js";
import { getStats as getRateLimitStats } from "../services/rateLimiter.js";

export const storageRouter = Router();

// ─── GET /api/rejected ──────────────────────────────────────────────
storageRouter.get("/rejected", async (_req: Request, res: Response) => {
  try {
    const rejected = await loadRejected();
    res.json(rejected);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/rejected/:id ───────────────────────────────────────
storageRouter.delete("/rejected/:id", async (req: Request, res: Response) => {
  try {
    const rejected = await loadRejected();
    const before = rejected.length;
    const filtered = rejected.filter((r) => r.id !== req.params.id);

    if (filtered.length === before) {
      res.status(404).json({ error: "Track not found in rejected list" });
      return;
    }

    await saveRejected(filtered);
    res.json({ message: `Track ${req.params.id} removed from rejected list`, count: filtered.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scores ────────────────────────────────────────────────
storageRouter.get("/scores", async (_req: Request, res: Response) => {
  try {
    const scores = await loadScores();
    res.json(scores);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/rate-limits ───────────────────────────────────────────
storageRouter.get("/rate-limits", (_req: Request, res: Response) => {
  res.json(getRateLimitStats());
});
