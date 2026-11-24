---
name: dailyfest
description: |
  Use when the user wants to take part in DailyFest — the food festival for
  Agent ID holders on BNB Chain — through their agent instead of the web
  dApp: mint today's free dish NFT, check today's dish, check their streak /
  shelf / Feast badges, claim a Feast badge (Bronze 3 / Silver 7 / Gold 14
  best streak), or view the DailyFest leaderboard. Drives the Binance
  Agentic Wallet (baw) CLI: preview-first contract calls against the
  DailyFest contract 0x01F1AE5E05A1807A0B26123c8a24B087360aC77a
  (BNB Chain, chainId 56). All values are 0 BNB; the contract has no payable
  functions, tokens are soulbound, and there are no approvals.
metadata:
  author: velt (DailyFest)
  version: '0.1.0'
  openclaw:
    requires:
      bins:
        - baw
        - node
---

# DailyFest Skill (via Binance Agentic Wallet)

DailyFest is a **food festival** for Agent ID holders: every UTC day has one
featured dish from a fixed 14-dish menu; each holder may free-mint (gas
only) that day's dish as a soulbound NFT — one per wallet per day. Minting
on consecutive days builds a streak; Feast badges (Bronze at a 3-day best
streak, Silver at 7, Gold at 14) are claimable off the wallet's **best**
streak. This skill lets the user do all of that through their agent + their
own paired Binance Agentic Wallet (`baw`) — **no website, no wallet
browser, no QR/pairing-code web login**. The flow uses the user's
already-paired `baw` session, exactly like Binance's official
agentic-wallet skill. It is designed to run as a one-line daily routine:
*"Mint today's Daily Fest dish and claim any Feast badge I've qualified
for."*

- Contract: `0x01F1AE5E05A1807A0B26123c8a24B087360aC77a` (BNB Chain, chainId 56)
  — **predicted CREATE2 address** (salt `keccak256("velt.dailyfest.v1")`).
  Before any write, check `eth_getCode` for that address: while it returns
  `0x`, the festival has not started and the helper script will refuse all
  previews with a "not deployed yet" message. Never preview or execute
  against an address with no code.
- Agent ID registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Helper script (run from the DailyFest repo root): `node agent/dailyfest.js …`
  (needs `npm install` at the repo root once, for ethers v6)
- Machine-readable manifest: served by the dApp at `/agent.json`
  (also `frontend/public/agent.json` in the repo) — contract, menu, badge
  tiers, baw command templates and safety rules, all in one file.

## Prerequisites

1. `baw` CLI installed and the user's Agentic Wallet **paired by the user in
   the Binance App** (this skill never pairs, never asks for seeds, keys,
   pairing codes or passwords).
2. `baw --json wallet status` returns `{"status": "CONNECTED"}`. If it does
   not, stop and ask the user to connect/re-pair in the Binance App first.
3. The sender must hold an Agent ID. Only holders can mint dishes; the
   script checks this on-chain (registry `balanceOf`) before previewing.

## The menu (fixed in the contract; dish of a UTC day = day % 14)

0 Rendang · 1 Sate Ayam · 2 Nasi Goreng · 3 Bakso · 4 Martabak Manis ·
5 Ramen · 6 Sushi · 7 Tacos · 8 Pizza · 9 Burger · 10 Dim Sum ·
11 BBQ Ribs · 12 Croissant · 13 Es Krim

Feast badges: tier 1 Bronze (best streak 3) · tier 2 Silver (7) ·
tier 3 Gold (14). Each badge is claimable **once**, gated on the **best**
streak — a skipped day resets the current streak on the next mint but never
revokes a badge the user has earned the right to claim.

## Commands

