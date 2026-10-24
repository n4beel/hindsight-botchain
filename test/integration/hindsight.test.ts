import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { hindsightAbi } from "@/lib/botchain/abi";
import { commitmentOf, randomSalt } from "@/lib/hindsight";
import { MAX_PAGE, MAX_TEXT_BYTES, MIN_LEAD, REVEAL_WINDOW } from "@/lib/limits";

const PORT = 8611;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968 as const;

const MNEMONIC = "test test test test test test test test test test test junk";
const accounts = Array.from({ length: 6 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

let node: ChildProcess;
let publicClient: any;
let wallets: any[];
let hindsightAddress: Address;

function revertDetails(
  err: unknown
): { errorName?: string; args?: readonly unknown[] } | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      "data" in e &&
      Boolean((e as { data?: { errorName?: string } }).data?.errorName)
  ) as { data?: { errorName?: string; args?: readonly unknown[] } } | null;
  return found?.data;
}

beforeAll(async () => {
  node = spawn(
    "anvil",
    ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"],
    {
      stdio: ["ignore", "ignore", "inherit"],
    }
  );

  publicClient = createPublicClient({ chain: local, transport: http() });

  wallets = accounts.map((acc) =>
    createWalletClient({ account: acc, chain: local, transport: http() })
  );

  // Poll until Anvil answers
  for (let i = 0; ; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (i > 100) throw new Error(`Anvil never answered on ${RPC}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Deploy Hindsight contract
  const artifact = JSON.parse(
    readFileSync("contracts/out/Hindsight.sol/Hindsight.json", "utf8")
  );

  const deployHash = await wallets[0].deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });
  hindsightAddress = receipt.contractAddress!;
});

afterAll(() => {
  if (node && !node.killed) {
    node.kill("SIGTERM");
  }
});

describe("Hindsight contract integration", () => {
  const alice = accounts[0];
  const bob = accounts[1];
  const carol = accounts[2];

  it("deploys cleanly and exposes correct constants", async () => {
    expect(hindsightAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const revealWindow = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "REVEAL_WINDOW",
    });
    expect(revealWindow).toBe(REVEAL_WINDOW);

    const minLead = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "MIN_LEAD",
    });
    expect(minLead).toBe(MIN_LEAD);

    const maxText = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "MAX_TEXT_BYTES",
    });
    expect(maxText).toBe(BigInt(MAX_TEXT_BYTES));

    const maxPage = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "MAX_PAGE",
    });
    expect(maxPage).toBe(BigInt(MAX_PAGE));
  });

  it("commits a prediction and verifies commitmentOf matches contract expectation", async () => {
    const text = "Autonomous AI agents will pass all 15 gates before midnight.";
    const salt = randomSalt();
    const commitment = commitmentOf(alice.address, text, salt);

    const block = await publicClient.getBlock();
    const revealAfter = block.timestamp + 86400n; // 1 day

    const hash = await wallets[0].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "commit",
      args: [commitment, revealAfter],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const pred = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "predictionOf",
      args: [1n],
    });

    expect(pred.id).toBe(1n);
    expect(pred.author.toLowerCase()).toBe(alice.address.toLowerCase());
    expect(pred.commitment).toBe(commitment);
    expect(pred.revealAfter).toBe(revealAfter);
    expect(pred.revealedAt).toBe(0n);
    expect(pred.status).toBe(0); // Sealed
  });

  it("reveals prediction after revealAfter timestamp and updates recordOf", async () => {
    const text = "Autonomous AI agents will pass all 15 gates before midnight.";
    const salt = randomSalt();
    const commitment = commitmentOf(alice.address, text, salt);

    const block = await publicClient.getBlock();
    const revealAfter = block.timestamp + 7200n; // 2 hours

    const commitHash = await wallets[0].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "commit",
      args: [commitment, revealAfter],
    });
    await publicClient.waitForTransactionReceipt({ hash: commitHash });

    // Fast-forward past revealAfter
    await publicClient.request({ method: "evm_increaseTime", params: [7300] });
    await publicClient.request({ method: "evm_mine" });

    // Reveal from Alice
    const revealHash = await wallets[0].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "reveal",
      args: [2n, text, salt],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: revealHash });
    expect(receipt.status).toBe("success");

    const pred = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "predictionOf",
      args: [2n],
    });
    expect(pred.status).toBe(2); // Revealed
    expect(pred.revealedAt).toBeGreaterThan(0n);

    // Record check
    const [committed, revealed] = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "recordOf",
      args: [alice.address],
    });
    expect(committed).toBe(2);
    expect(revealed).toBe(1);
  });

  it("enforces window boundaries: allowed at +90d, closed at +90d + 1s", async () => {
    const text = "Window boundary test text";
    const salt1 = randomSalt();
    const salt2 = randomSalt();
    const c1 = commitmentOf(alice.address, text, salt1);
    const c2 = commitmentOf(alice.address, text, salt2);

    const block = await publicClient.getBlock();
    const revealAfter = block.timestamp + 3600n; // 1 hour

    await wallets[0].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "commit",
      args: [c1, revealAfter],
    });
    await wallets[0].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "commit",
      args: [c2, revealAfter],
    });

    const windowSpan = Number(REVEAL_WINDOW); // 90 days

    // Warp to exactly revealAfter + 90 days
    const targetTime1 = Number(revealAfter) + windowSpan;
    const currentBlock = await publicClient.getBlock();
    const jump = targetTime1 - Number(currentBlock.timestamp);
    if (jump > 0) {
      await publicClient.request({ method: "evm_increaseTime", params: [jump] });
      await publicClient.request({ method: "evm_mine" });
    }

    // Prediction 3 reveal at edge succeeds
    const hash3 = await wallets[0].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "reveal",
      args: [3n, text, salt1],
    });
    const receipt3 = await publicClient.waitForTransactionReceipt({ hash: hash3 });
    expect(receipt3.status).toBe("success");

    // Advance 2 seconds past window close
    await publicClient.request({ method: "evm_increaseTime", params: [2] });
    await publicClient.request({ method: "evm_mine" });

    // Prediction 4 reveal past window reverts with WindowClosed
    await expect(
      wallets[0].writeContract({
        address: hindsightAddress,
        abi: hindsightAbi,
        functionName: "reveal",
        args: [4n, text, salt2],
      })
    ).rejects.toThrow();

    const pred4 = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "predictionOf",
      args: [4n],
    });
    expect(pred4.status).toBe(3); // Lapsed
  });

  it("proves copied commitment is useless", async () => {
    const text = "Exclusive market analysis.";
    const salt = randomSalt();
    const c = commitmentOf(alice.address, text, salt);

    const block = await publicClient.getBlock();
    const revealAfter = block.timestamp + 3600n;

    // Alice commits
    await wallets[0].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "commit",
      args: [c, revealAfter],
    });

    // Bob copies c
    await wallets[1].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "commit",
      args: [c, revealAfter],
    });

    // Warp forward
    await publicClient.request({ method: "evm_increaseTime", params: [3700] });
    await publicClient.request({ method: "evm_mine" });

    // Bob attempts to reveal Alice's text with his wallet -> reverts BadReveal
    await expect(
      wallets[1].writeContract({
        address: hindsightAddress,
        abi: hindsightAbi,
        functionName: "reveal",
        args: [6n, text, salt],
      })
    ).rejects.toThrow();
  });

  it("handles judging: increments right/wrong and enforces one vote per wallet", async () => {
    // Prediction 2 is already revealed
    // Bob judges called it
    const j1 = await wallets[1].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "judge",
      args: [2n, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: j1 });

    // Carol judges missed it
    const j2 = await wallets[2].writeContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "judge",
      args: [2n, false],
    });
    await publicClient.waitForTransactionReceipt({ hash: j2 });

    const pred = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "predictionOf",
      args: [2n],
    });
    expect(pred.right).toBe(1);
    expect(pred.wrong).toBe(1);

    // Bob cannot judge again (AlreadyJudged)
    await expect(
      wallets[1].writeContract({
        address: hindsightAddress,
        abi: hindsightAbi,
        functionName: "judge",
        args: [2n, true],
      })
    ).rejects.toThrow();

    // Alice cannot judge her own prediction (AuthorCannotJudge)
    await expect(
      wallets[0].writeContract({
        address: hindsightAddress,
        abi: hindsightAbi,
        functionName: "judge",
        args: [2n, true],
      })
    ).rejects.toThrow();
  });

  it("filters latest predictions by status", async () => {
    const revealedList = await publicClient.readContract({
      address: hindsightAddress,
      abi: hindsightAbi,
      functionName: "latest",
      args: [0n, 10n, 2], // Status 2 = Revealed
    });
    expect(revealedList.length).toBeGreaterThan(0);
    for (const p of revealedList) {
      expect(p.status).toBe(2);
    }
  });
});
