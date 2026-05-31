# $GRID staking — cooldown access

Cooldown staking for the $GRID token on **Base**. Stake $GRID → earn **access
power** (staked × cooldown multiplier) → unlock CodeGrid premium tiers. No lock
term: stake grants access; exit by starting a **cooldown** (7 or 30 days — a
longer notice earns more power), then withdraw principal in full. **No yield, no
revenue share, no governance** — a utility access stake (see
[/token/policy](https://codegrid.app/token/policy)).

```
staking/
├── contracts/            Foundry — StakedGRID.sol (cooldown stake) + tests
├── services/
│   ├── verifier/         CF Worker — SIWE → read tier on Base → mint entitlement JWT
│   ├── grid-review/      CF Worker — Pro AI code review (hidden model via OpenRouter)
│   └── points/           CF Worker + D1 — seasonal usage points (non-financial)
└── .env.example          secret/config template (Infisical or .env.local)
```

The **stake UI** lives in `landing/app/token/stake`, the desktop **entitlement
layer** in `src/` + `src-tauri/src/entitlement.rs`. Both read from the contract
+ workers below.

## Architecture

```
Web (codegrid.app/token/stake)         Desktop app (Tauri)
  connect wallet → lock GRID             "Link wallet" → opens codegrid.app/link
        │                                       │ SIWE signature
        ▼                                       ▼
   StakedGRID.sol (Base) ◀─ eth_call ─  grid-verifier (CF Worker)
        ▲                                  │ mints EdDSA JWT { tier, power }
        │                                  ▼
   grid-points (CF Worker + D1)      codegrid://link?token=… → keychain
   usage × power → leaderboard       → <Gated tier> unlocks features
```

The entitlement JWT is **EdDSA-signed**; the desktop verifies it **offline**
against the bundled public key — no server round-trip after the first sign-in.

## Deploy runbook (A→Z)

> Secrets: push to **Infisical** if `.infisical.json` exists + CLI is logged in,
> otherwise `.env.local`. Never commit. See `.env.example`.

### 1. Contract

```bash
cd staking/contracts
forge test                                  # 23 tests, incl. fuzz
forge soldeer install                       # if deps missing
# testnet first
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
# mainnet (after audit)
forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
```

Then set `GRID_TOKEN_ADDRESS` in `Deploy.s.sol` is already correct; transfer
ownership to a multisig with `acceptOwnership` (Ownable2Step).

### 2. Entitlement keypair

```bash
cd staking/services/verifier
npm install
node scripts/gen-keys.mjs                    # prints PRIVATE + PUBLIC JWK
```
- PRIVATE JWK → `wrangler secret put JWT_PRIVATE_JWK` (+ Infisical backup)
- PUBLIC JWK → `wrangler.toml [vars] PUBLIC_JWK`, the points Worker's `PUBLIC_JWK`,
  and `src/lib/entitlement.ts` → `ENTITLEMENT_PUBLIC_JWK`.

### 3. Verifier Worker

```bash
cd staking/services/verifier
wrangler kv namespace create NONCES          # paste id into wrangler.toml
# set VEGRID_ADDRESS in wrangler.toml [vars] to the deployed contract
wrangler deploy
```

### 4. Points Worker

```bash
cd staking/services/points
npm install
wrangler d1 create grid-points               # paste database_id into wrangler.toml
npm run db:init:remote                        # apply schema.sql
wrangler deploy
```

### 5. Frontend

Set `landing/.env.local` (`NEXT_PUBLIC_VEGRID_ADDRESS`, `NEXT_PUBLIC_VERIFIER_URL`,
`NEXT_PUBLIC_POINTS_URL`), then deploy the site (Vercel) as usual. The
`/token/stake` and `/link` routes get a strict `frame-ancestors 'self'` CSP
(see `landing/next.config.ts`).

### 6. Desktop

Bundle the PUBLIC JWK into `src/lib/entitlement.ts`, rebuild the app. The
`Premium` tab in Settings drives the sign-in.

## Security notes

- Owner can **never** reach locked principal (`rescueToken` rejects GRID).
- `withdraw` works even when paused — exit is always open.
- Verifier holds only public-data RPC access + the JWT signing key; no funds.
- Nonces are single-use (KV) → no signature replay.
- Points never convert to tokens — status only.

## CI

`staking/**` is in `.github/workflows/release.yml` `paths-ignore`, so staking
commits do **not** trigger the signed macOS app release build.