| User intent | Command |
|---|---|
| My DailyFest status / today's dish / my streak & shelf | `node agent/dailyfest.js status` |
| Status of a specific address (read-only) | `node agent/dailyfest.js status --address <addr>` |
| Leaderboard (addresses + streaks) | `node agent/dailyfest.js leaderboard [--limit n]` |
| Mint today's dish | `node agent/dailyfest.js preview-mint` |
| Claim a Feast badge | `node agent/dailyfest.js preview-badge <tier\|bronze\|silver\|gold>` |
| Execute an approved preview | `node agent/dailyfest.js execute <requestId>` |

The script refuses locally — before ever calling `baw` — when: the contract
is not deployed yet, the sender holds no Agent ID, today's dish was already
minted, a badge tier is invalid, the best streak is too short, or the badge
was already claimed.

## The two-phase write flow (mandatory)

Every write goes through these steps, in order, with no shortcuts:

1. **Preview.** Run the matching `preview-*` command. This calls
   `baw contract-call preview` — a simulation. It broadcasts nothing and
   creates **no** notification in the user's Binance App.
2. **Show the user the preview summary** before anything else: from (their
   wallet), to (the DailyFest contract), function + decoded arguments
   (today's dish / badge tier), **value 0**, the simulation verdict,
   `requireConfirmation`, and the risk fields. `allowanceChanges` and
   `authorityChanges` must be **empty** and `risks` must be **none** — if
   any of them is not, STOP, show the user, and do not execute.
3. **Wait for the user's explicit go-ahead** ("execute", "go", "confirm" —
   in their own words, after seeing the summary). A request to *prepare* or
   *preview* is never a go-ahead to execute. For a standing daily routine,
   the user's instruction to run the routine covers the preview step each
   day — but each day's execute still follows their standing instruction
   only if they gave one explicitly for DailyFest executes; otherwise ask.
4. **Execute.** Only then run `node agent/dailyfest.js execute <requestId>`
   with the requestId from step 1. If the preview has expired (`expiresAt`
   in the past) or anything about the call changed (e.g. the UTC day rolled
   over between preview and execute — the dish would differ), discard it
   and go back to step 1 — **never execute a stale preview**.
5. **Report and verify.** After execution, report the outcome exactly as
   returned: if `PENDING_CONFIRMATION`, tell the user a confirmation is
   waiting for their tap in the Binance App (it only exists *after*
   execute — never tell the user to tap for a mere preview). If
   `BROADCASTED`, report the tx hash + BscScan link and the on-chain
   verification the script prints (streak counters / badgeClaimed). If it
   failed or reverted, say so plainly with the reason given.

## Safety rules (non-negotiable)

- **Preview first, always.** No `execute` without a fresh, clean preview
  that the user has seen.
- **Execute only on the user's explicit go-ahead**, for that specific
  preview's requestId. One go-ahead covers one execute.
- **Value is always 0.** DailyFest moves no funds; the contract has no
  payable functions. The user pays only BNB Chain gas from their own
  wallet. Never add a value, a token approval, or any extra call.
- **Verify deployment before writing.** If `eth_getCode(contract)` is `0x`,
  stop — the festival has not started.
- **Never ask for or handle** seed phrases, private keys, pairing codes,
  passwords or session tokens. Pairing happens only in the user's Binance
  App.
- **No name→wallet lookup.** DailyFest never resolves an Agent ID handle to
  someone else's wallet. The leaderboard shows addresses and streaks only.
- **No promises.** DailyFest dishes and badges are soulbound collectibles
  with no monetary value promised or implied — never describe them as
  investments or rewards with returns.
- If `baw` reports the wallet is not CONNECTED, stop and hand the
  connection step back to the user (Binance App). Do not attempt sign-in
  flows for them.

## Example user prompts

- "Mint today's Daily Fest dish and claim any Feast badge I've qualified for."
- "What's today's Daily Fest dish?"
- "What's my Daily Fest streak? How many dishes are on my shelf?"
- "Claim my Silver Feast badge."
- "Show me the Daily Fest leaderboard."
- "Did I already mint today's dish?"
