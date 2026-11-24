# Daily Fest

**A food festival for Agent ID holders** — built for the
**Binance Wallet Agent ID Hackathon** (BNB Chain, submissions close 2026-12-09 08:00 UTC).

Every UTC day has one featured dish. If you hold an Agent ID, you can free-mint
that day's dish as a soulbound NFT — one per wallet per day. Come back daily to
build a streak, collect all 14 dishes on your shelf, and earn Feast badges.
**Don't break the streak.**

## Use it through your agent (the primary interface)

Agent ID holders are, by definition, people running agents with a Binance
Agentic Wallet — so DailyFest's primary interface is not a website, it's the
user's own agent. With the DailyFest skill, an agent uses DailyFest through
the user's paired `baw` wallet: **no wallet browser, no website login, no
QR/pairing-code web flow** (pairing lives in the user's Binance App, exactly
as in Binance's official agentic-wallet skill).

- **Skill:** [agent/SKILL.md](agent/SKILL.md) — give it to your agent, then
  just say: *"Mint today's Daily Fest dish and claim any Feast badge I've
  qualified for."* One line a day; put it in your agent's daily routine and
  the streak keeps itself.
- **Helper CLI:** [agent/dailyfest.js](agent/dailyfest.js) — read commands
  (`status`, `leaderboard`) over plain RPC, plus two-phase writes
  (`preview-mint` / `preview-badge`, then `execute`). See
  [agent/README.md](agent/README.md) for the quickstart and flow diagram.
- **Manifest:** `frontend/public/agent.json`, served by the dApp at
  `/agent.json` — machine-readable contract/registry addresses, the menu,
  badge tiers, ABI + skill URLs, `baw` command templates and safety rules.
  An agent can discover and drive DailyFest from that file alone.

The write flow is preview-first, always: the agent runs
`baw contract-call preview` (a simulation — nothing broadcasts, no app
notification is created), shows the user the decoded summary (from / to /
function + dish or badge / **value 0** / risks must be none / allowance and
authority changes must be empty), and runs `execute` only on the user's
explicit go-ahead for that specific preview. Stale previews are re-previewed,
never executed. The script also refuses locally — before ever calling `baw` —
when the sender holds no Agent ID, when today's dish was already minted, when
a badge isn't earned yet or was already claimed, and while the contract is
not yet deployed.

The web dApp remains for judges, manual users, and anyone who prefers a
browser; both paths hit the same contract with the same rules.

## How the festival works

- **Dish of the day.** The menu is fixed in the contract (14 dishes). The
  dish served on a UTC day is `day % 14`, where `day = block.timestamp / 86400`
  — provably fixed in advance, no admin can change it.
- **One free mint per day.** `mintDish()` requires an Agent ID
  (`registry.balanceOf(sender) > 0`), mints today's dish as a soulbound
  ERC-721, and reverts if you already minted today. Free means free: the
  contract has no payable functions; you pay only BNB Chain gas.
- **Streaks.** Minting on consecutive UTC days increments your streak;
  skipping a day resets the *current* streak to 1 on your next mint. Your
  *best* streak and lifetime days are kept forever.
- **Feast badges.** Soulbound milestone badges, claimable once each, gated
  on your **best** streak (so a missed day never revokes a badge you've
  earned the right to claim): **Bronze at 3 · Silver at 7 · Gold at 14**.
- **The shelf.** Your collection across the menu — `hasDish` /
  `distinctDishesOf` count how many of the 14 dishes you own. The same dish
  returns every 14 days; re-minting it doesn't double-count the shelf.
- **Leaderboard.** Every first-time minter joins the on-chain `festgoers`
  list; the dApp and the agent CLI rank festgoers by current streak, then
  best streak, then lifetime days. Addresses only — DailyFest never resolves
  anyone's Agent ID name to their wallet.

### The menu

| # | Dish | # | Dish |
|---|---|---|---|
| 0 | Rendang | 7 | Tacos |
| 1 | Sate Ayam | 8 | Pizza |
| 2 | Nasi Goreng | 9 | Burger |
| 3 | Bakso | 10 | Dim Sum |
| 4 | Martabak Manis | 11 | BBQ Ribs |
| 5 | Ramen | 12 | Croissant |
| 6 | Sushi | 13 | Es Krim |

## How Agent ID is core to the flow

- **No Agent ID, no dish.** `mintDish()` checks `balanceOf > 0` against the
  SPACE ID Agent ID registry (`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`,
  BNB Chain) on every call. There is no other way in.
- **Streaks are non-transferable by construction.** An Agent ID is a
  soulbound, one-per-person ERC-721 — and every DailyFest token is soulbound
  too (all transfer and approval functions revert). You cannot buy, sell, or
  move someone else's streak, shelf, or badges.
- The frontend and the agent CLI read the connected wallet's **own** handle
  (`handleOf`) for display, and show non-holders exactly how to claim an
  Agent ID (Binance App only).

## Architecture

```
contracts/
  DailyFest.sol     — the whole product. Minimal hand-rolled soulbound
                      ERC-721, no dependencies, Solidity 0.8.24.
  MockAgentID.sol   — LOCAL TESTS ONLY stand-in registry (balanceOf + setHolder).
test/
  DailyFest.test.js — Hardhat + ethers v6, 15 tests (menu, gate, streak
                      machine, shelf, badges, soulbound, pagination, tokenURI).
scripts/
  check-registry.js   — read-only live registry verification (no keys, no writes).
  measure-gas-local.js— local gas measurements (Hardhat network only).
  prepare-deploy.js   — builds deploy-package/ and predicts the CREATE2
                        address (read-only against live BSC).
agent/              — the primary interface: SKILL.md + dailyfest.js
                      (baw preview-first writes, RPC reads) + README.
frontend/           — Vite + React + TypeScript, viem + injected wallet.
deploy-package/     — bytecode, ABI, flattened source, CREATE2 payload,
                      SUMMARY.md + DEPLOY.md for the deployment step.
```

Contract design notes:

- Dish/streak/badge state is fully on-chain; the leaderboard and shelf work
  from plain contract reads (`getFestgoers` + `streakOf` + `hasDish`) — no
  indexing service needed.
- `tokenURI` is generated on-chain as base64 JSON, with dish artwork served
  from this repo (`frontend/public/dishes/*.svg`, via jsDelivr).
- There is **no owner, no admin, no pause, no upgrade path** — and no way to
  change the registry or the menu after deployment.

## Safety compliance vs the hackathon red lines

| Red line | DailyFest |
|---|---|
| No web QR / pairing-code login for Agentic Wallet | ✅ The agent flow uses the user's already-paired `baw` session (Binance's official pattern); the web dApp uses a standard injected-wallet connect. No QR, no pairing codes, no server-side sessions. |
| No bypassing user transaction confirmation | ✅ Every write is previewed first and executed only on the user's explicit go-ahead (agent path) or confirmed in their own wallet (dApp path). No auto-signing anywhere. |
| No unauthorized / hidden asset transfers | ✅ The contract handles **no money at all**: zero payable functions, transfers and approvals revert (soulbound), never custodies funds. |
| No unlimited approvals solicited | ✅ DailyFest never asks for any token approval — approvals are disabled in the contract itself. |
| Contracts open-source with disclosed owner permissions | ✅ MIT source, to be verified on BscScan/Sourcify at deployment. There is **no owner/admin at all** — no mint-for-others, pause, freeze, tax, withdrawal, or upgrade functions exist. The registry address is `immutable`. |
| No Binance/BNB brand impersonation | ✅ Named "Daily Fest"; no Binance/BNB in the project or token name. |
| No collecting seeds / keys / secrets | ✅ Nothing is collected; pairing happens only in the user's Binance App. |
| No promising returns | ✅ No returns, yields, or income language anywhere. Dishes/badges are soulbound collectibles with no promised monetary value. (There is an ERC-721 because the dishes are collectibles — it is non-transferable by design and is not a tradable token.) |
| Agent ID not packaged as name→wallet lookup | ✅ Deliberately not implemented. The leaderboard shows addresses the users themselves minted from; names are only ever read for the connected wallet's own display. |

