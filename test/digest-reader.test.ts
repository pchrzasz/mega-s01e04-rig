import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-29T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook',
};
let runsDir: string;

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeRuns(records: unknown[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), records.map((record) => JSON.stringify(record)).join('\n'));
}

describe('night reader', () => {
  it('reads the real fixture without dropping unknown owners or damaged lines', () => {
    const digest = readNight('runs', night);
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
      lastError: null, firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00', hasFail: false,
    });
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00', hasFail: false,
    });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', hasFail: true });
  });

  it('distinguishes missing and empty files', () => {
    expect(readNight(runsDir, night)).toBeNull();
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('rejects paths and impossible dates before reading', () => {
    for (const invalid of ['../2026-10-28', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00']) {
      expect(readNight(runsDir, invalid)).toBeNull();
    }
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29')?.rows).toEqual([]);
  });

  it('counts malformed JSON and invalid records, but keeps later valid records', () => {
    const invalid = [
      null, [], 42, {},
      { ...event, status: 'unknown' }, { ...event, owner: 42 },
      { ...event, owner: undefined }, { ...event, job: '' },
      { ...event, at: '2026-02-30T01:00:00+01:00' },
      { ...event, at: '2026-10-29T01:00:00' },
      { ...event, at: '2026-10-29T24:00:00+01:00' },
      { ...event, error: {} },
    ];
    writeRuns([...invalid, event]);
    const file = join(runsDir, `${night}.jsonl`);
    writeFileSync(file, '\n{broken\n', { flag: 'a' });
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('ignores one final newline but counts interior blank lines', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), `${JSON.stringify(event)}\r\n\r\n${JSON.stringify(event)}\r\n`);
    expect(readNight(runsDir, night)).toMatchObject({ badLines: 1, counts: { ok: 2, retry: 0, fail: 0 } });
  });

  it('orders by instant, preserves offsets, and remembers failure after recovery', () => {
    writeRuns([
      { ...event, at: '2026-10-29T03:00:00+02:00', owner: null },
      { ...event, at: '2026-10-29T01:30:00+01:00', status: 'fail', error: 'down' },
      { ...event, at: '2026-10-28T23:00:00Z', status: 'retry', error: 'waiting' },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toEqual({
      job: event.job, owner: null, runs: 3, retries: 1, lastStatus: 'ok',
      lastError: 'down', firstAt: '2026-10-28T23:00:00Z',
      lastAt: '2026-10-29T03:00:00+02:00', hasFail: true,
    });
  });

  it('breaks tied timestamps by line order and handles arbitrary job names', () => {
    writeRuns([
      { ...event, job: '__proto__', status: 'fail', error: 'first' },
      { ...event, job: '__proto__', owner: null, error: 'second' },
      { ...event, job: 'constructor' },
    ]);
    expect(readNight(runsDir, night)?.rows).toMatchObject([
      { job: '__proto__', owner: null, runs: 2, lastStatus: 'ok', lastError: 'second', hasFail: true },
      { job: 'constructor', runs: 1 },
    ]);
  });

  it('does not disguise filesystem errors as a missing night', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
