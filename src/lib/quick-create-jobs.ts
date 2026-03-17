type ActiveQuickCreateJob = {
  jobId: string;
  sourceTabId?: string | null;
  draftId?: string | null;
  startedAt: string;
};

declare global {
  var __palxQuickCreateJobs: Map<string, ActiveQuickCreateJob> | undefined;
}

function globalJobs(): Map<string, ActiveQuickCreateJob> {
  if (!globalThis.__palxQuickCreateJobs) {
    globalThis.__palxQuickCreateJobs = new Map();
  }

  return globalThis.__palxQuickCreateJobs;
}

export function registerQuickCreateJob(input: {
  jobId: string;
  sourceTabId?: string | null;
  draftId?: string | null;
}): number {
  const jobs = globalJobs();
  jobs.set(input.jobId, {
    jobId: input.jobId,
    sourceTabId: input.sourceTabId ?? null,
    draftId: input.draftId ?? null,
    startedAt: new Date().toISOString(),
  });
  return jobs.size;
}

export function completeQuickCreateJob(jobId: string): number {
  const jobs = globalJobs();
  jobs.delete(jobId);
  return jobs.size;
}

export function getActiveQuickCreateJobCount(): number {
  return globalJobs().size;
}
