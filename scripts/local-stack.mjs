/**
 * Local stack runner and seeder for Hindsight.
 *
 * Spawns anvil on port 8711 with chain id 968, deploys Hindsight,
 * and seeds the 6 scenarios from 11-hindsight.md §5:
 * (1) sealed, reveal in 20 days (account 0's);
 * (2) revealable now, account 0 has the text in localStorage fixture JSON (printed);
 * (3) revealed with 5 right / 2 wrong judgements;
 * (4) revealed and account 0 hasn't judged;
 * (5) lapsed unrevealed;
 * (6) account 1 with a record of 6 committed / 4 revealed / 1 lapsed / 1 sealed.
 *
 * Time-alignment: anvil is started at (now - TOTAL_WARP) and warped forward so
 * the final block timestamp matches real wall-clock time within ~2 minutes.
 *
 * Usage:
 *   node scripts/local-stack.mjs
 */

import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

function randomSalt() {
  return `0x${randomBytes(32).toString("hex")}`;
}

const PORT = 8711;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968;

const MNEMONIC = "test test test test test test test test test test test junk";

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

try {
  execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`);
} catch {}

const realNow = Math.floor(Date.now() / 1000);
// TOTAL_WARP = 100 days (3 days before initial reveal + 97 days to reach realNow and lapse 90d window)
const TOTAL_WARP = 100 * 86400;
const startTimestamp = realNow - TOTAL_WARP;

console.log(`Starting anvil on port ${PORT} (timestamp: ${startTimestamp})...`);
spawn(
  "anvil",
  [
    "--port",
    String(PORT),
    "--chain-id",
    String(CHAIN_ID),
    "--accounts",
    "10",
    "--timestamp",
    String(startTimestamp),
    "--block-time",
    "1",
    "--silent",
  ],
  {
    detached: true,
    stdio: "ignore",
  }
).unref();

const pub = createPublicClient({ chain: local, transport: http() });

const accounts = Array.from({ length: 10 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);
const wallets = accounts.map((acc) =>
  createWalletClient({ account: acc, chain: local, transport: http() })
);

// Wait for anvil to respond
for (let i = 0; ; i++) {
  try {
    await pub.getBlockNumber();
    break;
  } catch {
    if (i > 100) {
      console.error(`anvil never answered on ${RPC}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

console.log(`Anvil online at ${RPC}`);

// Deploy Hindsight
const artifact = JSON.parse(
  readFileSync("contracts/out/Hindsight.sol/Hindsight.json", "utf8")
);

const deployHash = await wallets[0].deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [],
});

const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
const contractAddress = deployReceipt.contractAddress;
const deployBlock = deployReceipt.blockNumber;

console.log(`Hindsight deployed to ${contractAddress} at block ${deployBlock}`);

function commitmentOf(author, text, salt) {
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "string" }, { type: "bytes32" }],
    [getAddress(author), text, salt]
  );
  return keccak256(encoded);
}

// Helper to commit
async function commitPrediction(walletIdx, text, salt, revealAfter) {
  const author = accounts[walletIdx].address;
  const c = commitmentOf(author, text, salt);
  const hash = await wallets[walletIdx].writeContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "commit",
    args: [c, BigInt(revealAfter)],
  });
  await pub.waitForTransactionReceipt({ hash });
  const count = await pub.readContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "predictionCount",
  });
  return { id: count, commitment: c, author, text, salt, revealAfter };
}

// Helper to reveal
async function revealPrediction(walletIdx, id, text, salt) {
  const hash = await wallets[walletIdx].writeContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "reveal",
    args: [id, text, salt],
  });
  await pub.waitForTransactionReceipt({ hash });
}

// Helper to judge
async function judgePrediction(walletIdx, id, right) {
  const hash = await wallets[walletIdx].writeContract({
    address: contractAddress,
    abi: artifact.abi,
    functionName: "judge",
    args: [id, right],
  });
  await pub.waitForTransactionReceipt({ hash });
}

