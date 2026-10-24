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
 * Usage:
 *   node scripts/local-stack.mjs
 */

import { spawn } from "node:child_process";
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

console.log(`Starting anvil on port ${PORT}...`);
spawn(
  "anvil",
  ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--accounts", "10", "--silent"],
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
  return { id: count, commitment: c };
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

console.log("Seeding scenarios...");

const curBlock = await pub.getBlock();
const now = Number(curBlock.timestamp);

// Scenario 1: Sealed, reveal in 20 days (account 0's)
const p1Salt = "0x0000000000000000000000000000000000000000000000000000000000000001";
const p1Text = "Major layer-1 foundation announces complete governance decentralization.";
const p1 = await commitPrediction(0, p1Text, p1Salt, now + 20 * 86400);
console.log(`Scenario 1: Prediction #${p1.id} (Sealed, reveals in 20d)`);

// Scenario 2: Revealable now, account 0 has text in localStorage-equivalent JSON
const p2Salt = "0x0000000000000000000000000000000000000000000000000000000000000002";
const p2Text = "Central bank pilot launches cross-border settlement corridor.";
const p2 = await commitPrediction(0, p2Text, p2Salt, now + 3600); // 1 hr lead
console.log(`Scenario 2: Prediction #${p2.id} (Revealable now for Account 0)`);
console.log(`  Reveal file JSON fixture:`, JSON.stringify({
  id: String(p2.id),
  text: p2Text,
  salt: p2Salt,
  author: accounts[0].address,
  revealAfter: now + 3600,
  commitment: p2.commitment,
}));

// Scenario 3: Revealed with 5 right / 2 wrong
const p3Salt = "0x0000000000000000000000000000000000000000000000000000000000000003";
const p3Text = "Zero-knowledge rollup generates first client-side proof under 500ms.";
const p3 = await commitPrediction(2, p3Text, p3Salt, now + 3600);

// Scenario 4: Revealed and account 0 hasn't judged
const p4Salt = "0x0000000000000000000000000000000000000000000000000000000000000004";
const p4Text = "Open-weights reasoning model reaches top human competition bench.";
const p4 = await commitPrediction(3, p4Text, p4Salt, now + 3600);

// Scenario 5: Lapsed (past 90-day window)
const p5Salt = "0x0000000000000000000000000000000000000000000000000000000000000005";
const p5Text = "Quantum computing supremacy benchmark disputed within 3 months.";
const p5 = await commitPrediction(4, p5Text, p5Salt, now + 3600);

// Fast forward past revealAfter (+3700s)
await pub.request({ method: "evm_increaseTime", params: [3700] });
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
console.log(`Scenario 3: Prediction #${p3.id} (Revealed, 5 right / 2 wrong)`);

// Judge p4: only account 1 has judged (account 0 hasn't)
await judgePrediction(1, p4.id, true);
console.log(`Scenario 4: Prediction #${p4.id} (Revealed, Account 0 has NOT judged)`);

// Fast forward past 90 days for Scenario 5 to lapse
await pub.request({ method: "evm_increaseTime", params: [91 * 86400] });
await pub.request({ method: "evm_mine" });
console.log(`Scenario 5: Prediction #${p5.id} (Lapsed unrevealed past 90-day window)`);

// Scenario 6: Account 1 with 6 committed / 4 revealed / 1 lapsed / 1 sealed
console.log("Seeding Scenario 6 (Account 1 track record)...");
const curBlock2 = await pub.getBlock();
const now2 = Number(curBlock2.timestamp);

// Prediction A (Sealed): reveals in 10 days
await commitPrediction(1, "Account 1 prediction A (sealed)", randomSalt(), now2 + 10 * 86400);

// Predictions B, C, D, E (Will be revealed)
const bSalt = randomSalt();
const cSalt = randomSalt();
const dSalt = randomSalt();
const eSalt = randomSalt();
const pB = await commitPrediction(1, "Account 1 prediction B", bSalt, now2 + 3600);
const pC = await commitPrediction(1, "Account 1 prediction C", cSalt, now2 + 3600);
const pD = await commitPrediction(1, "Account 1 prediction D", dSalt, now2 + 3600);
const pE = await commitPrediction(1, "Account 1 prediction E", eSalt, now2 + 3600);

// Prediction F (Will be lapsed)
const pF = await commitPrediction(1, "Account 1 prediction F (lapsed)", randomSalt(), now2 + 3600);

// Warp to reveal period
await pub.request({ method: "evm_increaseTime", params: [3700] });
await pub.request({ method: "evm_mine" });

await revealPrediction(1, pB.id, "Account 1 prediction B", bSalt);
await revealPrediction(1, pC.id, "Account 1 prediction C", cSalt);
await revealPrediction(1, pD.id, "Account 1 prediction D", dSalt);
await revealPrediction(1, pE.id, "Account 1 prediction E", eSalt);

// Warp past 90 days so pF lapses
await pub.request({ method: "evm_increaseTime", params: [91 * 86400] });
await pub.request({ method: "evm_mine" });

const [a1Committed, a1Revealed] = await pub.readContract({
  address: contractAddress,
  abi: artifact.abi,
  functionName: "recordOf",
  args: [accounts[1].address],
});
console.log(`Scenario 6: Account 1 record on-chain: ${a1Committed} committed / ${a1Revealed} revealed.`);

// Write .env.local
const envContent = `# Auto-generated by scripts/local-stack.mjs
NEXT_PUBLIC_CHAIN_ID=968
NEXT_PUBLIC_RPC_URL_968=${RPC}
NEXT_PUBLIC_CONTRACT_968=${contractAddress}
NEXT_PUBLIC_DEPLOY_BLOCK_968=${deployBlock}
`;

writeFileSync(".env.local", envContent);
console.log("Wrote .env.local successfully.");
console.log("Local stack ready!");
process.exit(0);
