// Exercises the worker in Node: node:sqlite stands in for D1, the Solana RPC and Jupiter are faked.
// Run: node test.mjs
import { ed25519 } from '@noble/curves/ed25519';
import worker, { tick, commitOf } from './src/index.js';
import { sqliteD1 } from './d1-sqlite.mjs';
import { b58encode, b58decode, bondingCurve } from './src/chain.js';

const RPC = 'https://rpc.test';
const env = { DB: sqliteD1(), SOL_RPC_URL: RPC, BONE_KEY: 'test-key', ADMIN_KEY: 'admin-test', TOKEN_ADDRESS: '', TOKEN_DECIMALS: '6', BURY_BURN: '50000', HOLD_EARLY: '500000', EARLY_MIN: '5', CONFIRM_CHECKS: '2', MIN_TARGET_USD: '5000', SITE_URL: 'https://diggd.test' };

const wallet = () => { const sk = ed25519.utils.randomPrivateKey(); return { sk, address: b58encode(ed25519.getPublicKey(sk)) }; };
const dev = wallet(), reader = wallet(), holder = wallet();
const MINT = wallet().address, UNKNOWN = wallet().address;

// ---- fake chain and market ----
const txs = {}, holdings = {}, markets = { [MINT]: { id: MINT, name: 'Doge Wif Hat', symbol: 'DWH', mcap: 40000, holderCount: 321 } };
let jupiterDown = false;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://lite-api.jup.ag/')) {
    if (jupiterDown) return new Response('{}', { status: 400 });
    const q = decodeURIComponent(String(url).split('query=')[1]).split(',');
    return new Response(JSON.stringify(q.map((m) => markets[m]).filter(Boolean)));
  }
  if (String(url) !== RPC) throw new Error('unexpected fetch ' + url);
  const { method, params } = JSON.parse(init.body);
  const curve = new Uint8Array(81); curve.set(b58decode(dev.address), 49);
  const result = {
    getTransaction: () => txs[params[0]] ?? null,
    getAccountInfo: () => (params[0] === bondingCurve(MINT) ? { value: { data: [Buffer.from(curve).toString('base64'), 'base64'] } } : { value: null }),
    getTokenAccountsByOwner: () => ({ value: holdings[params[0]] ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: holdings[params[0]] } } } } } }] : [] }),
    getLatestBlockhash: () => ({ value: { blockhash: '11111111111111111111111111111111' } }),
  }[method]?.();
  return new Response(JSON.stringify(result === undefined ? { error: { message: 'nope' } } : { result }));
};
const nextSig = () => b58encode(crypto.getRandomValues(new Uint8Array(64)));
const sealTx = (author, memo, extra = []) => ({ blockTime: Math.floor(Date.now() / 1000), meta: { err: null, innerInstructions: [] }, transaction: { message: { accountKeys: [{ pubkey: author, signer: true }], instructions: [{ program: 'spl-memo', parsed: memo }, ...extra] } } });
const burnIx = (authority, tokens, mint) => ({ parsed: { type: 'burnChecked', info: { mint, authority, tokenAmount: { amount: String(BigInt(tokens) * 10n ** 6n) } } } });

