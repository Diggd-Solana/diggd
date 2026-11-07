// Robinhood Chain helpers: JSON-RPC with retries, Pons market data, signature recovery and burn logs.
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

const PONS = 'https://ponsfamily.com/api/launches';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BURN_TO = new Set(['0x000000000000000000000000000000000000dead', '0x0000000000000000000000000000000000000000']);

export const isAddress = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
export const isTx = (s) => typeof s === 'string' && /^0x[0-9a-f]{64}$/.test(s);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// the address that made a personal_sign signature
export function recoverSigner(message, signature) {
  const raw = signature.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{130}$/.test(raw)) throw new Error('bad signature');
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const v = parseInt(raw.slice(128), 16);
  const sig = secp256k1.Signature.fromCompact(raw.slice(0, 128)).addRecoveryBit(v >= 27 ? v - 27 : v);
  const pub = sig.recoverPublicKey(keccak_256(new Uint8Array([...prefix, ...body]))).toRawBytes(false);
  return '0x' + hex(keccak_256(pub.slice(1)).slice(-20));
}

export async function rpc(env, method, params) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(env.RH_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise((res) => setTimeout(res, 400 * 2 ** attempt)); continue; }
    const j = await r.json().catch(() => ({}));
    if (j.error) throw new Error(j.error.message || 'rpc error');
    if (!r.ok) { const e = new Error('Robinhood Chain RPC is busy, try again in a moment'); e.status = 503; throw e; }
    return j.result;
  }
}

// One Pons launch, or null if Pons does not know the token. Throws when Pons is unavailable.
export async function ponsToken(address) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${PONS}/${address}`, { headers: { accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); continue; }
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new Error(`market data ${res.status}`);
    const j = await res.json();
    return j?.address ? j : null;
  }
  throw new Error('market data busy');
}

// raw amount of `token` that `wallet` sent to the burn address in a receipt
export function burnedIn(receipt, token, wallet) {
  let raw = 0n;
  for (const l of receipt.logs || []) {
    if (l.address?.toLowerCase() !== token || l.topics?.[0] !== TRANSFER || l.topics.length !== 3) continue;
    if ('0x' + l.topics[1].slice(26).toLowerCase() !== wallet) continue;
    if (BURN_TO.has('0x' + l.topics[2].slice(26).toLowerCase())) raw += BigInt(l.data);
  }
  return raw;
}
