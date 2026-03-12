import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Session2Response, Session3Response } from "../types/index.js";

const OUTPUT_DIR = path.resolve("output");

export async function writeResults(
  result: Session2Response,
  taskName: string
): Promise<void> {
  if (!existsSync(OUTPUT_DIR)) await mkdir(OUTPUT_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = taskName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
  const prefix = `${ts}_${safeName}`;

  // Chain
  const chainPath = path.join(OUTPUT_DIR, `${prefix}_chain.json`);
  await writeFile(chainPath, JSON.stringify(result.chain, null, 2), "utf-8");
  console.log(`[Output] Chain: ${chainPath}`);

  // Scores
  const scoresPath = path.join(OUTPUT_DIR, `${prefix}_scores.json`);
  await writeFile(scoresPath, JSON.stringify(result.scores, null, 2), "utf-8");
  console.log(`[Output] Scores: ${scoresPath}`);

  // Rejected
  const rejectedPath = path.join(OUTPUT_DIR, `${prefix}_rejected.json`);
  await writeFile(
    rejectedPath,
    JSON.stringify(result.rejected, null, 2),
    "utf-8"
  );
  console.log(`[Output] Rejected: ${rejectedPath}`);

  // FFmpeg command
  const ffmpegPath = path.join(OUTPUT_DIR, `${prefix}_ffmpeg.sh`);
  await writeFile(ffmpegPath, result.ffmpegCommand, "utf-8");
  console.log(`[Output] FFmpeg: ${ffmpegPath}`);

  // Summary
  const avgScore =
    result.scores.length > 0
      ? result.scores.reduce((s, x) => s + x.score, 0) / result.scores.length
      : 0;

  const summary = {
    timestamp: ts,
    task: taskName,
    chainLength: result.chain.length,
    rejectedCount: result.rejected.length,
    scoredCount: result.scores.length,
    averageScore: Math.round(avgScore * 10) / 10,
  };
  const summaryPath = path.join(OUTPUT_DIR, `${prefix}_summary.json`);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`[Output] Summary: ${summaryPath}`);
}

/**
 * Write Session 3 QA audit report to output directory.
 */
export async function writeSession3Report(
  result: Session3Response,
  taskName: string
): Promise<void> {
  if (!existsSync(OUTPUT_DIR)) await mkdir(OUTPUT_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = taskName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
  const prefix = `${ts}_${safeName}`;

  // Full QA report
  const reportPath = path.join(OUTPUT_DIR, `${prefix}_qa_report.json`);
  await writeFile(reportPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`[Output] QA Report: ${reportPath}`);

  // Human-readable summary
  const issuesByTransition = result.transitions.filter(
    (t) => t.issues.length > 0
  );
  const highIssues = result.issues.filter((i) => i.severity === "high");

  const lines = [
    `=== QA AUDIT REPORT ===`,
    `Task: ${taskName}`,
    `Overall Score: ${result.overallScore}/100`,
    `Verdict: ${result.overallVerdict.toUpperCase()}`,
    `Scenario Fit: ${result.scenarioFit}`,
    ``,
    `Energy Curve: ${result.energyCurve}`,
    ``,
    `Transitions: ${result.transitions.length} total, ${issuesByTransition.length} with issues`,
    `Global Issues: ${result.issues.length} total, ${highIssues.length} high severity`,
    ``,
  ];

  if (highIssues.length > 0) {
    lines.push(`--- HIGH SEVERITY ISSUES ---`);
    for (const issue of highIssues) {
      lines.push(`  [${issue.timecode}] ${issue.description}`);
    }
    lines.push(``);
  }

  if (issuesByTransition.length > 0) {
    lines.push(`--- TRANSITION ISSUES ---`);
    for (const t of issuesByTransition) {
      lines.push(`  [${t.timecode}] ${t.fromTrack} -> ${t.toTrack}:`);
      for (const issue of t.issues) {
        lines.push(`    - ${issue}`);
      }
    }
  }

  const textPath = path.join(OUTPUT_DIR, `${prefix}_qa_report.txt`);
  await writeFile(textPath, lines.join("\n"), "utf-8");
  console.log(`[Output] QA Summary: ${textPath}`);
}
