import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type Run = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isDate(value.slice(0, 10))
    && Number.isFinite(Date.parse(value));
}

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false;
  return 'at' in value && isTimestamp(value.at)
    && 'job' in value && typeof value.job === 'string' && value.job.trim().length > 0
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && 'owner' in value && (value.owner === null || typeof value.owner === 'string')
    && (!('error' in value) || typeof value.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isDate(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = {
    night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
  };
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const runs: Run[] = [];
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      digest.badLines += 1;
      continue;
    }
    if (!isRun(value)) {
      digest.badLines += 1;
      continue;
    }
    runs.push(value);
  }

  // Stable sorting preserves log order when timestamps refer to the same instant.
  runs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = new Map<string, DigestRow>();
  for (const run of runs) {
    digest.counts[run.status] += 1;
    const row = rows.get(run.job) ?? {
      job: run.job, owner: run.owner, runs: 0, retries: 0,
      lastStatus: run.status, lastError: null,
      firstAt: run.at, lastAt: run.at, hasFail: false,
    };
    row.runs += 1;
    if (run.status === 'retry') row.retries += 1;
    if (run.status === 'fail') row.hasFail = true;
    row.owner = run.owner;
    row.lastStatus = run.status;
    if (run.error !== undefined) row.lastError = run.error;
    row.lastAt = run.at;
    rows.set(run.job, row);
  }
  digest.rows = [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
