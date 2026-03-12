import { randomUUID } from "crypto";

export type JobStatus = "pending" | "running" | "completed" | "failed";
export type JobType = "session1" | "session2" | "session3" | "build";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const jobs = new Map<string, Job>();

export function createJob(type: JobType): Job {
  const job: Job = {
    id: randomUUID(),
    type,
    status: "pending",
    progress: "Queued",
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function getAllJobs(): Job[] {
  return Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function updateJob(
  id: string,
  update: Partial<Pick<Job, "status" | "progress" | "result" | "error">>
): void {
  const job = jobs.get(id);
  if (!job) return;

  Object.assign(job, update);

  if (update.status === "completed" || update.status === "failed") {
    job.completedAt = new Date().toISOString();
  }
}
