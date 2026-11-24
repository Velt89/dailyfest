# DailyFest — agent interface (Binance Agentic Wallet)

The primary way to use DailyFest. If you run an agent with the
**Binance Agentic Wallet (`baw`)**, you never need to open the web dApp:
your agent reads DailyFest over plain RPC and writes through your own
paired `baw` wallet, preview-first, with your confirmation in the loop.
One line a day keeps the streak alive:

> "Mint today's Daily Fest dish and claim any Feast badge I've qualified for"

- Contract: `0x01F1AE5E05A1807A0B26123c8a24B087360aC77a` (BNB Chain, chainId 56)
  — **predicted CREATE2 address; deployment pending.** The helper checks
  `eth_getCode` before every write and refuses with a "not deployed yet"
  message while the address has no code.
- Agent ID registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Skill file for agents: [SKILL.md](SKILL.md)
- Machine-readable manifest (also served by the dApp): `/agent.json`
  (`frontend/public/agent.json` in this repo)

## Install

```bash
git clone https://github.com/Velt89/dailyfest
cd dailyfest
npm install          # repo root — provides ethers v6 for the helper script
```

Prerequisites: `baw` installed, and your Agentic Wallet paired **by you** in
the Binance App with `baw --json wallet status` returning `CONNECTED`.
The helper finds `baw` on PATH, or at `~/workspace/tools/baw-cli/bin/baw`.

## Quickstart

```bash
# reads (no wallet needed for the --address / leaderboard forms)
node agent/dailyfest.js status                  # your wallet, via baw
node agent/dailyfest.js status --address 0x…    # any address, read-only
node agent/dailyfest.js leaderboard --limit 20

# writes — always preview first, execute only after YOUR explicit go-ahead
node agent/dailyfest.js preview-mint
node agent/dailyfest.js preview-badge bronze    # or: 1 | silver | gold
node agent/dailyfest.js execute <requestId>     # only when you say go
```

## The menu & badges

Dish of a UTC day = `day % 14` over a fixed menu: Rendang, Sate Ayam,
Nasi Goreng, Bakso, Martabak Manis, Ramen, Sushi, Tacos, Pizza, Burger,
Dim Sum, BBQ Ribs, Croissant, Es Krim.

Feast badges, claimable once each off your **best** streak:
Bronze (3) · Silver (7) · Gold (14).

## The flow

```
 user: "mint today's Daily Fest dish"
        │
        ▼
 agent: preview-mint ──► pre-checks (contract deployed? sender holds an
        │                Agent ID? not already minted today?)
        │                └─► refuses locally if any check fails
        ▼
        baw contract-call preview  (simulation only — nothing broadcast,
        │                          no app notification created)
        ▼
 agent shows YOU the summary: from / to / function + dish / value 0 /
        simulation verdict / risks (must be none) / allowance+authority
        changes (must be empty) / requestId + expiry
        │
        ▼
 you: "execute"  ──►  agent runs execute <requestId>
        │                 └─► baw may ask you to tap confirm in the
        │                     Binance App (PENDING_CONFIRMATION), or
        │                     broadcast under Developer Mode
        ▼
 agent reports tx hash + BscScan link and verifies the effect on-chain
 (streak counters / badgeClaimed) before calling it done
```

## Safety notes

- **Preview-first, always.** A preview is a simulation; only `execute` can
  broadcast, and only on your explicit go-ahead for that specific preview.
  Stale previews (past `expiresAt`, or minted across a UTC day boundary)
  are discarded and re-previewed.
- **Value is always 0.** The DailyFest contract has no payable functions,
  no transfers and no approvals — a correct preview always shows empty
  allowance/authority changes and no risks. You pay only BNB Chain gas.
- **Your keys never move.** Pairing and confirmations happen in your
  Binance App through `baw`'s own session. Nothing here asks for seeds,
  private keys or pairing codes, and there is no website login of any kind
  in this flow.
- Dishes and badges are **soulbound collectibles** — they cannot be
  transferred or sold, and no returns or monetary value are promised.
