# DailyFest — Deployment Package Summary

Generated 2026-11-24 ~20:40 UTC (2026-11-25 ~03:40 WIB), BSC block 135,528,325,
via https://bsc-rpc.publicnode.com (first endpoint succeeded; no rotation needed).

**DEPLOYED — 2026-11-25 ~03:48 WIB.** The deployment was broadcast via `baw`
through the CREATE2 proxy route described below and landed exactly at the
predicted address:

| Item | Value |
|---|---|
| **Deployed DailyFest address** | **`0x01F1AE5E05A1807A0B26123c8a24B087360aC77a`** |
| Creation tx | `0x10e7eba36bb1ca86e77b158d2db8c510ff6839d029d88b48e1cea8a8fe4d88dc` |
| Deployment block | `135529444` |

The sections below are the pre-deployment package record, kept as generated.

## Compiler settings (exact, from hardhat.config.js + build info)

| Setting | Value |
|---|---|
| Solidity | 0.8.24 (`0.8.24+commit.e11b9ed9`) |
| Optimizer | enabled, 200 runs |
| EVM version | paris (explicit in config) |
| License | MIT |

Compiled cleanly with `npx hardhat compile` ("Compiled 2 Solidity files
successfully (evm target: paris)"). **15/15 Hardhat tests pass.**

## Deployment route — CREATE2 via the deterministic proxy (baw)

Same route that deployed AgentProof: a `baw contract-call` to the
deterministic deployment proxy, whose calldata is `salt ++ initCode`.

| Item | Value |
|---|---|
| Proxy | `0x4e59b44847b379578588920cA78FbF26c0B4956C` (69 bytes of code live) |
| Salt seed | `velt.dailyfest.v1` |
| Salt | `0xe002dea71025e3079c2ba0abfdbc88fa14027c4fec91995b8aa2c467fbd57c2f` |
| **Predicted DailyFest address** | **`0x01F1AE5E05A1807A0B26123c8a24B087360aC77a`** |
| Code at predicted address (at package generation) | `0x` — empty, as expected (contract has since been deployed at this address — see status note at top) |
| eth_call simulation of the exact proxy calldata from W | returned `0x01f1ae5e…360ac77a` — **exactly the predicted address** |
| Constructor args (ABI-encoded) | `0x00000000000000000000000060b9262456de011f7d15a54cdd8c48baaa8b022f` — `constructor-args.txt` |

## Bytecode

| Item | Value |
|---|---|
| Creation bytecode | 12,452 bytes — `bytecode.txt` |
| Creation bytecode keccak256 | `0xd0bb55d0e0822f029dd4ee5097771fd01d58f5b335c5ddea72dfa4c0a2a5ce65` |
| Init code (bytecode + args) | 12,484 bytes |
| Init code keccak256 | `0xed5f9caf0cd111f6b002a59f87a7d7c225814ff1bf69fbaa454681423dd2dbf8` |
| Full proxy calldata (salt ++ initCode) | 12,516 bytes — `create2-calldata.txt` |
| Proxy calldata keccak256 | `0xfbf6f7b52b61ac502c36aa37ebb389068a00c455879baa9e4fb0612e65d79cb1` |
| ABI | `DailyFest.abi.json` |
| Flattened source | `DailyFest.flat.sol` — the contract is self-contained (interface in-file, no imports), so the flat file is the source itself |

## Live gas estimate (read-only, from W)

| Item | Value |
|---|---|
| From (W) | `0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A` |
| Gas price (eth_gasPrice) | 0.05 gwei (50,000,000 wei) |
| eth_estimateGas (proxy deployment call) | **3,116,535 gas** |
| Local Hardhat actual deploy gasUsed (cross-check) | 3,059,957 gas |
| Recommended gas limit (estimate × 1.2, rounded up) | **3,739,842** |
| Estimated deployment cost | **0.0001558 BNB** |
| Worst-case cost at recommended limit | 0.0001870 BNB |
| W balance (live) | **0.001032421 BNB — covers deployment ~5× over** |

## Local interaction gas (Hardhat, MockAgentID + DailyFest, actual receipts)

| Call | gasUsed |
|---|---|
| `mintDish` (first ever — festgoer + shelf writes) | 387,771 |
| `mintDish` (subsequent days) | 181,721 |
| `claimBadge(1)` (Bronze) | 149,506 |

## Files in this package

- `bytecode.txt` — creation bytecode (0x-prefixed hex)
- `DailyFest.abi.json` — ABI
- `constructor-args.txt` — ABI-encoded constructor argument (registry address)
- `DailyFest.flat.sol` — flattened source for BscScan/Sourcify verification
- `create2-calldata.txt` — full proxy payload (salt ++ initCode) for the baw preview/execute
- `DEPLOY.md` — pre-flight summary, the baw CREATE2 route, post-deploy checklist
- `SUMMARY.md` — this file
