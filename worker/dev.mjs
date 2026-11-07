// Local API for previewing the site: the worker on http://localhost:8802 with an in-memory D1 and a few sample bones.
// Run: node dev.mjs
import { createServer } from 'node:http';
import worker, { seal, commitOf } from './src/index.js';
import { sqliteD1 } from './d1-sqlite.mjs';

const env = { DB: sqliteD1(), RH_RPC_URL: 'https://rpc.mainnet.chain.robinhood.com', SEAL_KEY: 'dev-key', ADMIN_KEY: 'dev', TOKEN_ADDRESS: '', TOKEN_DECIMALS: '18', BURY_BURN: '50000', HOLD_EARLY: '500000', EARLY_MIN: '5', CONFIRM_CHECKS: '2', MIN_TARGET_USD: '5000', SITE_URL: 'http://localhost:4222' };
const H = 3600000, now = Date.now();
const db = env.DB;
const A = '0x9e71a684b45af527e499efa48f47d144a79d6d24', B = '0xddaa87b3f13cc816865d90dad89ea9a98a500307';
const T1 = '0x1111111111111111111111111111111111111111', T2 = '0x2222222222222222222222222222222222222222', T3 = '0x3333333333333333333333333333333333333333';
await db.prepare('INSERT INTO markets (token, name, symbol, mcap, stage, updated) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)')
  .bind(T1, 'Sample Hound', 'HOUND', 73400, 'curve', now, T2, 'Sample Hat', 'HAT', 214000, 'graduated', now, T3, 'Sample Moon', 'MOON', 18200, 'curve', now).run();
const bones = [
  [A, 'The next CA', 'Next launch: not ready for the demo, this is sample text.', T1, 100000, 0, 42000, 1, now - 6 * H],
  [B, 'Who the team really is', 'Sample reveal text.', T2, 500000, 0, 120000, 0, now - 20 * H],
  [A, 'Roadmap, the real one', 'Sample reveal text.', T3, 50000, 0, 15000, 1, now - 2 * H],
  [B, 'New Year message', 'Sample reveal text.', null, 0, now + 60 * 24 * H, 0, 0, now - 12 * H],
];
let n = 0;
for (const [author, teaser, body, token, target, openAt, start, creator, created] of bones) {
  const salt = 'ab'.repeat(16);
  const box = await seal(env, { salt, body });
  await db.prepare('INSERT INTO bones (author, teaser, token, target, open_at, start_mcap, commit_hash, sealed, iv, tx, by_creator, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(author, teaser, token, target, openAt, start, await commitOf({ salt, token, target, openAt, body }), box.sealed, box.iv, '0x' + String(++n).repeat(64), creator, created).run();
}
const salt = 'cd'.repeat(16), body = 'Dev wallet is 0x9e71...6d24. Team tokens locked until March. Next: a buyback from every creator tax, starting at 150K.';
const box = await seal(env, { salt, body });
await db.prepare("INSERT INTO bones (author, teaser, token, target, start_mcap, commit_hash, sealed, iv, tx, by_creator, created, status, dug_at, dug_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'dug', ?, 'mcap')")
  .bind(A, 'What happens at 200K', T2, 200000, 90000, await commitOf({ salt, token: T2, target: 200000, openAt: 0, body }), box.sealed, box.iv, '0x' + '9'.repeat(64), now - 30 * H, now - 3 * H).run();

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request('http://localhost:8802' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8802, () => console.log('Diggd dev API on http://localhost:8802'));
