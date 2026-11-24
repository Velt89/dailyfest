# DailyFest — build notes

## Registry (verified live before coding, pattern carried from AgentProof)

- SPACE ID Agent ID registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` (BNB Chain).
  Sourcify exact_match; `balanceOf`, `handleOf`, `ownerOf`, `name`, `symbol`
  confirmed live in the AgentProof build (2026-11-25) and re-read by this
  project's tooling: `node agent/dailyfest.js status --address <W>` returned
  holder=true, handle "velt" from the live registry.
- Gate rule used everywhere: `balanceOf(address) > 0`. `handleOf` is read
  only for the connected wallet's own display.

## Build record (2026-11-25)

- Contract compiled with solc 0.8.24, optimizer 200, EVM paris
  ("Compiled 2 Solidity files successfully"). 15/15 Hardhat tests pass.
- `tokenURI` initially hit "stack too deep"; fixed by splitting the JSON
  builders per token kind and into head/tail concatenations — compiler
  settings unchanged.
- Local gas (Hardhat): deploy 3,059,957; first `mintDish` 387,771;
  later-day `mintDish` 181,721; `claimBadge(1)` 149,506.
- Deploy package: `scripts/prepare-deploy.js` — live estimate for the
  CREATE2-proxy deployment call from W: 3,116,535 gas at 0.05 gwei
  (≈0.00016 BNB). eth_call simulation of the exact proxy calldata returned
  the predicted address `0x01F1AE5E05A1807A0B26123c8a24B087360aC77a`;
  `eth_getCode` there returns `0x` (not deployed).
- Agent CLI tested live (reads + refusals only): status for W (holder,
  handle, today's dish, graceful not-deployed note), leaderboard
  (graceful), preview-mint and preview-badge refuse with the not-deployed
  message and exit 1 without calling baw. No execute was run; baw execute
  remains forbidden until deployment + a separate user go-ahead.
- Frontend: `npm run build` passes (tsc + vite). dist contains the
  "Use Daily Fest through your agent" section immediately after the Mint
  card, `/agent.json`, and all 17 dish/badge SVGs.