const call = async (path, init = {}, token) => {
  const headers = { 'content-type': 'application/json', ...(init.headers || {}), ...(token ? { authorization: 'Bearer ' + token } : {}) };
  const res = await worker.fetch(new Request('https://api.diggd.test' + path, { ...init, headers }), env);
  const text = await res.text();
  return [res.status, text ? JSON.parse(text) : null];
};
const post = (path, body, token, headers) => call(path, { method: 'POST', body: JSON.stringify(body), headers }, token);
const signIn = async (w) => {
  const message = `DIGGD sign-in\nWallet: ${w.address}\nTime: ${new Date().toISOString()}`;
  return post('/v1/auth', { address: w.address, message, signature: b58encode(ed25519.sign(new TextEncoder().encode(message), w.sk)) });
};
const mcp = (method, params, token) => post('/mcp', { jsonrpc: '2.0', id: 1, method, params }, token);
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ': ' + String(JSON.stringify(detail)).slice(0, 400)}`); };

const SALT = 'ab'.repeat(16);
// seals like the site does: hash the text and conditions, send a memo transaction, post the bone
async function make(w, fields, extra = []) {
  const input = { teaser: 'The next CA', body: 'CA: So11111111111111111111111111111111111111112', salt: SALT, mint: MINT, targetUsd: 100000, openAt: 0, ...fields };
  const tx = nextSig();
  const commit = await commitOf({ salt: input.salt, mint: input.mint, target: input.targetUsd, openAt: input.openAt, body: input.body });
  txs[tx] = sealTx(w.address, `diggd:${commit}`, extra);
  return post('/v1/bones', { ...input, tx });
}

// ---- basics ----
const [, root] = await call('/');
check('root describes the API', root.name === 'DIGGD' && root.endpoints.includes('/mcp'), root);
const [sa, s1] = await signIn(reader);
check('wallet signs in', sa === 200 && s1.session.startsWith('sess_'), s1);
const rs = s1.session;
const forged = await post('/v1/auth', { address: dev.address, message: `DIGGD sign-in\nWallet: ${dev.address}\nTime: ${new Date().toISOString()}`, signature: b58encode(ed25519.sign(new TextEncoder().encode('x'), reader.sk)) });
check('forged signature rejected', forged[0] === 401, forged);
check('unknown session', (await call('/v1/me', {}, 'sess_' + '0'.repeat(48)))[0] === 401);
const [, tok] = await call(`/v1/token/${MINT}`);
check('token lookup finds name, market cap and creator', tok.symbol === 'DWH' && tok.mcap === 40000 && tok.creator === dev.address, tok);
check('unknown token', (await call(`/v1/token/${UNKNOWN}`))[0] === 404);

// ---- sealing ----
const [c1, w1] = await make(dev, {});
check('bone sealed', c1 === 201 && w1.id === 1 && w1.status === 'buried' && w1.url === 'https://diggd.test/#/b/1', w1);
check('creator bone is marked', w1.creatorBone === true && w1.startMcap === 40000, w1);
const [, w2] = await make(reader, { teaser: 'What the dev told me', targetUsd: 200000 });
check('anyone else is not marked creator', w2.creatorBone === false && w2.author === reader.address, w2);
const tiny = await make(dev, { targetUsd: 41000 });
check('target must sit above the market cap', tiny[0] === 400 && /10% above/.test(tiny[1].error), tiny);
check('target needs a mint', (await make(dev, { mint: null }))[0] === 400);
check('needs a condition', (await make(dev, { targetUsd: 0 }))[0] === 400);
check('date cannot be in the past', (await make(dev, { targetUsd: 0, openAt: Date.now() - 1000 }))[0] === 400);
check('body must be trimmed', (await make(dev, { body: ' padded ' }))[0] === 400);
const wrongMemo = nextSig();
txs[wrongMemo] = sealTx(dev.address, 'diggd:' + '0'.repeat(64));
const [wm, wmr] = await post('/v1/bones', { teaser: 'Swapped text', body: 'something else', salt: SALT, mint: MINT, targetUsd: 100000, tx: wrongMemo });
check('memo must match the text', wm === 400 && /does not match/.test(wmr.error), wmr);
const changed = nextSig();
txs[changed] = sealTx(dev.address, `diggd:${await commitOf({ salt: SALT, mint: MINT, target: 100000, openAt: 0, body: 'hello' })}`);
check('memo binds the target too', (await post('/v1/bones', { teaser: 'Lower target', body: 'hello', salt: SALT, mint: MINT, targetUsd: 60000, tx: changed }))[0] === 400);
const missing = nextSig();
check('unseen transaction is retryable', (await post('/v1/bones', { teaser: 'Too soon', body: 'hello', salt: SALT, mint: MINT, targetUsd: 100000, tx: missing }))[0] === 404);
check('a transaction seals once', (await post('/v1/bones', { teaser: 'Again', body: 'CA: So11111111111111111111111111111111111111112', salt: SALT, mint: MINT, targetUsd: 100000, tx: w1.tx }))[0] === 409);

// ---- secrecy ----
const [, anon1] = await call('/v1/bones/1');
check('buried text is hidden', anon1.body === null && anon1.salt === null, anon1);
const stored = await env.DB.prepare('SELECT sealed FROM bones WHERE id = 1').first();
check('database holds ciphertext only', !Buffer.from(stored.sealed, 'base64').toString().includes('So1111'), stored);
const [, list0] = await call('/v1/bones');
check('list hides text too', list0.bones.length === 2 && list0.bones.every((w) => w.body === null), list0);
const ds = (await signIn(dev))[1].session;
const [, own] = await call('/v1/bones/1', {}, ds);
check('author reads their own bone', own.body.startsWith('CA:'), own);
const [, oth] = await call('/v1/bones/1', {}, rs);
check('others cannot', oth.body === null, oth);

// ---- progress and the opener ----
markets[MINT].mcap = 70000;
await tick(env);
const [, p1] = await call('/v1/bones/1');
check('progress follows the market cap', p1.progress === 0.5 && p1.token.mcap === 70000, p1);
markets[MINT].mcap = 120000;
await tick(env);
const [, p2] = await call('/v1/bones/1');
check('one check over the target does not open', p2.status === 'buried', p2);
markets[MINT].mcap = 50000;
await tick(env);
markets[MINT].mcap = 120000;
await tick(env);
check('a wick resets the count', (await call('/v1/bones/1'))[1].status === 'buried');
jupiterDown = true;
await tick(env);
check('market outage changes nothing', (await env.DB.prepare('SELECT hits FROM bones WHERE id = 1').first()).hits === 1);
jupiterDown = false;
const r = await tick(env);
const [, p3] = await call('/v1/bones/1');
check('two checks in a row open it', r.dug === 1 && p3.status === 'dug' && p3.openedBy === 'mcap' && p3.progress === 1, [r, p3]);
check('dug text is public without a token', p3.body.startsWith('CA:') && p3.salt === SALT, p3);
check('hash recomputes from the dug bone', p3.commit === await commitOf({ salt: p3.salt, mint: p3.token.mint, target: p3.targetUsd, openAt: p3.openAtMs, body: p3.body }), p3);
check('the other bone stays shut', (await call('/v1/bones/2'))[1].status === 'buried');

// ---- dates ----
const at = Date.now() + 10 * 60000;
const [dc, d1] = await make(dev, { teaser: 'Date only', mint: null, targetUsd: 0, openAt: at, body: 'time capsule' });
check('date-only bone needs no token', dc === 201 && d1.token === null, d1);
await tick(env);
check('stays shut before the date', (await call(`/v1/bones/${d1.id}`))[1].status === 'buried');
const later = await tick(env, at + 1000);
await env.DB.prepare('UPDATE bones SET opened_at = ? WHERE opened_at > ?').bind(Date.now() - 1000, Date.now()).run();
const [, d2] = await call(`/v1/bones/${d1.id}`);
check('opens on the date', later.dug === 1 && d2.status === 'dug' && d2.openedBy === 'date' && d2.body === 'time capsule', d2);
const [, both] = await make(dev, { teaser: 'Either one', targetUsd: 500000, openAt: at, body: 'either' });
await tick(env, at + 1000);
await env.DB.prepare('UPDATE bones SET opened_at = ? WHERE opened_at > ?').bind(Date.now() - 1000, Date.now()).run();
check('date also opens a target bone', (await call(`/v1/bones/${both.id}`))[1].openedBy === 'date');

// ---- moderation ----
check('hide needs the admin key', (await post('/v1/admin/hide', { id: 2 }, null, { 'x-admin-key': 'nope' }))[0] === 403);
await post('/v1/admin/hide', { id: 2 }, null, { 'x-admin-key': 'admin-test' });
check('hidden bone is gone', (await call('/v1/bones/2'))[0] === 404);

// ---- stats, me, lists ----
const [, st] = await call('/v1/stats');
check('stats', st.dug === 3 && st.buried === 0 && st.authors === 1 && st.buryBurn === 0, st);
const [, mine] = await call('/v1/me', {}, ds);
check('me lists my bones', mine.wallet === dev.address && mine.bones.length === 3, mine);
const [, dug] = await call(`/v1/bones?status=dug&mint=${MINT}`);
check('filter by token', dug.bones.length === 2 && dug.bones.every((w) => w.body), dug);

// ---- MCP ----
const [, init] = await mcp('initialize', {});
check('mcp initialize', init.result.serverInfo.name === 'diggd', init);
const [, tl] = await mcp('tools/list', {});
check('mcp tools', tl.result.tools.map((t) => t.name).join() === 'list_bones,get_bone,check_token', tl);
const [, ml] = await mcp('tools/call', { name: 'list_bones', arguments: { status: 'dug' } });
check('mcp list_bones shows dug text', ml.result.content[0].text.includes('CA: So111'), ml);
const [, mg] = await mcp('tools/call', { name: 'get_bone', arguments: { id: 1 } });
check('mcp get_bone', mg.result.content[0].text.includes('$DWH'), mg);
const [, mc] = await mcp('tools/call', { name: 'check_token', arguments: { mint: MINT } });
check('mcp check_token', /by creator/.test(mc.result.content[0].text), mc);

// ---- after launch: burn to seal, holders read first ----
env.TOKEN_ADDRESS = wallet().address;
markets[MINT].mcap = 40000;
const noBurn = await make(dev, {});
check('sealing needs a burn after launch', noBurn[0] === 400 && /burn 50,000/.test(noBurn[1].error), noBurn);
check('too small a burn', (await make(dev, {}, [burnIx(dev.address, 1000, env.TOKEN_ADDRESS)]))[0] === 400);
check('someone else burning does not count', (await make(dev, {}, [burnIx(reader.address, 50000, env.TOKEN_ADDRESS)]))[0] === 400);
const [bc, w9] = await make(dev, { teaser: 'Holders first' }, [burnIx(dev.address, 50000, env.TOKEN_ADDRESS)]);
check('seal with burn', bc === 201, w9);
markets[MINT].mcap = 120000;
await tick(env); await tick(env);
const [, pub] = await call(`/v1/bones/${w9.id}`);
check('fresh reveal hidden from the public', pub.status === 'dug' && pub.holdersOnly === true && pub.body === null, pub);
holdings[holder.address] = 600000;
const hs = (await signIn(holder))[1].session;
const [, hv] = await call(`/v1/bones/${w9.id}`, {}, hs);
check('holder reads it first', hv.body && hv.body.startsWith('CA:'), hv);
const [, rv] = await call(`/v1/bones/${w9.id}`, {}, rs);
check('non-holder waits', rv.body === null, rv);
await env.DB.prepare('UPDATE bones SET opened_at = ? WHERE id = ?').bind(Date.now() - 6 * 60000, w9.id).run();
check('everyone reads it after the window', (await call(`/v1/bones/${w9.id}`))[1].body !== null);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
