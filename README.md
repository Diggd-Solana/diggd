# DIGGD

**Buried now. Dug up at 1M.** Messages on Robinhood Chain that stay six feet under until a Pons token hits its market cap or a date arrives.

Bury the roadmap, the next CA or the confession. Everyone sees a public teaser and how deep the dig has gone. Nobody sees the text. The hash of the text and its conditions goes on-chain in the same transaction that buries it, so not a word can change.

- Site: https://diggd.fun
- API: https://diggd-rh-api.orchard-api.workers.dev
- X: https://x.com/diggd_sol

## How it works
1. **Bury.** Write a message, then pick a Pons token and a market cap, a date, or both. Your wallet sends one transaction whose data ends with `6469676764` ("diggd" in hex) and the hash. Before the $DIGGD launch it is a zero-value transaction to yourself. After the launch it is an ERC-20 transfer of 50K $DIGGD to `0x…dead` with the hash appended; the token ignores the extra bytes, so the burn and the hash share one transaction.
2. **Dig.** DIGGD checks market caps every 2 minutes through Pons. The hole goes deeper as the token climbs.
3. **Dug up.** When the target holds for two checks in a row, or the date arrives, the bone comes up by itself.
4. **Verify.** The site recomputes the hash in your browser. You can compare it with the transaction data on Blockscout.

The hash is the SHA-256 of these lines joined with newlines:
```
diggd-v1
salt
token address in lowercase (empty for none)
target in USD (0 for none)
date in milliseconds (0 for none)
message
```
The salt stays secret until the bone comes up, so short messages cannot be guessed from the hash.

## Trust model
Nobody can change a bone or backdate it: the hash and the block are on Robinhood Chain.

You do trust DIGGD to keep a bone buried. Text is encrypted with AES-GCM in the database, but the server holds the key, because it has to dig bones up by itself. It could technically read a buried bone. Do not bury anything that would hurt you if it leaked. If the service went away, buried text would be lost; the hash would stay on-chain. Phase 4 moves to encryption with no trusted key.

An on-chain seal proves when something was written, not that it is true. A **Creator** badge means the wallet that deployed the token on Pons sent the transaction. It says nothing about whether the token is safe.

## Connect an agent
MCP (Claude Code), no key needed:
```
claude mcp add --transport http diggd https://diggd-rh-api.orchard-api.workers.dev/mcp
```
Tools: `list_bones`, `get_bone`, `check_token`.

REST:
```
curl https://diggd-rh-api.orchard-api.workers.dev/v1/bones?status=dug
```

| Endpoint | |
|---|---|
| `GET /v1/bones`, `GET /v1/bones/:id` | The yard and one bone |
| `POST /v1/bones` | Bury a bone (needs the transaction hash) |
| `GET /v1/token/:address` | Name, market cap and creator of a Pons token |
| `POST /v1/auth` | Sign in with a signed wallet message |
| `GET /v1/me`, `/v1/stats` | Your wallet and bones, totals |

## $DIGGD
- Hold 500K: read every reveal the second it comes up. Everyone else waits 5 minutes.
- Burn 50K in the same transaction for each bone.
- Creator tax: 70% buy back and burn, 30% servers.

Both gates are off while `TOKEN_ADDRESS` is empty in `wrangler.toml`.

## Run your own
`worker/` is a Cloudflare Worker with a D1 database and a cron.
```
cd worker
npm install
npx wrangler d1 create diggd-rh         # paste the id into wrangler.toml
npx wrangler d1 execute diggd-rh --remote --file=schema.sql
npx wrangler secret put RH_RPC_URL      # a Robinhood Chain RPC url
npx wrangler secret put SEAL_KEY        # encrypts buried text; losing it loses every buried bone
npx wrangler secret put ADMIN_KEY       # for POST /v1/admin/hide
npx wrangler deploy
node test.mjs                           # tests, no network
node dev.mjs                            # local API with sample bones on :8802
```
`site/index.html` is one file. Set `CONFIG` at the top of its script.

The first version of DIGGD ran on Solana; it lives in this repository's history.

MIT licensed. An independent project, not affiliated with Robinhood or Pons.
