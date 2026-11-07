// Exercises the worker in Node: node:sqlite stands in for D1, Robinhood Chain RPC and Pons are faked.
// Run: node test.mjs
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import worker, { tick, commitOf, PROOF_TAG } from './src/index.js';
import { sqliteD1 } from './d1-sqlite.mjs';

const RPC = 'https://rpc.test', PONS = 'https://ponsfamily.com/api/launches/';
const env = { DB: sqliteD1(), RH_RPC_URL: RPC, SEAL_KEY: 'test-key', ADMIN_KEY: 'admin-test', TOKEN_ADDRESS: '', TOKEN_DECIMALS: '18', BURY_BURN: '50000', HOLD_EARLY: '500000', EARLY_MIN: '5', CONFIRM_CHECKS: '2', MIN_TARGET_USD: '5000', SITE_URL: 'https://diggd.test' };

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const wallet = () => { const sk = secp256k1.utils.randomPrivateKey(); return { sk, address: '0x' + hex(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(-20)) }; };
const personalSign = (w, message) => {
  const body = new TextEncoder().encode(message);
  const sig = secp256k1.sign(keccak_256(new Uint8Array([...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`), ...body])), w.sk);
  return '0x' + sig.toCompactHex() + (27 + sig.recovery).toString(16);
};
const dev = wallet(), reader = wallet(), holder = wallet();
const TOKEN = wallet().address, UNKNOWN = wallet().address, DIGGD = wallet().address;

// ---- fake chain and market ----
const txs = {}, receipts = {}, balances = {};
const markets = { [TOKEN]: { address: TOKEN, name: 'Doge Wif Hat', symbol: 'DWH', marketCapUsd: 40000, deployer: dev.address, stage: 'curve' } };
let ponsDown = false, blockTime = () => Math.floor(Date.now() / 1000);
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(PONS)) {
    if (ponsDown) return new Response('{}', { status: 503 });
    const m = markets[u.slice(PONS.length)];
    return m ? new Response(JSON.stringify(m)) : new Response('{"error":"Not a token address."}', { status: 404 });
  }
  if (u !== RPC) throw new Error('unexpected fetch ' + url);
  const { method, params } = JSON.parse(init.body);
  const result = {
    eth_getTransactionByHash: () => txs[params[0]] ?? null,
    eth_getTransactionReceipt: () => receipts[params[0]] ?? null,
    eth_getBlockByNumber: () => ({ timestamp: '0x' + blockTime().toString(16) }),
    eth_call: () => '0x' + (BigInt(balances['0x' + params[0].data.slice(-40)] || 0) * 10n ** 18n).toString(16),
  }[method]?.();
  return new Response(JSON.stringify(result === undefined ? { error: { message: 'nope' } } : { result }));
};
const nextTx = () => '0x' + randomHex(32);
const topic = (a) => '0x' + a.slice(2).padStart(64, '0');
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const burnLog = (from, tokens, token, to = '0x000000000000000000000000000000000000dead') => ({ address: token, topics: [TRANSFER, topic(from), topic(to)], data: '0x' + (BigInt(tokens) * 10n ** 18n).toString(16) });
function mine(tx, from, commit, logs = [], status = '0x1', prefix = '0x') {
  txs[tx] = { from, input: prefix + PROOF_TAG + commit };
  receipts[tx] = { status, blockNumber: '0x1', logs };
}

const call = async (path, init = {}, token) => {
  const headers = { 'content-type': 'application/json', ...(init.headers || {}), ...(token ? { authorization: 'Bearer ' + token } : {}) };
  const res = await worker.fetch(new Request('https://api.diggd.test' + path, { ...init, headers }), env);
  const text = await res.text();
  return [res.status, text ? JSON.parse(text) : null];
};
const post = (path, body, token, headers) => call(path, { method: 'POST', body: JSON.stringify(body), headers }, token);
const signIn = async (w) => {
  const message = `DIGGD sign-in\nWallet: ${w.address}\nTime: ${new Date().toISOString()}`;
  return post('/v1/auth', { address: w.address, message, signature: personalSign(w, message) });
};
const mcp = (method, params, token) => post('/mcp', { jsonrpc: '2.0', id: 1, method, params }, token);
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ': ' + String(JSON.stringify(detail)).slice(0, 400)}`); };

const SALT = 'ab'.repeat(16);
const BODY = 'CA: 0x51250b135174ca09450ec01c4aff73cf69dbb590';
// buries like the site does: hash the text and conditions, send the transaction, post the bone
async function make(w, fields, logs = []) {
  const input = { teaser: 'The next CA', body: BODY, salt: SALT, token: TOKEN, targetUsd: 100000, openAt: 0, ...fields };
  const tx = nextTx();
  mine(tx, w.address, await commitOf({ salt: input.salt, token: input.token, target: input.targetUsd, openAt: input.openAt, body: input.body }), logs);
  return post('/v1/bones', { ...input, tx });
}

// ---- basics ----
const [, root] = await call('/');
check('root describes the API', root.name === 'DIGGD' && root.chain === 'robinhood' && root.endpoints.includes('/mcp'), root);
const [sa, s1] = await signIn(reader);
check('wallet signs in', sa === 200 && s1.session.startsWith('sess_') && s1.wallet === reader.address, s1);
const rs = s1.session;
const fm = `DIGGD sign-in\nWallet: ${dev.address}\nTime: ${new Date().toISOString()}`;
const forged = await post('/v1/auth', { address: dev.address, message: fm, signature: personalSign(reader, fm) });
check('forged signature rejected', forged[0] === 401, forged);
const stale = `DIGGD sign-in\nWallet: ${dev.address}\nTime: ${new Date(Date.now() - 3600000).toISOString()}`;
check('old sign-in rejected', (await post('/v1/auth', { address: dev.address, message: stale, signature: personalSign(dev, stale) }))[0] === 400);
check('unknown session', (await call('/v1/me', {}, 'sess_' + '0'.repeat(48)))[0] === 401);
const [, tok] = await call(`/v1/token/${TOKEN}`);
check('token lookup finds name, market cap and creator', tok.symbol === 'DWH' && tok.mcap === 40000 && tok.creator === dev.address && tok.stage === 'curve', tok);
const [, tokUp] = await call(`/v1/token/${TOKEN.toUpperCase().replace('0X', '0x')}`);
check('addresses are case-insensitive', tokUp.address === TOKEN, tokUp);
check('unknown token', (await call(`/v1/token/${UNKNOWN}`))[0] === 404);

// ---- burying ----
const [c1, a1] = await make(dev, {});
check('bone buried', c1 === 201 && a1.id === 1 && a1.status === 'buried' && a1.url === 'https://diggd.test/#/b/1', a1);
check('creator bone is marked', a1.creatorBone === true && a1.startMcap === 40000, a1);
const [, a2] = await make(reader, { teaser: 'What the dev told me', targetUsd: 200000 });
check('anyone else is not marked creator', a2.creatorBone === false && a2.author === reader.address, a2);
const tiny = await make(dev, { targetUsd: 41000 });
check('target must sit above the market cap', tiny[0] === 400 && /10% above/.test(tiny[1].error), tiny);
check('target needs a token', (await make(dev, { token: null }))[0] === 400);
check('needs a condition', (await make(dev, { targetUsd: 0 }))[0] === 400);
check('date cannot be in the past', (await make(dev, { targetUsd: 0, openAt: Date.now() - 1000 }))[0] === 400);
check('body must be trimmed', (await make(dev, { body: ' padded ' }))[0] === 400);
const unk = await make(dev, { token: UNKNOWN });
check('non-Pons token is refused', unk[0] === 400 && /Pons/.test(unk[1].error), unk);
const wrong = nextTx();
mine(wrong, dev.address, '0'.repeat(64));
const [wm, wmr] = await post('/v1/bones', { teaser: 'Swapped text', body: 'something else', salt: SALT, token: TOKEN, targetUsd: 100000, tx: wrong });
check('hash must match the text', wm === 400 && /does not match/.test(wmr.error), wmr);
const changed = nextTx();
mine(changed, dev.address, await commitOf({ salt: SALT, token: TOKEN, target: 100000, openAt: 0, body: 'hello' }));
check('hash binds the target too', (await post('/v1/bones', { teaser: 'Lower target', body: 'hello', salt: SALT, token: TOKEN, targetUsd: 60000, tx: changed }))[0] === 400);
const failedTx = nextTx();
mine(failedTx, dev.address, await commitOf({ salt: SALT, token: TOKEN, target: 100000, openAt: 0, body: 'reverted' }), [], '0x0');
check('reverted transaction refused', (await post('/v1/bones', { teaser: 'Reverted', body: 'reverted', salt: SALT, token: TOKEN, targetUsd: 100000, tx: failedTx }))[0] === 400);
check('unseen transaction is retryable', (await post('/v1/bones', { teaser: 'Too soon', body: 'hello', salt: SALT, token: TOKEN, targetUsd: 100000, tx: nextTx() }))[0] === 404);
check('a transaction buries once', (await post('/v1/bones', { teaser: 'Again', body: BODY, salt: SALT, token: TOKEN, targetUsd: 100000, tx: a1.tx }))[0] === 409);
const oldTx = nextTx();
mine(oldTx, dev.address, await commitOf({ salt: SALT, token: TOKEN, target: 100000, openAt: 0, body: 'old' }));
blockTime = () => Math.floor(Date.now() / 1000) - 7200;
check('old transaction refused', (await post('/v1/bones', { teaser: 'Old one', body: 'old', salt: SALT, token: TOKEN, targetUsd: 100000, tx: oldTx }))[0] === 400);
blockTime = () => Math.floor(Date.now() / 1000);

// ---- secrecy ----
const [, anon1] = await call('/v1/bones/1');
check('buried text is hidden', anon1.body === null && anon1.salt === null, anon1);
const stored = await env.DB.prepare('SELECT sealed FROM bones WHERE id = 1').first();
check('database holds ciphertext only', !Buffer.from(stored.sealed, 'base64').toString().includes('0x5125'), stored);
const [, list0] = await call('/v1/bones');
check('list hides text too', list0.bones.length === 2 && list0.bones.every((a) => a.body === null), list0);
const ds = (await signIn(dev))[1].session;
const [, own] = await call('/v1/bones/1', {}, ds);
check('author reads their own bone', own.body === BODY, own);
const [, oth] = await call('/v1/bones/1', {}, rs);
check('others cannot', oth.body === null, oth);

// ---- progress and the archer ----
markets[TOKEN].marketCapUsd = 70000;
await tick(env);
const [, p1] = await call('/v1/bones/1');
check('progress follows the market cap', p1.progress === 0.5 && p1.token.mcap === 70000, p1);
markets[TOKEN].marketCapUsd = 120000;
await tick(env);
const [, p2] = await call('/v1/bones/1');
check('one check over the target does not dig up', p2.status === 'buried', p2);
markets[TOKEN].marketCapUsd = 50000;
await tick(env);
markets[TOKEN].marketCapUsd = 120000;
await tick(env);
check('a wick resets the count', (await call('/v1/bones/1'))[1].status === 'buried');
ponsDown = true;
await tick(env);
check('market outage changes nothing', (await env.DB.prepare('SELECT hits FROM bones WHERE id = 1').first()).hits === 1);
ponsDown = false;
const r = await tick(env);
const [, p3] = await call('/v1/bones/1');
check('two checks in a row dig it up', r.dug === 1 && p3.status === 'dug' && p3.dugBy === 'mcap' && p3.progress === 1, [r, p3]);
check('dug text is public without a token', p3.body === BODY && p3.salt === SALT, p3);
check('hash recomputes from the dug bone', p3.commit === await commitOf({ salt: p3.salt, token: p3.token.address, target: p3.targetUsd, openAt: p3.openAtMs, body: p3.body }), p3);
check('the other bone stays buried', (await call('/v1/bones/2'))[1].status === 'buried');

// ---- dates ----
const at = Date.now() + 10 * 60000;
const [dc, d1] = await make(dev, { teaser: 'Date only', token: null, targetUsd: 0, openAt: at, body: 'time capsule' });
check('date-only bone needs no token', dc === 201 && d1.token === null, d1);
await tick(env);
check('stays buried before the date', (await call(`/v1/bones/${d1.id}`))[1].status === 'buried');
const later = await tick(env, at + 1000);
await env.DB.prepare('UPDATE bones SET dug_at = ? WHERE dug_at > ?').bind(Date.now() - 1000, Date.now()).run();
const [, d2] = await call(`/v1/bones/${d1.id}`);
check('flies on the date', later.dug === 1 && d2.status === 'dug' && d2.dugBy === 'date' && d2.body === 'time capsule', d2);
const [, both] = await make(dev, { teaser: 'Either one', targetUsd: 500000, openAt: at, body: 'either' });
await tick(env, at + 1000);
await env.DB.prepare('UPDATE bones SET dug_at = ? WHERE dug_at > ?').bind(Date.now() - 1000, Date.now()).run();
check('date also digs up a target bone', (await call(`/v1/bones/${both.id}`))[1].dugBy === 'date');

// ---- moderation ----
check('hide needs the admin key', (await post('/v1/admin/hide', { id: 2 }, null, { 'x-admin-key': 'nope' }))[0] === 403);
await post('/v1/admin/hide', { id: 2 }, null, { 'x-admin-key': 'admin-test' });
check('hidden bone is gone', (await call('/v1/bones/2'))[0] === 404);

// ---- stats, me, lists ----
const [, st] = await call('/v1/stats');
check('stats', st.dug === 3 && st.buried === 0 && st.authors === 1 && st.buryBurn === 0, st);
const [, mine0] = await call('/v1/me', {}, ds);
check('me lists my bones', mine0.wallet === dev.address && mine0.bones.length === 3, mine0);
const [, dug] = await call(`/v1/bones?status=dug&token=${TOKEN}`);
check('filter by token', dug.bones.length === 2 && dug.bones.every((a) => a.body), dug);

// ---- MCP ----
const [, init] = await mcp('initialize', {});
check('mcp initialize', init.result.serverInfo.name === 'diggd', init);
const [, tl] = await mcp('tools/list', {});
check('mcp tools', tl.result.tools.map((t) => t.name).join() === 'list_bones,get_bone,check_token', tl);
const [, ml] = await mcp('tools/call', { name: 'list_bones', arguments: { status: 'dug' } });
check('mcp list_bones shows dug text', ml.result.content[0].text.includes('CA: 0x5125'), ml);
const [, mg] = await mcp('tools/call', { name: 'get_bone', arguments: { id: 1 } });
check('mcp get_bone', mg.result.content[0].text.includes('$DWH'), mg);
const [, mc] = await mcp('tools/call', { name: 'check_token', arguments: { token: TOKEN } });
check('mcp check_token', /by creator/.test(mc.result.content[0].text), mc);

// ---- after launch: burn to bury, holders read first ----
env.TOKEN_ADDRESS = DIGGD;
markets[TOKEN].marketCapUsd = 40000;
const noBurn = await make(dev, {});
check('burying needs a burn after launch', noBurn[0] === 400 && /burn 50,000/.test(noBurn[1].error), noBurn);
check('too small a burn', (await make(dev, {}, [burnLog(dev.address, 1000, DIGGD)]))[0] === 400);
check('someone else burning does not count', (await make(dev, {}, [burnLog(reader.address, 50000, DIGGD)]))[0] === 400);
check('another token does not count', (await make(dev, {}, [burnLog(dev.address, 50000, TOKEN)]))[0] === 400);
check('a transfer to a wallet does not count', (await make(dev, {}, [burnLog(dev.address, 50000, DIGGD, reader.address)]))[0] === 400);
const [bc, a9] = await make(dev, { teaser: 'Holders first' }, [burnLog(dev.address, 50000, DIGGD)]);
check('bury with burn', bc === 201, a9);
const checksummed = env.TOKEN_ADDRESS;
env.TOKEN_ADDRESS = checksummed.toUpperCase().replace('0X', '0x');
check('mixed-case token address still sees the burn', (await make(dev, { teaser: 'Mixed case' }, [burnLog(dev.address, 50000, DIGGD)]))[0] === 201);
env.TOKEN_ADDRESS = checksummed;
markets[TOKEN].marketCapUsd = 120000;
await tick(env); await tick(env);
const [, pub] = await call(`/v1/bones/${a9.id}`);
check('fresh reveal hidden from the public', pub.status === 'dug' && pub.holdersOnly === true && pub.body === null, pub);
balances[holder.address] = 600000;
const hs = (await signIn(holder))[1].session;
const [, hv] = await call(`/v1/bones/${a9.id}`, {}, hs);
check('holder reads it first', hv.body === BODY, hv);
const [, rv] = await call(`/v1/bones/${a9.id}`, {}, rs);
check('non-holder waits', rv.body === null, rv);
await env.DB.prepare('UPDATE bones SET dug_at = ? WHERE id = ?').bind(Date.now() - 6 * 60000, a9.id).run();
check('everyone reads it after the window', (await call(`/v1/bones/${a9.id}`))[1].body !== null);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
