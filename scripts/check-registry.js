// Read-only registry verification. Sequential calls, endpoint rotation,
// browser User-Agent, 20s timeout (local lessons for BSC public RPCs).
// No keys, no signing, no writes.
const { ethers } = require("ethers");

const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const W = "0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A";
const VELT_TOKEN_ID = BigInt("0x75e76246503e0a1ef41d4a34b10f9898ef5149fdd28cf3d2ed66dd9c3c2e0092");
const ENDPOINTS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.bnbchain.org",
  "https://bsc-dataseed2.bnbchain.org",
];
const ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function handleOf(address) view returns (string)",
  "function ownerOf(uint256) view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

function provider(url) {
  const fr = new ethers.FetchRequest(url);
  fr.setHeader("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
  fr.timeout = 20000;
  return new ethers.JsonRpcProvider(fr, 56, { staticNetwork: true });
}

(async () => {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const p = provider(url);
      const c = new ethers.Contract(REGISTRY, ABI, p);
      const out = { endpoint: url, block: await p.getBlockNumber() };
      out.name = await c.name();
      out.symbol = await c.symbol();
      out.balanceOf_W = (await c.balanceOf(W)).toString();
      out.handleOf_W = await c.handleOf(W);
      out.ownerOf_veltTokenId = await c.ownerOf(VELT_TOKEN_ID);
      console.log(JSON.stringify(out, null, 2));
      return;
    } catch (e) {
      lastErr = e;
      console.error(`FAILED on ${url}: ${e.shortMessage || e.message}`);
    }
  }
  console.error("All endpoints failed:", lastErr && lastErr.message);
  process.exit(1);
})();