## Local build & test

```bash
# contracts + tests (repo root)
npm install
npx hardhat compile
npx hardhat test            # 15 tests, all passing
node scripts/check-registry.js   # read-only live registry check (optional)

# frontend
cd frontend
npm install
npm run build               # tsc + vite build must pass
npm run dev                 # local preview
```

## Deployment status

**DEPLOYED — LIVE on BNB Chain.** The contract was deployed via the
deterministic CREATE2 proxy (`0x4e59b44847b379578588920cA78FbF26c0B4956C`)
through `baw`, with salt `keccak256("velt.dailyfest.v1")`, and landed
exactly at the predicted address:

**`0x01F1AE5E05A1807A0B26123c8a24B087360aC77a`**

- Creation tx: `0x10e7eba36bb1ca86e77b158d2db8c510ff6839d029d88b48e1cea8a8fe4d88dc`
- Deployment block: `135529444`

Post-deployment verification confirmed: code present at the address,
`agentIdRegistry()` correct, `hasAgentId(W)` true. `frontend/src/config.ts`
carries `DAILYFEST_DEPLOYED = true` and `DAILYFEST_START_BLOCK = 135529444`,
and `frontend/public/agent.json` reports the deployed status. Full package:
`deploy-package/` (SUMMARY.md, DEPLOY.md).