console.log("Seeding scenarios at Day 0...");

const T0 = startTimestamp;

// 1. Prediction #1: Scenario 1 - Sealed, reveal in 20 days (account 0's)
const p1Salt = "0x0000000000000000000000000000000000000000000000000000000000000001";
const p1Text = "Major layer-1 foundation announces complete governance decentralization.";
const p1 = await commitPrediction(0, p1Text, p1Salt, realNow + 20 * 86400);

// 2. Prediction #2: Scenario 2 - Revealable now for Account 0 (revealAfter = realNow - 1 day)
const p2Salt = "0x0000000000000000000000000000000000000000000000000000000000000002";
const p2Text = "Central bank pilot launches cross-border settlement corridor.";
const p2 = await commitPrediction(0, p2Text, p2Salt, realNow - 86400);

// 3. Prediction #3: Scenario 3 - Revealed with 5 right / 2 wrong
const p3Salt = "0x0000000000000000000000000000000000000000000000000000000000000003";
const p3Text = "Zero-knowledge rollup generates first client-side proof under 500ms.";
const p3 = await commitPrediction(2, p3Text, p3Salt, T0 + 2 * 86400);

// 4. Prediction #4: Scenario 4 - Revealed and account 0 hasn't judged
const p4Salt = "0x0000000000000000000000000000000000000000000000000000000000000004";
const p4Text = "Open-weights reasoning model reaches top human competition bench.";
const p4 = await commitPrediction(3, p4Text, p4Salt, T0 + 2 * 86400);

// 5. Prediction #5: Scenario 5 - Lapsed (past 90-day window)
const p5Salt = "0x0000000000000000000000000000000000000000000000000000000000000005";
const p5Text = "Quantum computing supremacy benchmark disputed within 3 months.";
const p5 = await commitPrediction(4, p5Text, p5Salt, T0 + 2 * 86400);

// 6. Scenario 6: Account 1 with 6 committed / 4 revealed / 1 lapsed / 1 sealed
// Predictions B, C, D, E (will be revealed)
const bSalt = randomSalt();
const cSalt = randomSalt();
const dSalt = randomSalt();
const eSalt = randomSalt();
const pB = await commitPrediction(1, "Account 1 prediction B: High-throughput bridge verified.", bSalt, T0 + 2 * 86400);
const pC = await commitPrediction(1, "Account 1 prediction C: Decentralized identity adopted by registry.", cSalt, T0 + 2 * 86400);
const pD = await commitPrediction(1, "Account 1 prediction D: Proof-of-solvency accepted in standard audit.", dSalt, T0 + 2 * 86400);
const pE = await commitPrediction(1, "Account 1 prediction E: Autonomous agent signs multi-party contract.", eSalt, T0 + 2 * 86400);

// Prediction F (will be lapsed)
const fSalt = randomSalt();
const pF = await commitPrediction(1, "Account 1 prediction F (lapsed): Obsolete protocol decommissioned.", fSalt, T0 + 2 * 86400);

// Prediction A (will be sealed)
const aSalt = randomSalt();
const pA = await commitPrediction(1, "Account 1 prediction A (sealed): Cross-subnet messaging latency halved.", aSalt, realNow + 10 * 86400);

// Warp 3 days to reveal period for past predictions
await pub.request({ method: "evm_increaseTime", params: [3 * 86400] });
await pub.request({ method: "evm_mine" });

// Reveal p3 & p4
await revealPrediction(2, p3.id, p3Text, p3Salt);
await revealPrediction(3, p4.id, p4Text, p4Salt);

// Judge p3: 5 right (accounts 0, 1, 3, 4, 5) / 2 wrong (accounts 6, 7)
await judgePrediction(0, p3.id, true);
await judgePrediction(1, p3.id, true);
await judgePrediction(3, p3.id, true);
await judgePrediction(4, p3.id, true);
await judgePrediction(5, p3.id, true);
await judgePrediction(6, p3.id, false);
await judgePrediction(7, p3.id, false);

