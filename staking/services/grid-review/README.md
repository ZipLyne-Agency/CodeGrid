# grid-review — Pro-gated AI code review Worker

Receives a git diff + the entitlement JWT, verifies the caller is **tier ≥ Pro**
offline (same Ed25519 key as `grid-verifier`/`grid-points`), and returns a
structured review across three dimensions: **Security**, **Code Quality**,
**UX/UI**. The review model runs **server-side only** — the model identity and
the provider API key never leave this Worker; callers only ever see
"CodeGrid Review" and the findings.

```
POST /review        Authorization: Bearer <entitlement JWT>
  body:  { "diff": "<unified diff>", "dimensions"?: ["security","code","ux"] }
  200:   { "reviews": [{ dimension, label, summary, findings:[{severity,file,line,title,why,fix}] }], "truncated": bool }
  401:   unauthorized (no/invalid JWT)     403: tier_too_low
GET  /health → { ok: true }
```

## Secrets / config

- `ANTHROPIC_API_KEY` — **secret**, `wrangler secret put ANTHROPIC_API_KEY`
  (and `--env staging`). Never in `wrangler.toml [vars]`, never in the desktop app.
- `PUBLIC_JWK` — the Ed25519 **public** JWK (same value as the other workers).
  Lives in `[vars]` (non-secret); fill the empty top-level prod value at deploy.
- `MIN_TIER` (default `1`), `MAX_DIFF_CHARS` (default `120000`),
  `REVIEW_DRY_RUN` (`"1"` → canned findings, no model call).

## Local test (no provider key, no chain)

```bash
npm install
node scripts/mint-test-jwt.mjs 1        # prints a PUBLIC_JWK line + a tier-1 token
# put the printed PUBLIC_JWK line into .dev.vars, plus:
echo 'REVIEW_DRY_RUN=1' >> .dev.vars
npm run dev                              # wrangler dev on :8787

# 401 without a token:
curl -s -X POST localhost:8787/review -H 'content-type: application/json' -d '{"diff":"x"}'
# 200 with the token (dry-run findings):
curl -s -X POST localhost:8787/review \
  -H "Authorization: Bearer <TOKEN>" -H 'content-type: application/json' \
  -d '{"diff":"--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new"}'
```

Point the desktop at the local worker by setting the `GRID_REVIEW_URL` env var
(or the `grid_review_url` setting) to `http://127.0.0.1:8787`.

## Deploy

```bash
wrangler secret put ANTHROPIC_API_KEY --env staging
# set PUBLIC_JWK in [env.staging.vars] (already the shared staging key)
npm run deploy -- --env staging          # grid-review-staging
# prod: fill top-level [vars] PUBLIC_JWK, then:
wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

`staking/**` is in `release.yml` `paths-ignore`, so this Worker never triggers
the signed macOS app build.