## Hackathon submission fields (draft)

- **Project name:** Daily Fest
- **Website:** `<to fill after Vercel deployment>`
- **Contract address(es):** DailyFest — `0x01F1AE5E05A1807A0B26123c8a24B087360aC77a` (BNB Chain; deployed at the predicted CREATE2 address, creation tx `0x10e7eba36bb1ca86e77b158d2db8c510ff6839d029d88b48e1cea8a8fe4d88dc`, block 135529444)
- **Description:** Daily Fest is a food festival for Agent ID holders on BNB Chain. Every UTC day serves one dish from a fixed 14-dish menu baked into the contract; each Agent ID holder can free-mint that day's dish as a soulbound NFT (gas only, one per wallet per day). Minting on consecutive days builds an on-chain streak; Feast badges (Bronze at a 3-day best streak, Silver at 7, Gold at 14) reward consistency, and holders collect the full dish set on a public shelf with a streak leaderboard. Daily Fest is agent-native: holders can play entirely through their own agent with the Binance Agentic Wallet — one instruction a day ("Mint today's Daily Fest dish") — using a published agent skill and a machine-readable manifest, with preview-first writes and user confirmation in the Binance App. The web dApp offers the same festival for manual users and judges.
- **Agent ID usage description:** Agent ID is the entry ticket and the identity root of the festival. `mintDish()` checks the SPACE ID Agent ID registry (`balanceOf > 0`) on every mint, so only Agent ID holders can ever hold a dish, a streak, or a badge. Because Agent IDs are soulbound and one-per-person — and every DailyFest token is soulbound as well — streaks and shelves are Sybil-resistant and non-transferable by construction: a leaderboard position cannot be bought or moved. The product reads the holder's own handle for display and routes non-holders to claim an Agent ID in the Binance App; it never resolves other people's names to wallets.
- **Reward receiving address:** `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A`

## Reaching 30+ Agent ID interactors (Innovation Award threshold)

The Innovation Award requires ≥30 distinct Agent ID addresses interacting
with the contract during the submission period. The plan is built around
how Agent ID holders already behave — daily routines through their agents:

1. Launch post on **Boltbook b/alpha** (where the Agent ID holder community
   congregates), leading with the agent one-liner: install the skill, tell
   your agent "Mint today's Daily Fest dish" — no website visit needed.
2. The daily loop does the retention: a new dish every day, a streak to
   protect, badges at 3/7/14 — reasons to return that a one-shot mint
   doesn't give, each return adding transactions from distinct holders.
3. Follow-up posts as the festgoer count and the Gold-badge race develop;
   every interaction is gas-only (no funds move), keeping the ask
   friction-low and inside the safety rules.
4. Track distinct interactors honestly from `uniqueFestgoers()` and
   `DishMinted` events — no wash interactions, no mass-registration tricks
   (both are disqualifying under the campaign rules).
