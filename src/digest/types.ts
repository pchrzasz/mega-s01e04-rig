export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner from the latest run, including an explicitly unknown owner. */
  owner: string | null;
  /** Number of valid log records for this job, including retries. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent supplied error; retained when a later run succeeds. */
  lastError: string | null;
  /** Original timestamp strings, including their timezone offsets. */
  firstAt: string;
  lastAt: string;
  /** True if any record failed, even when the latest run succeeded. */
  hasFail: boolean;
};

export type NightDigest = {
  night: string;
  /** One row per job, sorted by job using code-point order. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid log records by status, not counts of aggregated jobs. */
  counts: Record<RunStatus, number>;
};

/**
 * Implemented by readNight in ./reader.js. Missing files and invalid YYYY-MM-DD
 * night names return null. Empty files return a digest with no rows. Malformed
 * JSON or invalid records count as bad lines; a trailing newline is ignored.
 * First/last values follow timestamp order (line order breaks timestamp ties).
 * Other filesystem errors propagate to the caller.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
