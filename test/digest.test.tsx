import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

const tempDirs: string[] = [];

async function appWithRuns(files: Record<string, string>) {
  const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-runs-'));
  tempDirs.push(runsDir);
  await Promise.all(
    Object.entries(files).map(([night, contents]) => writeFile(join(runsDir, `${night}.jsonl`), contents)),
  );
  return createApp({ ...config, runsDir });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('digest routes', () => {
  it('serves the same sorted digest as HTML and JSON, preserving offsets and warning states', async () => {
    const app = await appWithRuns({
      '2026-10-28': [
        '{"at":"2026-10-28T09:00:00-07:00","job":"zulu","status":"ok","owner":"zoe"}',
        '{"at":"2026-10-28T09:01:00-07:00","job":"alpha","status":"retry","owner":null,"error":"first attempt"}',
        '{"at":"2026-10-28T09:02:00-07:00","job":"broken","status":"fail","owner":"lee","error":"disk full"}',
        'not json',
        '{"at":"2026-10-28T09:03:00-07:00","job":"alpha","status":"retry","owner":null}',
        '{"at":"2026-10-28T09:04:00-07:00","job":"alpha","status":"retry","owner":null}',
        '{"at":"2026-10-28T09:05:00-07:00","job":"alpha","status":"ok","owner":null}',
        '{"at":"2026-10-28T09:06:00-07:00","job":"broken","status":"ok","owner":"lee"}',
      ].join('\n'),
    });

    const [jsonResponse, htmlResponse] = await Promise.all([
      app.request('/api/digest/2026-10-28'),
      app.request('/digest/2026-10-28'),
    ]);
    expect(jsonResponse.status).toBe(200);
    expect(htmlResponse.status).toBe(200);

    const digest = await jsonResponse.json();
    const html = await htmlResponse.text();
    const jobs = digest.rows.map((row: { job: string }) => row.job);
    expect(digest.night).toBe('2026-10-28');
    expect(jobs).toEqual(['alpha', 'broken', 'zulu']);
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 3, retry: 3, fail: 1 });

    const htmlJobs = ['alpha', 'broken', 'zulu'].map((job) => html.indexOf(`<td>${job}</td>`));
    expect(htmlJobs.every((index) => index >= 0)).toBe(true);
    expect(htmlJobs).toEqual([...htmlJobs].sort((a, b) => a - b));
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('2026-10-28T09:01:00-07:00');
    expect(html).toContain('2026-10-28T09:05:00-07:00');

    const alphaRow = digest.rows[0];
    expect(alphaRow).toMatchObject({ owner: null, runs: 4, retries: 3, lastStatus: 'ok', lastError: 'first attempt' });
    expect(html).toMatch(/<td class="warn">3<\/td>/);
    expect(digest.rows[1]).toMatchObject({ job: 'broken', lastStatus: 'ok', hasFail: true });
    expect(html).toMatch(/<tr class="warn"><td>broken<\/td>/);
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const app = await appWithRuns({});
    const [jsonResponse, htmlResponse] = await Promise.all([
      app.request('/api/digest/2026-10-27'),
      app.request('/digest/2026-10-27'),
    ]);

    expect(jsonResponse.status).toBe(404);
    expect(htmlResponse.status).toBe(404);
  });

  it('renders and returns an empty night as nothing ran', async () => {
    const app = await appWithRuns({ '2026-10-29': '' });
    const [jsonResponse, htmlResponse] = await Promise.all([
      app.request('/api/digest/2026-10-29'),
      app.request('/digest/2026-10-29'),
    ]);

    expect(jsonResponse.status).toBe(200);
    expect(htmlResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({ night: '2026-10-29', rows: [], badLines: 0 });
    expect(await htmlResponse.text()).toContain('nothing ran');
  });
});
