import express from "express";
import { jobsRouter } from "./routes/jobs.js";
import { storageRouter } from "./routes/storage.js";

export function createServer() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: "50mb" }));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      model: "gemini-3.1-flash-lite-preview",
      uptime: process.uptime(),
    });
  });

  // Routes
  app.use("/api", jobsRouter);
  app.use("/api", storageRouter);

  return app;
}
