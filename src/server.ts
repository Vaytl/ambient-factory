import express from "express";
import { jobsRouter } from "./routes/jobs.js";
import { storageRouter } from "./routes/storage.js";
import { getModelNames } from "./services/gemini.js";
import { getStats as getRateLimitStats } from "./services/rateLimiter.js";

export function createServer() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: "50mb" }));

  // Health check
  app.get("/api/health", (_req, res) => {
    const models = getModelNames();
    const rateStats = getRateLimitStats();
    res.json({
      ok: true,
      models,
      uptime: process.uptime(),
      rateLimits: {
        minuteRequestsUsed: rateStats.minute.requests,
        minuteRequestsRemaining: rateStats.minute.remainingRequests,
        dailyRequestsUsed: rateStats.daily.requests,
        dailyRequestsRemaining: rateStats.daily.remainingRequests,
      },
    });
  });

  // Routes
  app.use("/api", jobsRouter);
  app.use("/api", storageRouter);

  return app;
}
