// Deploy-package preparation — READ-ONLY against live BSC.
// Builds the CREATE2 deployment payload for DailyFest exactly as the later
// (separately authorised) deployment will use it, predicts the contract
// address, verifies the predicted address has no code yet, and estimates
// the gas of the proxy call from W. Writes deploy-package/ files.
// NOTHING is signed or broadcast by this script.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const W = "0x0518AE367CA3612872Aa2f0897BF3B5FaFCE893A";
// Deterministic deployment proxy (0age / Arachnid-style), live on BSC.
const PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT_SEED = "velt.dailyfest.v1";
const ENDPOINTS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.bnbchain.org",
  "https://bsc-dataseed2.bnbchain.org",
];

function provider(url) {
  const fr = new ethers.FetchRequest(url);
  fr.setHeader("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
  fr.timeout = 20000;
  return new ethers.JsonRpcProvider(fr, 56, { staticNetwork: true });
}

(async () => {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "DailyFest.sol", "DailyFest.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const bytecode = artifact.bytecode; // 0x-prefixed creation bytecode
  const abi = artifact.abi;

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const argsEncoded = coder.encode(["address"], [REGISTRY]); // 0x-prefixed
  const initCode = bytecode + argsEncoded.slice(2);
  const salt = ethers.keccak256(ethers.toUtf8Bytes(SALT_SEED));
  const initCodeHash = ethers.keccak256(initCode);
  const predicted = ethers.getCreate2Address(PROXY, salt, initCodeHash);
  const calldata = salt + initCode.slice(2); // proxy payload: salt ++ initCode (0x-prefixed via salt)

  const outDir = path.join(__dirname, "..", "deploy-package");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "bytecode.txt"), bytecode + "\n");
  fs.writeFileSync(path.join(outDir, "DailyFest.abi.json"), JSON.stringify(abi, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "constructor-args.txt"), argsEncoded + "\n");
  fs.writeFileSync(path.join(outDir, "create2-calldata.txt"), calldata + "\n");
  // Flattened source: DailyFest.sol is self-contained (interface in-file,
  // no imports), so the flat file is the source itself.
  const src = fs.readFileSync(path.join(__dirname, "..", "contracts", "DailyFest.sol"), "utf8");
  fs.writeFileSync(path.join(outDir, "DailyFest.flat.sol"), src);

  // Live read-only checks with endpoint rotation.
  let lastErr;
  let live = null;
  for (const url of ENDPOINTS) {
    try {
      const p = provider(url);
      const block = await p.getBlockNumber();
      const codeAtPredicted = await p.getCode(predicted);
      const codeAtProxy = await p.getCode(PROXY);
      const gasPrice = (await p.getFeeData()).gasPrice;
      let estimate = null;
      try {
        estimate = await p.estimateGas({ from: W, to: PROXY, data: calldata, value: 0 });
      } catch (e) {
        estimate = `ESTIMATE_FAILED: ${e.shortMessage || e.message}`;
      }
      const balance = await p.getBalance(W);
      live = {
        endpoint: url,
        block,
        codeAtPredicted,
        proxyCodeBytes: (codeAtProxy.length - 2) / 2,
        gasPriceWei: gasPrice ? gasPrice.toString() : null,
        estimateGasProxyCall: estimate.toString(),
        wBalanceWei: balance.toString(),
      };
      break;
    } catch (e) {
      lastErr = e;
      console.error(`FAILED on ${url}: ${e.shortMessage || e.message}`);
    }
  }
  if (!live) {
    console.error("All endpoints failed:", lastErr && lastErr.message);
    process.exit(1);
  }

  const summary = {
    saltSeed: SALT_SEED,
    salt,
    proxy: PROXY,
    registry: REGISTRY,
    predictedAddress: predicted,
    creationBytecodeBytes: (bytecode.length - 2) / 2,
    creationBytecodeHash: ethers.keccak256(bytecode),
    initCodeBytes: (initCode.length - 2) / 2,
    initCodeHash,
    deploymentDataHash: ethers.keccak256(calldata),
    ...live,
  };
  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
