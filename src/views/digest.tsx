import type { NightDigest } from '../digest/types.js';

const missing = (value: string | null) => value ?? '—';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p class="mute">bad lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first at</th>
              <th>last at</th>
              <th>failed</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr class={row.hasFail ? 'warn' : undefined}>
                <td>{row.job}</td>
                <td>{missing(row.owner)}</td>
                <td>{row.runs}</td>
                <td class={row.retries >= 3 ? 'warn' : undefined}>{row.retries}</td>
                <td>{row.lastStatus}</td>
                <td>{missing(row.lastError)}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
                <td>{row.hasFail ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
