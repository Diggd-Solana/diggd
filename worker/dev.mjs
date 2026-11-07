// Local API for previewing the site: the worker on http://localhost:8801 with an in-memory D1, a fake RPC and a few sample bones.
// Run: node dev.mjs
import { createServer } from 'node:http';
import worker, { seal, commitOf } from './src/index.js';
import { sqliteD1 } from './d1-sqlite.mjs';

const RPC = 'https://rpc.dev';
const env = { DB: sqliteD1(), SOL_RPC_URL: RPC, BONE_KEY: 'dev-key', ADMIN_KEY: 'dev', TOKEN_ADDRESS: '', TOKEN_DECIMALS: '6', BURY_BURN: '50000', HOLD_EARLY: '500000', EARLY_MIN: '5', CONFIRM_CHECKS: '2', MIN_TARGET_USD: '5000', SITE_URL: 'http://localhost:4221' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== RPC) return realFetch(url, init);
  const { method } = JSON.parse(init.body);
  const result = { getTokenAccountsByOwner: { value: [] }, getLatestBlockhash: { value: { blockhash: '11111111111111111111111111111111' } } }[method] ?? null;
  return new Response(JSON.stringify({ result }));
};

const H = 3600000, now = Date.now();
const db = env.DB;
const A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const T1 = 'AZP1ocAtvJdE19wZ98M5JykfyCw85z5YbGK9oH4Kpump', T2 = '8Lgivur5fsuYUvG7bJkryjfuvQwCkLDTcFcWJ9A9pump', T3 = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
await db.prepare('INSERT INTO markets (mint, name, symbol, mcap, holders, updated) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)')
  .bind(T1, 'Sample Hound', 'HOUND', 73400, 812, now, T2, 'Sample Hat', 'HAT', 214000, 1490, now, T3, 'Sample Moon', 'MOON', 18200, 233, now).run();
const bones = [
  [A, 'The next CA', 'Next launch: not ready for the demo, this is sample text.', T1, 100000, 0, 42000, 1, now - 6 * H],
  [B, 'Who the team really is', 'Sample reveal text.', T2, 500000, 0, 120000, 0, now - 20 * H],
  [A, 'Roadmap, the real one', 'Sample reveal text.', T3, 50000, 0, 15000, 1, now - 2 * H],
  [B, 'New Year message', 'Sample reveal text.', null, 0, now + 60 * 24 * H, 0, 0, now - 12 * H],
];
let n = 0;
for (const [author, teaser, body, mint, target, openAt, start, creator, created] of bones) {
  const salt = 'ab'.repeat(16);
  const box = await seal(env, { salt, body });
  await db.prepare('INSERT INTO bones (author, teaser, mint, target, open_at, start_mcap, commit_hash, sealed, iv, tx, by_creator, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(author, teaser, mint, target, openAt, start, await commitOf({ salt, mint, target, openAt, body }), box.sealed, box.iv, String(++n).repeat(88), creator, created).run();
}
const salt = 'cd'.repeat(16), body = 'Dev wallet is 7xKX...gAsU. Team tokens locked until March. Next: a buyback from every creator fee, starting at 150K.';
const box = await seal(env, { salt, body });
await db.prepare("INSERT INTO bones (author, teaser, mint, target, start_mcap, commit_hash, sealed, iv, tx, by_creator, created, status, opened_at, opened_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'dug', ?, 'mcap')")
  .bind(A, 'What happens at 200K', T2, 200000, 90000, await commitOf({ salt, mint: T2, target: 200000, openAt: 0, body }), box.sealed, box.iv, '9'.repeat(88), now - 30 * H, now - 3 * H).run();

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request('http://localhost:8801' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8801, () => console.log('DIGGD dev API on http://localhost:8801'));
