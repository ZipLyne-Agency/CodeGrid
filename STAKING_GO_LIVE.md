# $GRID Staking — Go-Live Runbook

How to take **veGRID staking** from the feature branch to production. The full
implementation lives on branch **`feat/grid-staking`** (not yet merged); detailed
commands are in `staking/README.md` on that branch. This file is the
checklist for flipping it live.

> **Model recap:** lock $GRID on Base → decaying **veGRID power** → premium
> **tiers** (Pro / Team / Founder). It is a **utility access lock**: no yield, no
> revenue share, no governance, principal always returned at unlock. Keep that
> framing in all copy — it's what keeps it out of securities territory.

## Status as of this writing

- ✅ Built and **tested end-to-end on Base Sepolia + staging Cloudflare**.
- Contract `VeGRID.sol`: 23 Foundry tests (incl. fuzz) pass; on-chain lock /
  tier / withdraw verified on Sepolia.
- Verifier + points Workers: 14/14 headless E2E checks pass (SIWE → JWT →
  offline verify → points; nonce-replay + tampered-JWT rejection).
- Stake UI (`/token/stake`) + desktop entitlement layer build and render.
- **NOT done:** contract audit; no real premium feature is gated yet
  (`<Gated>` exists but wraps nothing); desktop deep-link only tested via
  staging; production keys/secrets not generated.

## Pre-launch decisions (do these first)

1. **Audit** `VeGRID.sol`. Do not put real $GRID near an unaudited lock.
2. **Tier thresholds** — confirm the power cutoffs (default 10k / 50k / 250k)
   in `script/Deploy.s.sol` and `landing/lib/vegrid.ts` (`TIERS`).
3. **Owner = multisig.** Deploy from a throwaway key, then `transferOwnership`
   to a Safe and `acceptOwnership` (contract is `Ownable2Step`).
4. **Which features are premium** — decide the Pro / Team / Founder feature map.
   Nothing unlocks until features are wrapped in `<Gated tier={n}>`.
5. **RPC** — provision a dedicated Base RPC (Alchemy/own node). The public RPC
   used in staging has stale-read issues; not acceptable for production.

## Go-live steps (in order)

### 1. Deploy the contract (Base mainnet)
- From `staking/contracts`, set prod env (real `GRID_TOKEN_ADDRESS`
  `0x6B456E66524aEC1792013eF9DFE87e3F84311ba3`, `VEGRID_OWNER`, `PRIVATE_KEY`,
  `BASESCAN_API_KEY`) — secrets in **Infisical**, never committed.
- `forge script script/Deploy.s.sol --rpc-url base --broadcast --verify`
- Record the VeGRID address. `transferOwnership` → multisig → `acceptOwnership`.

### 2. Production entitlement keypair
- `node scripts/gen-keys.mjs` (in `staking/services/verifier`) — a **fresh**
  Ed25519 keypair (do NOT reuse the staging/testnet key).
- PRIVATE JWK → `wrangler secret put JWT_PRIVATE_JWK` (+ Infisical backup).
- PUBLIC JWK → both Workers' prod `PUBLIC_JWK` **and** the desktop app's
  `src/lib/entitlement.ts` → `ENTITLEMENT_PUBLIC_JWK`.

### 3. Production Workers (Cloudflare)
- Create **prod** resources: `wrangler kv namespace create grid-nonces`,
  `wrangler d1 create grid-points`; paste ids into the top-level `wrangler.toml`
  of each service.
- Set prod `VEGRID_ADDRESS` (mainnet), `GRID_CHAIN_ID=8453`, prod `BASE_RPC_URL`.
- Apply schema: `npm run db:init:remote`.
- Deploy: `wrangler deploy` (both `verifier` and `points`) → record the prod
  Worker URLs.

### 4. Frontend (Vercel)
- Set `landing/.env.local` / Vercel env:
  `NEXT_PUBLIC_GRID_CHAIN_ID=8453`, `NEXT_PUBLIC_VEGRID_ADDRESS=<mainnet>`,
  `NEXT_PUBLIC_VERIFIER_URL`, `NEXT_PUBLIC_POINTS_URL`, `NEXT_PUBLIC_BASE_RPC_URL`.
  (Leave `NEXT_PUBLIC_GRID_TOKEN_ADDRESS` unset → defaults to real $GRID.)
- Deploy the site. `/token/stake` + `/link` carry a strict `frame-ancestors
  'self'` CSP (see `landing/next.config.ts`) — verify it survived.

### 5. Desktop app
- Confirm the prod PUBLIC JWK is bundled in `src/lib/entitlement.ts`.
- `LINK_URL` in `src/lib/entitlement.ts` points at `https://codegrid.app/link`
  (prod) — correct once the site is deployed.
- Cut a signed release (the normal `main` push flow). The `codegrid://` scheme
  is already registered in `tauri.conf.json`.

### 6. Wire the gate + flip copy
- Wrap the chosen premium features in `<Gated tier={n}>`.
- Update `landing/app/docs/token` + `/token/policy` copy from "rolling out" to
  live; reaffirm the no-yield / no-return language.

## Launch verification checklist

- [ ] Re-run the headless E2E (`staking/services/verifier/scripts/e2e.mjs`)
      against the **prod** Workers + mainnet contract, `EXPECT_TIER` for a known
      staked wallet.
- [ ] Web: connect a real wallet, lock a small amount, confirm tier shows.
- [ ] Desktop: Settings → Premium → Link wallet → sign → tier unlocks; gated
      feature actually appears.
- [ ] `curl -D-` `/token/stake` → `Content-Security-Policy: frame-ancestors 'self'`.
- [ ] BaseScan shows the contract **verified** and owned by the multisig.
- [ ] Nonce replay + tampered JWT both rejected against prod.

## Safety / rollback

- Owner can **never** withdraw locked principal (`rescueToken` rejects GRID);
  `withdraw` works even when paused, so users can always exit.
- To pause new locks: `pause()` from the owner multisig (existing locks +
  withdrawals unaffected).
- Entitlement JWTs are short-lived (~24h); rotating the signing keypair
  invalidates all outstanding entitlements after expiry.
- The app is free + functional without staking — a Worker/contract outage
  degrades to "no premium," never to a broken app.

## Reference (testnet / staging — replace for prod)

| Thing | Value (Base Sepolia / staging) |
|---|---|
| VeGRID (testnet) | `0x2143D7C3758B3E67AEB5C776fd6f09a68f59438b` |
| MockGRID (testnet) | `0x00AF63344aba95AC45E6194788D66aeFdD954F3B` |
| Verifier (staging) | `https://grid-verifier-staging.zippy-host.workers.dev` |
| Points (staging) | `https://grid-points-staging.zippy-host.workers.dev` |
| Real $GRID (mainnet) | `0x6B456E66524aEC1792013eF9DFE87e3F84311ba3` |
| Branch | `feat/grid-staking` |

Tear down staging when done: delete the `*-staging` Workers, KV `grid-nonces-staging`,
and D1 `grid-points-staging` from Cloudflare.
