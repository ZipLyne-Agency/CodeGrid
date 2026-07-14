# $GRID Staking — RETIRED

> **Status: retired / disconnected (2026-07).**
>
> CodeGrid is free and open source. There is no premium tier, no wallet link,
> and no staking gate in the desktop app or on the marketing site.
> Routes under `/token/*` and `/link` redirect home. AI extras use bring-your-
> own-key (OpenAI in Settings → Voice).
>
> The `staking/` tree (contracts + workers) is left in the repo as historical
> backend material only. It is not wired into the user-facing product.
>
> Do not run this go-live checklist against production CodeGrid.

---

_Original runbook content archived below for reference only. Do not follow it._

# (Archive) Go-Live Runbook

How to take **veGRID staking** from the feature branch to production. **Do not
use for current CodeGrid releases.**

> **Model recap (historical):** lock $GRID on Base → decaying **veGRID power**
> → premium features. That model is retired.

See `staking/README.md` for the old layout of contracts and workers.
