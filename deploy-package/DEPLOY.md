# DailyFest — Deployment Guide

**Status: PREPARATION ONLY. Nothing has been broadcast, signed, or deployed.**
All figures from the live read-only checks of 2026-11-24 ~20:40 UTC
(BSC block 135,528,325) — see SUMMARY.md. Re-check gas/balance at deploy time.

## Pre-flight summary (one line)

> BSC mainnet (chain 56) · from W `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A` · to: deterministic CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C` (contract creation via proxy) · value **0 BNB** · creates **DailyFest at `0x01F1AE5E05A1807A0B26123c8a24B087360aC77a`** · constructor arg: Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` · est. **3,116,535 gas** (recommended limit **3,739,842**) · est. cost **0.0001558 BNB**, worst case at limit 0.0001870 BNB · **no approvals, no spenders, no token transfers**.

Balance check at preparation time: W held **0.001032421 BNB** — covers the
deployment about 5× over, with room for seeding the first days of mints.

---

## The route — BAW contract-call to the CREATE2 proxy

This is the exact route that deployed AgentProof on 2026-11-25: the baw CLI
has no create command, but a contract-call to the deterministic deployment
proxy with calldata `salt ++ initCode` deploys the contract at a predictable
address. The payload is in `create2-calldata.txt`.

**Prerequisite:** `baw --json wallet status` must return `CONNECTED`
(re-pair in the Binance App if the session has lapsed — only the user can
do that part).

### 1. Preview (simulation only — broadcasts nothing, creates no app notification)

```bash
PATH="$HOME/workspace/tools/baw-cli/bin:$PATH" baw contract-call preview \
  --binanceChainId 56 \
  --from 0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A \
  --to 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --value 0 \
  --inputData "$(cat deploy-package/create2-calldata.txt)" \
  --json
```

Expected: simulation success, no risks, empty allowance/authority changes,
`requireConfirmation=false` under Developer Mode. If anything differs —
STOP and re-check; do not execute a dirty preview.

### 2. Execute (only on the user's explicit go-ahead for that preview)

```bash
PATH="$HOME/workspace/tools/baw-cli/bin:$PATH" baw contract-call execute \
  --requestId <REQUEST_ID_FROM_PREVIEW> --json
```

Expected: `BROADCASTED` + orderId (Developer Mode), or
`PENDING_CONFIRMATION` + orderId — in the latter case the confirmation
exists only now; the user taps it in the Binance App.

### 3. Verify the deployment landed at the predicted address

- The created contract must be **`0x01F1AE5E05A1807A0B26123c8a24B087360aC77a`**.
- Read-only checks: `agentIdRegistry()` == the registry, `totalMinted()` == 0,
  `hasAgentId(W)` == true, `todaysDish()` returns the dish for the current
  UTC day, runtime code present (~sizeable, creation was 12,452 bytes).

---

## Post-deploy checklist

1. **Frontend config** — in `frontend/src/config.ts`:
   - `DAILYFEST_ADDRESS` already carries the predicted address; flip
     `DAILYFEST_DEPLOYED` to `true` **only after** step 3 above verifies.
   - Set `DAILYFEST_START_BLOCK` to the deployment block (for event scans).
   - Rebuild: `cd frontend && npm run build` (must pass).
2. **Source verification:**
   - Sourcify: submit `DailyFest.flat.sol` with solc 0.8.24, optimizer 200,
     EVM paris — expect exact_match (the route that worked for AgentProof).
   - BscScan (contract page → "Verify and Publish"): Solidity (Single file),
     compiler `v0.8.24+commit.e11b9ed9`, MIT license, optimization Yes/200,
     source = `DailyFest.flat.sol`, constructor args from
     `constructor-args.txt` (without the `0x` prefix if asked for raw hex).
3. **Live sanity check** (read-only first): `hasAgentId(W)` true,
   `todaysDish()` sane; then ONE real `mintDish()` from W via the agent CLI
   preview→execute flow as the first live dish (token 0).
4. **Publish:**
   - Push the repo to GitHub: `github.com/Velt89/dailyfest`.
   - Deploy `frontend/` to Vercel (root directory `frontend`); confirm the
     live site shows Today's Dish, connects, and reads the contract; confirm
     `/agent.json` serves with the deployed address.
5. **Hackathon submission** (before 2026-12-09 08:00 UTC) — fields drafted in
   the root `README.md` → "Hackathon submission fields (draft)". File via the
   official form (Binance survey `fb26d2bd25e04329b1ba77c7b3811d23`) **after**
   30+ Agent ID addresses have interacted — the form's own eligibility text
   requires the product live with at least 30 interacting addresses during
   the period. One project per team: DailyFest is the submission candidate;
   AgentProof stays unsubmitted.
6. **Interactor drive:** Boltbook b/alpha launch post leading with the agent
   one-liner ("Mint today's Daily Fest dish and claim any Feast badge I've
   qualified for") — agent-native holders can loop daily through their own
   agents without ever opening the site.
