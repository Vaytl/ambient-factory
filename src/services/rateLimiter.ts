import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DATA_DIR = path.resolve("data");
const USAGE_FILE = path.join(DATA_DIR, "rate_usage.json");

// Free tier limits (conservative estimates)
const LIMITS = {
  rpm: 15,           // requests per minute (generateContent)
  rpd: 1500,         // requests per day
  tpm: 1_000_000,    // tokens per minute
  fileUploadsPerMin: 30, // file API uploads per minute
};

interface MinuteWindow {
  requests: number;
  tokens: number;
  fileUploads: number;
  resetAt: number; // epoch ms
}

interface DailyUsage {
  date: string;       // YYYY-MM-DD
  requests: number;
  tokens: number;
  fileUploads: number;
}

interface RateStats {
  minute: {
    requests: number;
    tokens: number;
    fileUploads: number;
    remainingRequests: number;
    remainingTokens: number;
    resetsInSeconds: number;
  };
  daily: {
    date: string;
    requests: number;
    tokens: number;
    fileUploads: number;
    remainingRequests: number;
  };
  limits: typeof LIMITS;
}

let minuteWindow: MinuteWindow = {
  requests: 0,
  tokens: 0,
  fileUploads: 0,
  resetAt: Date.now() + 60_000,
};

let dailyUsage: DailyUsage = {
  date: todayString(),
  requests: 0,
  tokens: 0,
  fileUploads: 0,
};

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetMinuteIfNeeded(): void {
  if (Date.now() >= minuteWindow.resetAt) {
    minuteWindow = {
      requests: 0,
      tokens: 0,
      fileUploads: 0,
      resetAt: Date.now() + 60_000,
    };
  }
}

function resetDailyIfNeeded(): void {
  const today = todayString();
  if (dailyUsage.date !== today) {
    dailyUsage = {
      date: today,
      requests: 0,
      tokens: 0,
      fileUploads: 0,
    };
  }
}

/**
 * Load daily usage from persistent storage.
 * Called once at startup.
 */
export async function loadRateUsage(): Promise<void> {
  try {
    if (existsSync(USAGE_FILE)) {
      const raw = await readFile(USAGE_FILE, "utf-8");
      const data = JSON.parse(raw) as DailyUsage;
      if (data.date === todayString()) {
        dailyUsage = data;
        console.log(
          `[RateLimit] Loaded daily usage: ${data.requests} requests, ${data.tokens} tokens`
        );
      } else {
        console.log(`[RateLimit] Previous usage from ${data.date}, starting fresh`);
      }
    }
  } catch {
    // Ignore errors, start with empty counters
  }
}

/**
 * Save daily usage to persistent storage.
 */
async function saveDailyUsage(): Promise<void> {
  try {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    await writeFile(USAGE_FILE, JSON.stringify(dailyUsage, null, 2), "utf-8");
  } catch {
    // Non-critical — don't crash on save failure
  }
}

/**
 * Check if we can make a request without exceeding limits.
 * Returns the number of milliseconds to wait (0 = can proceed immediately).
 */
export function getWaitTime(type: "generate" | "upload", estimatedTokens = 0): number {
  resetMinuteIfNeeded();
  resetDailyIfNeeded();

  // Check daily limit
  if (dailyUsage.requests >= LIMITS.rpd) {
    // Can't proceed today — return time until midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }

  if (type === "generate") {
    // Check RPM
    if (minuteWindow.requests >= LIMITS.rpm) {
      return minuteWindow.resetAt - Date.now();
    }
    // Check TPM
    if (estimatedTokens > 0 && minuteWindow.tokens + estimatedTokens > LIMITS.tpm) {
      return minuteWindow.resetAt - Date.now();
    }
  }

  if (type === "upload") {
    if (minuteWindow.fileUploads >= LIMITS.fileUploadsPerMin) {
      return minuteWindow.resetAt - Date.now();
    }
  }

  return 0;
}

/**
 * Wait if necessary to stay within rate limits.
 * Logs a message when throttled.
 */
export async function waitIfNeeded(
  type: "generate" | "upload",
  estimatedTokens = 0
): Promise<void> {
  const wait = getWaitTime(type, estimatedTokens);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    console.log(`[RateLimit] Throttled — waiting ${seconds}s before next ${type} request`);
    await new Promise((r) => setTimeout(r, wait));
    // After waiting, reset the minute window
    resetMinuteIfNeeded();
  }
}

/**
 * Record a completed request.
 */
export async function trackRequest(
  type: "generate" | "upload",
  tokensUsed = 0
): Promise<void> {
  resetMinuteIfNeeded();
  resetDailyIfNeeded();

  if (type === "generate") {
    minuteWindow.requests++;
    minuteWindow.tokens += tokensUsed;
    dailyUsage.requests++;
    dailyUsage.tokens += tokensUsed;
  }

  if (type === "upload") {
    minuteWindow.fileUploads++;
    dailyUsage.fileUploads++;
  }

  // Persist daily usage (fire and forget)
  saveDailyUsage();
}

/**
 * Get current rate limit statistics.
 */
export function getStats(): RateStats {
  resetMinuteIfNeeded();
  resetDailyIfNeeded();

  return {
    minute: {
      requests: minuteWindow.requests,
      tokens: minuteWindow.tokens,
      fileUploads: minuteWindow.fileUploads,
      remainingRequests: Math.max(0, LIMITS.rpm - minuteWindow.requests),
      remainingTokens: Math.max(0, LIMITS.tpm - minuteWindow.tokens),
      resetsInSeconds: Math.max(0, Math.ceil((minuteWindow.resetAt - Date.now()) / 1000)),
    },
    daily: {
      date: dailyUsage.date,
      requests: dailyUsage.requests,
      tokens: dailyUsage.tokens,
      fileUploads: dailyUsage.fileUploads,
      remainingRequests: Math.max(0, LIMITS.rpd - dailyUsage.requests),
    },
    limits: LIMITS,
  };
}