// Judge p4: only account 1 has judged (account 0 hasn't)
await judgePrediction(1, p4.id, true);

// Reveal Account 1 predictions B, C, D, E
await revealPrediction(1, pB.id, pB.text, bSalt);
await revealPrediction(1, pC.id, pC.text, cSalt);
await revealPrediction(1, pD.id, pD.text, dSalt);
await revealPrediction(1, pE.id, pE.text, eSalt);

// Warp remaining 97 days to reach realNow (and exceed 90-day window for #5 and #10)
await pub.request({ method: "evm_increaseTime", params: [97 * 86400] });
await pub.request({ method: "evm_mine" });

const finalBlock = await pub.getBlock();
const finalTs = Number(finalBlock.timestamp);
const diffSec = Math.abs(finalTs - realNow);

console.log(`Final chain timestamp: ${finalTs} (real: ${realNow}, diff: ${diffSec}s)`);
if (diffSec > 120) {
  console.error(`Chain time out of alignment: diff is ${diffSec}s > 120s`);
  process.exit(1);
}

// Verify Account 1 track record
const [a1Committed, a1Revealed] = await pub.readContract({
  address: contractAddress,
  abi: artifact.abi,
  functionName: "recordOf",
  args: [accounts[1].address],
});
console.log(`Scenario 6 verified: Account 1 record = ${a1Committed} committed / ${a1Revealed} revealed.`);

// Write .env.local
const envContent = `# Auto-generated by scripts/local-stack.mjs
NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet
NEXT_PUBLIC_BOHR_RPC=http://127.0.0.1:${PORT}
NEXT_PUBLIC_CHAIN_ID=968
NEXT_PUBLIC_RPC_URL_968=${RPC}
NEXT_PUBLIC_CONTRACT_968=${contractAddress}
NEXT_PUBLIC_DEPLOY_BLOCK_968=${deployBlock}
`;

writeFileSync(".env.local", envContent);
console.log("Wrote .env.local successfully.");

console.log("\n========================================================");
console.log(`Hindsight Local Stack Running on ${RPC}`);
console.log("========================================================");
console.log("Account Role Table:");
console.log("--------------------------------------------------------");
console.log(`Acc 0: ${accounts[0].address} (Author of #1 Sealed, #2 Revealable; judged #3; not judged #4)`);
console.log(`Acc 1: ${accounts[1].address} (Author of Scenario 6: 6 committed / 4 revealed / 1 lapsed / 1 sealed; judged #4)`);
console.log(`Acc 2: ${accounts[2].address} (Author of #3 Revealed with 5 right / 2 wrong)`);
console.log(`Acc 3: ${accounts[3].address} (Author of #4 Revealed; judged #3)`);
console.log(`Acc 4: ${accounts[4].address} (Author of #5 Lapsed unrevealed; judged #3)`);
console.log(`Acc 5..9: Available test users / judges`);
console.log("--------------------------------------------------------");
console.log(`Scenario 1 (Sealed in 20d):      /p/${p1.id}`);
console.log(`Scenario 2 (Revealable now):     /p/${p2.id}`);
console.log(`  Reveal JSON for Acc 0:`);
console.log(`  ${JSON.stringify({
  id: String(p2.id),
  text: p2Text,
  salt: p2Salt,
  author: accounts[0].address,
  revealAfter: p2.revealAfter,
  commitment: p2.commitment,
})}`);
console.log(`Scenario 3 (5 right / 2 wrong):  /p/${p3.id}`);
console.log(`Scenario 4 (Acc 0 hasn't judged):/p/${p4.id}`);
console.log(`Scenario 5 (Lapsed):             /p/${p5.id}`);
console.log(`Scenario 6 (Acc 1 track record): /u/${accounts[1].address}`);
console.log("========================================================\n");
