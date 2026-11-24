#!/usr/bin/env node
/**
 * DailyFest — agent interface (Binance Agentic Wallet / baw).
 *
 * Lets an agent use DailyFest on BNB Chain through the user's OWN paired
 * Binance Agentic Wallet, without opening the web dApp:
 *
 *   node agent/dailyfest.js status [--address <addr>]
 *   node agent/dailyfest.js leaderboard [--limit n]
 *   node agent/dailyfest.js preview-mint [--from <addr>]
 *   node agent/dailyfest.js preview-badge <tier|bronze|silver|gold> [--from <addr>]
 *   node agent/dailyfest.js execute <requestId>
 *
 * Run from the repo root (uses the root node_modules ethers v6).
 *
 * SAFETY MODEL (see agent/SKILL.md):
 * - Reads are plain RPC calls — no wallet, no keys, no signing.
 * - Writes are ALWAYS two-phase: `preview-*` runs `baw contract-call preview`
 *   (a simulation — it broadcasts nothing and creates no app notification),
 *   and `execute` is a separate, explicit step to run ONLY after the user has
 *   seen the preview summary and said go.
 * - Value is always 0. The DailyFest contract has no payable functions, no
 *   transfers and no approvals, so allowance/authority changes in any preview
 *   MUST be empty — this script prints them and warns if they are not.
 * - The contract address is a PREDICTED CREATE2 address. Until code exists
 *   there, every write path refuses with a "not deployed yet" message and
 *   never calls baw.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ethers } = require("ethers");

// ---------------------------------------------------------------- constants

const CHAIN_ID = 56;
const DAILYFEST = "0x01F1AE5E05A1807A0B26123c8a24B087360aC77a"; // predicted CREATE2 — verify deployment before writing
const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const BSCSCAN = "https://bscscan.com";

const DISHES = [
  "Rendang", "Sate Ayam", "Nasi Goreng", "Bakso", "Martabak Manis",
  "Ramen", "Sushi", "Tacos", "Pizza", "Burger",
  "Dim Sum", "BBQ Ribs", "Croissant", "Es Krim",
];
const BADGE_TIERS = [
  { tier: 1, name: "Bronze", required: 3 },
  { tier: 2, name: "Silver", required: 7 },
  { tier: 3, name: "Gold", required: 14 },
];

const RPC_ENDPOINTS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed2.bnbchain.org",
];
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const ABI_PATH = path.join(__dirname, "..", "deploy-package", "DailyFest.abi.json");
const dailyFestAbi = JSON.parse(fs.readFileSync(ABI_PATH, "utf8"));
const iface = new ethers.Interface(dailyFestAbi);

const registryAbi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function handleOf(address account) view returns (string)",
];

// ------------------------------------------------------------------- errors

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------- RPC
// Sequential endpoint rotation: ethers v6 JsonRpcProvider with a browser
// User-Agent (BSC dataseed 403s the default UA) and a hard request timeout
// (a hung RPC otherwise stalls forever).

let _provider = null;

function makeProvider(url) {
  const req = new ethers.FetchRequest(url);
  req.setHeader("User-Agent", BROWSER_UA);
  req.timeout = 20000;
  return new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true });
}

async function provider() {
  if (_provider) return _provider;
  let lastErr;
  for (const url of RPC_ENDPOINTS) {
    const p = makeProvider(url);
    try {
      await p.getBlockNumber();
      _provider = p;
      return p;
    } catch (e) {
      lastErr = e;
    }
  }
  fail(`all BSC RPC endpoints failed (last error: ${lastErr && lastErr.message})`);
}

async function read(contractAddr, abi, fn, args = []) {
  const p = await provider();
  const c = new ethers.Contract(contractAddr, abi, p);
  try {
    return await c[fn](...args);
  } catch (e) {
    // Rotate once on transport-level failure, then retry on the next endpoint.
    _provider = null;
    const p2 = await provider();
    const c2 = new ethers.Contract(contractAddr, abi, p2);
    return await c2[fn](...args);
  }
}

const dfRead = (fn, args) => read(DAILYFEST, dailyFestAbi, fn, args);
const regRead = (fn, args) => read(REGISTRY, registryAbi, fn, args);

let _deployed = null;
async function isDeployed() {
  if (_deployed !== null) return _deployed;
  const p = await provider();
  _deployed = (await p.getCode(DAILYFEST)) !== "0x";
  return _deployed;
}

function notDeployedMessage() {
  return (
    `the DailyFest contract is not deployed yet — predicted address ${DAILYFEST} currently ` +
    `has no code on-chain. No baw preview was called. Deployment is a separate, user-approved step.`
  );
}

// ---------------------------------------------------------------------- baw

function bawBin() {
  const probe = spawnSync("baw", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status !== null) return "baw";
  const abs = path.join(os.homedir(), "workspace/tools/baw-cli/bin/baw");
  if (fs.existsSync(abs)) return abs;
  fail("baw CLI not found on PATH or at ~/workspace/tools/baw-cli/bin/baw — install the Binance Agentic Wallet CLI first.");
}

function runBaw(args) {
  const bin = bawBin();
  const env = { ...process.env };
  env.PATH = `${path.join(os.homedir(), "workspace/tools/baw-cli/bin")}:${env.PATH || ""}`;
  const res = spawnSync(bin, args, { encoding: "utf8", env, timeout: 120000 });
  if (res.error) fail(`baw invocation failed: ${res.error.message}`);
  const out = (res.stdout || "").trim();
  try {
    return JSON.parse(out);
  } catch {
    fail(`baw returned non-JSON output for \`${args.join(" ")}\`:\n${out}\n${res.stderr || ""}`);
  }
}

function bawWalletStatus() {
  const j = runBaw(["wallet", "status", "--json"]);
  if (j && j.success && j.data) return j.data.status || "UNKNOWN";
  return "UNKNOWN";
}

/** Best-effort: pull the EVM (chain 56) address out of `baw wallet address`. */
function bawWalletAddress() {
  const j = runBaw(["wallet", "address", "--json"]);
  if (!j || !j.success) return null;
  const hits = [];
  (function walk(node, keyHint) {
    if (typeof node === "string") {
      if (/^0x[0-9a-fA-F]{40}$/.test(node)) hits.push({ addr: node, hint: keyHint || "" });
    } else if (Array.isArray(node)) {
      node.forEach((v) => walk(v, keyHint));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  })(j.data, "");
  if (!hits.length) return null;
  const pref = hits.find((h) => /evm|bsc|bnb|56/i.test(h.hint));
  return (pref || hits[0]).addr;
}

/**
 * Resolve the sender for previews: explicit --from, then the paired baw
 * wallet's own address, then $DAILYFEST_WALLET. Never invents an address.
 */
function resolveSender(flagFrom) {
  if (flagFrom) {
    if (!ethers.isAddress(flagFrom)) fail(`--from is not a valid address: ${flagFrom}`);
    return ethers.getAddress(flagFrom);
  }
  const st = bawWalletStatus();
  if (st === "CONNECTED") {
    const a = bawWalletAddress();
    if (a) return ethers.getAddress(a);
    fail("baw is CONNECTED but `baw wallet address` returned no EVM address.");
  }
  if (process.env.DAILYFEST_WALLET && ethers.isAddress(process.env.DAILYFEST_WALLET)) {
    return ethers.getAddress(process.env.DAILYFEST_WALLET);
  }
  fail(
    `baw wallet status is ${st} (not CONNECTED) — previews need the user's paired, connected ` +
      `Agentic Wallet. Ask the user to re-pair/connect in the Binance App, or pass --from <address> ` +
      `for a read-only sender override (baw will still refuse to preview while disconnected).`
  );
}

// ------------------------------------------------------------------ helpers

/** Holder status straight from the registry — works before deployment. */
async function holderInfo(addr) {
  const bal = await regRead("balanceOf", [addr]);
  const holder = bal > 0n;
  let handle = null;
  if (holder) {
    try {
      handle = await regRead("handleOf", [addr]);
    } catch {
      handle = null;
    }
  }
  return { holder, handle };
}

function todaysDishLocal() {
  const day = Math.floor(Date.now() / 1000 / 86400);
  return { day, index: day % 14, name: DISHES[day % 14] };
}

function parseTier(input) {
  if (input === undefined) fail("tier is required (1, 2, 3 or bronze/silver/gold).");
  const s = String(input).trim().toLowerCase();
  if (/^[123]$/.test(s)) return BADGE_TIERS[Number(s) - 1];
  const hit = BADGE_TIERS.find((t) => t.name.toLowerCase() === s);
  if (hit) return hit;
  fail(`unknown tier "${input}". Use 1/2/3 or bronze/silver/gold.`);
}

function takeFromFlag(argv) {
  const fi = argv.indexOf("--from");
  if (fi < 0) return { from: null, rest: argv };
  const from = argv[fi + 1];
  return { from, rest: argv.filter((_, i) => i !== fi && i !== fi + 1) };
}

// ------------------------------------------------------------------ preview

function runPreview({ from, calldata, decoded }) {
  const args = [
    "contract-call", "preview",
    "--binanceChainId", String(CHAIN_ID),
    "--from", from,
    "--to", DAILYFEST,
    "--value", "0",
    "--inputData", calldata,
    "--json",
  ];
  const j = runBaw(args);
  console.log("— Decoded call ————————————————————————————————");
  for (const [k, v] of Object.entries(decoded)) console.log(`  ${k}: ${v}`);
  console.log(`  value: 0 (always)`);
  console.log("— baw preview verdict ———————————————————————————");
  if (!j.success) {
    console.log(JSON.stringify(j, null, 2));
    fail("baw preview did not succeed — nothing to execute. Show the user this error.");
  }
  const d = j.data || {};
  const sim = d.simulationResult || {};
  const risks = d.risks || {};
  const riskCount = (risks.riskDetails || []).length + (risks.riskBehaviors || []).length;
  const allowance = sim.allowanceChanges || [];
  const authority = sim.authorityChanges || [];
  console.log(`  requestId:          ${d.requestId}`);
  console.log(`  expiresAt:          ${d.expiresAt ? new Date(d.expiresAt).toISOString() : "?"} (${d.expiresAt})`);
  console.log(`  simulationCode:     ${sim.simulationCode}`);
  console.log(`  simulationError:    ${sim.simulationErrorDetail || "none"}`);
  console.log(`  balanceChanges:     ${JSON.stringify(sim.balanceChanges || [])}`);
  console.log(`  allowanceChanges:   ${JSON.stringify(allowance)}${allowance.length ? "  <-- WARNING: expected EMPTY" : ""}`);
  console.log(`  authorityChanges:   ${JSON.stringify(authority)}${authority.length ? "  <-- WARNING: expected EMPTY" : ""}`);
  console.log(`  risks:              ${riskCount === 0 ? "none" : JSON.stringify(risks)}`);
  console.log(`  requireConfirmation:${d.requireConfirmation}`);
  console.log("——————————————————————————————————————————————————");
  console.log(
    "PREVIEW ONLY — nothing was broadcast and no app notification was created.\n" +
      "Show this summary to the user. Execute ONLY on their explicit go-ahead:\n" +
      `  node agent/dailyfest.js execute ${d.requestId}`
  );
  return d;
}

// ----------------------------------------------------------------- commands

async function cmdStatus(argv) {
  let addr = null;
  const ai = argv.indexOf("--address");
  if (ai >= 0) addr = argv[ai + 1];
  let bawStatus = null;
  try {
    bawStatus = bawWalletStatus();
  } catch {
    bawStatus = "UNAVAILABLE";
  }
  if (!addr) {
    if (bawStatus !== "CONNECTED") {
      console.log(`baw wallet status: ${bawStatus}`);
      fail("no --address given and the baw wallet is not CONNECTED, so no wallet address can be determined. Re-pair/connect in the Binance App, or pass --address <addr> for a read-only status.");
    }
    addr = bawWalletAddress();
    if (!addr) fail("baw is CONNECTED but returned no EVM address.");
  }
  addr = ethers.getAddress(addr);
  const { holder, handle } = await holderInfo(addr);
  const dish = todaysDishLocal();
  console.log(`address:            ${addr}`);
  console.log(`baw wallet status:  ${bawStatus}`);
  console.log(`Agent ID holder:    ${holder}${handle ? ` (handle: ${handle}.ai)` : ""}`);
  console.log(`today's dish:       ${dish.name} (festival day ${dish.day}, dish ${dish.index + 1} of 14)`);

  if (!(await isDeployed())) {
    console.log(`DailyFest contract: NOT DEPLOYED YET — predicted address ${DAILYFEST} has no code on-chain.`);
    console.log("Holder status above is live from the Agent ID registry; streak/shelf reads and previews activate after deployment.");
    return;
  }

  const [current, best, lifetime] = await dfRead("streakOf", [addr]);
  const canMint = await dfRead("canMintToday", [addr]);
  const distinct = await dfRead("distinctDishesOf", [addr]);
  const collected = [];
  for (let i = 0; i < DISHES.length; i++) {
    if (await dfRead("hasDish", [addr, i])) collected.push(DISHES[i]);
  }
  const badgeBits = [];
  for (const t of BADGE_TIERS) {
    const claimed = await dfRead("badgeClaimed", [addr, t.tier]);
    badgeBits.push(`${t.name}:${claimed ? "claimed" : best >= BigInt(t.required) ? "claimable" : `${best}/${t.required}`}`);
  }
  console.log(`can mint today:     ${canMint}`);
  console.log(`streak:             current=${current} best=${best} lifetime days=${lifetime}`);
  console.log(`shelf:              ${distinct} of 14 dishes${collected.length ? ` (${collected.join(", ")})` : ""}`);
  console.log(`feast badges:       ${badgeBits.join(" · ")}`);
}

async function cmdLeaderboard(argv) {
  let limit = 20;
  const li = argv.indexOf("--limit");
  if (li >= 0) limit = Math.max(1, parseInt(argv[li + 1], 10) || 20);
  if (!(await isDeployed())) {
    console.log(`DailyFest contract: NOT DEPLOYED YET — predicted address ${DAILYFEST} has no code on-chain.`);
    console.log("leaderboard: no festgoers yet (the festival has not started).");
    return;
  }
  const addrs = await dfRead("getFestgoers", [0n, 100n]);
  console.log(`festgoers: ${addrs.length}`);
  const rows = [];
  for (const a of addrs) {
    const [current, best, lifetime] = await dfRead("streakOf", [a]);
    rows.push({ a, current, best, lifetime });
  }
  rows.sort((x, y) =>
    y.current !== x.current
      ? y.current > x.current
        ? 1
        : -1
      : y.best !== x.best
        ? y.best > x.best
          ? 1
          : -1
        : y.lifetime > x.lifetime
          ? 1
          : y.lifetime < x.lifetime
            ? -1
            : 0
  );
  rows.slice(0, limit).forEach((r, i) => {
    console.log(`#${i + 1}  ${r.a}  streak=${r.current} best=${r.best} days=${r.lifetime}`);
  });
  console.log("(addresses only — DailyFest never resolves Agent ID names to wallets)");
}

async function cmdPreviewMint(argv) {
  const { from: flagFrom } = takeFromFlag(argv);
  // Deployment gate first: this refusal must fire even if the wallet is offline.
  if (!(await isDeployed())) fail(`refusing to preview: ${notDeployedMessage()}`);

  const from = resolveSender(flagFrom);
  const sender = await holderInfo(from);
  if (!sender.holder) {
    fail(`refusing to preview: sender ${from} does not hold an Agent ID — mintDish would revert on-chain. No baw preview was called.`);
  }
  const canMint = await dfRead("canMintToday", [from]);
  if (!canMint) {
    fail(`refusing to preview: ${from} has already minted today's dish — mintDish would revert ("Already minted today"). No baw preview was called.`);
  }
  const [idx, name, day] = await dfRead("todaysDish", []);
  const calldata = iface.encodeFunctionData("mintDish", []);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${DAILYFEST} (DailyFest)`,
      from,
      function: "mintDish()",
      dish: `${name} (dish ${Number(idx) + 1} of 14)`,
      day: day.toString(),
    },
  });
}

async function cmdPreviewBadge(argv) {
  const { from: flagFrom, rest } = takeFromFlag(argv);
  const tier = parseTier(rest[0]);
  if (!(await isDeployed())) fail(`refusing to preview: ${notDeployedMessage()}`);

  const from = resolveSender(flagFrom);
  const [, best] = await dfRead("streakOf", [from]);
  if (best < BigInt(tier.required)) {
    fail(
      `refusing to preview: best streak of ${from} is ${best}, but the ${tier.name} Feast Badge ` +
        `requires ${tier.required} — claimBadge would revert on-chain. No baw preview was called.`
    );
  }
  const claimed = await dfRead("badgeClaimed", [from, tier.tier]);
  if (claimed) {
    fail(`refusing to preview: ${from} has already claimed the ${tier.name} Feast Badge. No baw preview was called.`);
  }
  const calldata = iface.encodeFunctionData("claimBadge", [tier.tier]);
  runPreview({
    from,
    calldata,
    decoded: {
      contract: `${DAILYFEST} (DailyFest)`,
      from,
      function: "claimBadge(uint8)",
      tier: `${tier.tier} (${tier.name} Feast Badge, requires best streak ${tier.required})`,
      bestStreak: best.toString(),
    },
  });
}

/**
 * Execute a previously previewed request. Fully implemented, but ONLY to be
 * run on the user's explicit go-ahead after they have seen the preview
 * summary (see agent/SKILL.md). After broadcast it polls the receipt and
 * verifies the on-chain effect of the exact function that was called.
 */
async function cmdExecute(argv) {
  const requestId = argv[0];
  if (!requestId) fail("usage: execute <requestId>");
  const j = runBaw(["contract-call", "execute", "--requestId", requestId, "--json"]);
  console.log(JSON.stringify(j, null, 2));
  if (!j.success) fail("baw execute did not succeed.");
  const d = j.data || {};
  console.log(`orderId: ${d.orderId || "?"}`);
  console.log(`status:  ${d.status || "?"}`);
  if (d.status === "PENDING_CONFIRMATION") {
    console.log(
      "Waiting for the user to confirm in the Binance App. Once they tap confirm, " +
        "re-check the transaction in the app or on BscScan — no tx hash exists yet."
    );
    return;
  }
  const txHash = d.txHash;
  if (!txHash) {
    console.log("No tx hash returned yet — the order may still be processing. Check the Binance App / BscScan shortly.");
    return;
  }
  console.log(`txHash:  ${txHash}`);
  console.log(`BscScan: ${BSCSCAN}/tx/${txHash}`);

  const p = await provider();
  let rcpt = null;
  for (let i = 0; i < 30 && !rcpt; i++) {
    rcpt = await p.getTransactionReceipt(txHash);
    if (!rcpt) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!rcpt) fail("tx not mined within ~90s — check BscScan for its final status.");
  console.log(`mined:   block ${rcpt.blockNumber}, status ${rcpt.status === 1 ? "SUCCESS" : "FAILED"}, gasUsed ${rcpt.gasUsed}`);
  if (rcpt.status !== 1) fail("transaction reverted on-chain.");

  // Verify the effect of the exact call that was broadcast.
  const tx = await p.getTransaction(txHash);
  const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
  if (parsed) {
    if (parsed.name === "mintDish") {
      const total = await dfRead("totalMinted", []);
      const [current, best, lifetime] = await dfRead("streakOf", [tx.from]);
      const [, , day] = await dfRead("todaysDish", []);
      console.log(
        `verified: totalMinted=${total}; ${tx.from} streak current=${current} best=${best} lifetime days=${lifetime} (festival day ${day})`
      );
    } else if (parsed.name === "claimBadge") {
      const tier = Number(parsed.args[0]);
      const claimed = await dfRead("badgeClaimed", [tx.from, tier]);
      console.log(`verified: badgeClaimed(${tx.from}, ${tier}) = ${claimed}`);
    }
  }
}

// --------------------------------------------------------------------- main

const HELP = `DailyFest agent interface (baw) — usage:
  node agent/dailyfest.js status [--address <addr>]
  node agent/dailyfest.js leaderboard [--limit n]
  node agent/dailyfest.js preview-mint [--from <addr>]
  node agent/dailyfest.js preview-badge <tier|bronze|silver|gold> [--from <addr>]
  node agent/dailyfest.js execute <requestId>          (ONLY on the user's explicit go-ahead)

Menu: dish of the day = DISHES[utcDay % 14] — ${DISHES.join(" · ")}
Badges: ${BADGE_TIERS.map((t) => `${t.tier}=${t.name} (best streak ${t.required})`).join(" · ")}
Contract: ${DAILYFEST} (BNB Chain, chainId 56) — PREDICTED CREATE2 address; check deployment before writing.`;

(async () => {
  const [cmd, ...argv] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "status": await cmdStatus(argv); break;
      case "leaderboard": await cmdLeaderboard(argv); break;
      case "preview-mint": await cmdPreviewMint(argv); break;
      case "preview-badge": await cmdPreviewBadge(argv); break;
      case "execute": await cmdExecute(argv); break;
      case undefined:
      case "help":
      case "--help":
        console.log(HELP);
        break;
      default:
        fail(`unknown command "${cmd}".\n${HELP}`);
    }
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
