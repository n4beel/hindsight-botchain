"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  type Address,
  type Hex,
  decodeEventLog,
  isHex,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import BotChainGate from "@/components/botchain/BotChainGate";
import { hindsightAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import {
  commitmentOf,
  getSavedReveal,
  importRevealFile,
  statusOf,
  windowCloses,
} from "@/lib/hindsight";
import { describeError, shortAddress } from "@/lib/errors";

interface PredictionTimelineProps {
  id: bigint;
}

type ActionStage = "idle" | "signing" | "confirming" | "confirmed" | "error";

export default function PredictionTimeline({ id }: PredictionTimelineProps) {
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const clientRef = useRef(publicClient);
  clientRef.current = publicClient;
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );

  // Read prediction data
  const {
    data: prediction,
    isLoading: isPredictionLoading,
    error: predictionError,
    refetch: refetchPrediction,
  } = useReadContract({
    address: deployment?.address,
    abi: hindsightAbi,
    functionName: "predictionOf",
    args: [id],
    query: { enabled: !!deployment && id > 0n },
  });

  // Check if caller has judged
  const {
    data: hasJudgedCaller,
    refetch: refetchHasJudged,
  } = useReadContract({
    address: deployment?.address,
    abi: hindsightAbi,
    functionName: "hasJudged",
    args: [id, connectedAddress ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!deployment && id > 0n && !!connectedAddress },
  });

  // Revealed prediction text fetched from logs
  const [revealedText, setRevealedText] = useState<string | null>(null);

  // Reveal form state
  const [revealTextInput, setRevealTextInput] = useState("");
  const [revealSaltInput, setRevealSaltInput] = useState("");
  const [localPreCheckError, setLocalPreCheckError] = useState<string | null>(null);

  // Action states
  const [actionType, setActionType] = useState<"reveal" | "judge" | null>(null);
  const [stage, setStage] = useState<ActionStage>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const settledRef = useRef<Hex | null>(null);

  const { writeContractAsync } = useWriteContract();
  const {
    data: receipt,
    isSuccess: isReceiptSuccess,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });

  // Handle transaction confirmation
  useEffect(() => {
    if (!txHash) return;
    if (settledRef.current === txHash) return;

    if (isReceiptSuccess && receipt) {
      settledRef.current = txHash;
      setStage("confirmed");
      refetchPrediction();
      refetchHasJudged();
    } else if (isReceiptError) {
      settledRef.current = txHash;
      setStage("error");
      setErrorMessage(describeError(receiptError));
    }
  }, [
    txHash,
    isReceiptSuccess,
    isReceiptError,
    receipt,
    receiptError,
    refetchPrediction,
    refetchHasJudged,
  ]);

  const contractAddress = deployment?.address;
  const isRevealed = prediction?.status === 2;
  const revealedBlock = prediction?.revealedBlock;
  const predCommitment = prediction?.commitment;
  const predStatus = prediction?.status;

  // Try to load revealed text from Revealed event log
  useEffect(() => {
    if (!contractAddress || !isRevealed || !revealedBlock || revealedText) return;
    const client = clientRef.current;
    if (!client) return;

    let active = true;
    const fetchRevealedLog = async () => {
      try {
        const fromBlock = BigInt(Math.max(1, revealedBlock - 2));
        const toBlock = BigInt(revealedBlock + 2);

        const logs = await client.getLogs({
          address: contractAddress,
          event: {
            type: "event",
            name: "Revealed",
            inputs: [
              { indexed: true, name: "id", type: "uint256" },
              { indexed: true, name: "author", type: "address" },
              { indexed: false, name: "text", type: "string" },
            ],
          },
          args: { id },
          fromBlock,
          toBlock,
        });

        if (active && logs.length > 0) {
          const log = logs[0] as any;
          if (log.args && log.args.text) {
            setRevealedText(log.args.text);
          }
        }
      } catch {
        // Fallback or retry
      }
    };

    fetchRevealedLog();
    return () => {
      active = false;
    };
  }, [contractAddress, isRevealed, revealedBlock, revealedText, id]);

  // Check localStorage for saved reveal payload if user is author
  useEffect(() => {
    if (!predCommitment || predStatus !== 1) return;
    const saved = getSavedReveal(predCommitment);
    if (saved) {
      setRevealTextInput(saved.text);
      setRevealSaltInput(saved.salt);
    }
  }, [predCommitment, predStatus]);

  // Import reveal file handler
  const handleFileImport = (file: File) => {
    setLocalPreCheckError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = importRevealFile(
          content,
          connectedAddress ?? undefined
        );
        setRevealTextInput(imported.text);
        setRevealSaltInput(imported.salt);
      } catch (err) {
        setLocalPreCheckError(
          err instanceof Error ? err.message : "Failed to parse reveal file."
        );
      }
    };
    reader.readAsText(file);
  };

  // Perform Reveal
  const handleReveal = async () => {
    if (!deployment || !prediction || !connectedAddress) return;
    setLocalPreCheckError(null);

    // LOCAL PRE-CHECK: Protect user from wasting gas
    if (!isHex(revealSaltInput) || revealSaltInput.length !== 66) {
      setLocalPreCheckError("Salt must be a valid 32-byte hex string (0x...).");
      return;
    }

    const cleanText = revealTextInput.trim();
    if (!cleanText) {
      setLocalPreCheckError("Prediction text cannot be empty.");
      return;
    }

    const computed = commitmentOf(connectedAddress, cleanText, revealSaltInput as Hex);
    if (computed.toLowerCase() !== prediction.commitment.toLowerCase()) {
      setLocalPreCheckError("That isn't the text you sealed.");
      return;
    }

    setActionType("reveal");
    setStage("signing");
    setErrorMessage(null);

    try {
      const hash = await writeContractAsync({
        address: deployment.address,
        abi: hindsightAbi,
        functionName: "reveal",
        args: [id, cleanText, revealSaltInput as Hex],
      });
      setTxHash(hash);
      setStage("confirming");
    } catch (err) {
      setStage("error");
      setErrorMessage(describeError(err));
    }
  };

  // Perform Judge
  const handleJudge = async (right: boolean) => {
    if (!deployment) return;
    setActionType("judge");
    setStage("signing");
    setErrorMessage(null);

    try {
      const hash = await writeContractAsync({
        address: deployment.address,
        abi: hindsightAbi,
        functionName: "judge",
        args: [id, right],
      });
      setTxHash(hash);
      setStage("confirming");
    } catch (err) {
      setStage("error");
      setErrorMessage(describeError(err));
    }
  };

  if (isPredictionLoading) {
    return (
      <div className="py-12 text-center text-[#8FB0BC]">
        <div className="w-6 h-6 border-2 border-[#F2B880] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[13px]">Reading prediction #{id.toString()}...</p>
      </div>
    );
  }

  if (predictionError || !prediction || prediction.committedAt === 0n) {
    return (
      <div className="py-12 text-center space-y-4">
        <div className="serif text-[22px] text-[#D9ECF2]">
          Prediction #{id.toString()} not found
        </div>
        <p className="text-[13px] text-[#8FB0BC] max-w-sm mx-auto">
          No prediction exists with this ID on BOT Chain.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-[#F2B880] text-[#0E2A35] rounded font-semibold text-[13px]"
        >
          View Timeline Feed
        </Link>
      </div>
    );
  }

  const {
    author,
    commitment,
    committedAt,
    committedBlock,
    revealAfter,
    revealedAt,
    right,
    wrong,
    status,
  } = prediction;

  const st = statusOf(prediction);
  const isAuthor = connectedAddress?.toLowerCase() === author.toLowerCase();
  const closesDate = windowCloses({ revealAfter });
  const closesDateString = closesDate.toISOString().split("T")[0];
  const revealDateString = new Date(Number(revealAfter) * 1000).toISOString().split("T")[0];
  const committedDateString = new Date(Number(committedAt) * 1000).toISOString().split("T")[0];

  const totalJudgements = right + wrong;
  const rightPct = totalJudgements === 0 ? 50 : Math.round((right / totalJudgements) * 100);

  return (
    <div className="space-y-8">
      {/* Action Notification */}
      {stage === "confirmed" && (
        <div className="p-4 bg-[#1B4556] border-l-4 border-[#7BD3A1] rounded text-[13px] text-[#7BD3A1]">
          ✓ Your transaction was confirmed on BOT Chain.
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-[#143644] border-l-4 border-[#F28B82] rounded text-[13px] text-[#F28B82]">
          {errorMessage}
        </div>
      )}

      {/* Vertical Timeline Spine */}
      <div className="timeline-vertical-spine pl-10 sm:pl-12 space-y-8 relative">
        {/* Node 1: Sealed */}
        <div className="relative">
          <div className="absolute -left-10 sm:-left-12 top-5 transform -translate-x-1/2 z-10">
            <div className="node-ring-past" title="Sealed" />
          </div>
          <Panel variant="node" className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FB0BC]">
              <span>1. Sealed Commitment</span>
              <span className="mono text-[#658592]">Block #{committedBlock}</span>
            </div>
            <p className="text-[13px] text-[#D9ECF2] leading-relaxed">
              Committed by{" "}
              <Link
                href={`/u/${author}`}
                className="mono font-medium text-[#F2B880] hover:underline"
              >
                {shortAddress(author)}
              </Link>{" "}
              on <span className="mono text-[#D9ECF2]">{committedDateString}</span>.
            </p>
            <div className="mono text-[11px] break-all bg-[#0E2A35] p-2.5 rounded border border-[#24505F] text-[#8FB0BC]">
              Commitment: {commitment}
            </div>
          </Panel>
        </div>

        {/* Node 2: Waiting Period */}
        <div className="relative">
          <div className="absolute -left-10 sm:-left-12 top-5 transform -translate-x-1/2 z-10">
            <div
              className={status > 0 ? "node-ring-past" : "node-ring-active"}
              title="Waiting"
            />
          </div>
          <Panel variant="node" className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FB0BC]">
              2. Observation Lead Period
            </div>
            <p className="text-[13px] text-[#D9ECF2]">
              Prediction locked until{" "}
              <span className="mono font-medium text-[#D9ECF2]">{revealDateString}</span>.
            </p>
            <p className="text-[11px] text-[#658592]">
              Enforces that the forecast existed well before the event unfolded.
            </p>
          </Panel>
        </div>

        {/* Node 3: 90-Day Reveal Window */}
        <div className="relative">
          <div className="absolute -left-10 sm:-left-12 top-5 transform -translate-x-1/2 z-10">
            <div
              className={
                status === 2
                  ? "node-ring-past"
                  : status === 1
                  ? "node-ring-active"
                  : status === 3
                  ? "node-ring-lapsed"
                  : "node-ring-future"
              }
              title="Reveal Window"
            />
          </div>
          <Panel variant="node" className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FB0BC]">
              <span>3. 90-Day Reveal Window</span>
              <span className="mono text-[#F2B880]">
                {status === 1 ? "Open Now" : status === 2 ? "Completed" : status === 3 ? "Closed" : "Upcoming"}
              </span>
            </div>
            <p className="text-[13px] text-[#D9ECF2]">
              Window runs from <span className="mono">{revealDateString}</span> until{" "}
              <span className="mono">{closesDateString}</span>.
            </p>
            {status === 1 && (
              <p className="text-[12px] text-[#F2B880] font-medium pt-1">
                Window is currently open. The author must reveal before {closesDateString}.
              </p>
            )}
            {status === 3 && (
              <p className="text-[12px] text-[#F28B82]">
                Window closed without a reveal. This prediction has officially lapsed.
              </p>
            )}
          </Panel>
        </div>

        {/* Node 4: Revealed or Reveal Form or Lapsed */}
        <div className="relative">
          <div className="absolute -left-10 sm:-left-12 top-5 transform -translate-x-1/2 z-10">
            <div
              className={
                status === 2
                  ? "node-ring-past"
                  : status === 1
                  ? "node-ring-active"
                  : status === 3
                  ? "node-ring-lapsed"
                  : "node-ring-future"
              }
            />
          </div>

          {status === 2 ? (
            /* Revealed Prediction Block */
            <Panel variant="node" statusTone="revealed" className="space-y-4">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7BD3A1]">
                <span>4. Verified Prediction</span>
                <span className="mono">
                  Revealed {revealedAt > 0n ? new Date(Number(revealedAt) * 1000).toISOString().split("T")[0] : ""}
                </span>
              </div>

              <blockquote className="serif text-[22px] sm:text-[26px] md:text-[30px] font-normal leading-[1.3] text-[#D9ECF2] pl-6 border-l-2 border-[#7BD3A1] italic">
                &ldquo;{revealedText ?? "Loading verified revealed text from BOT Chain..."}&rdquo;
              </blockquote>

              <div className="text-[11px] text-[#8FB0BC]">
                Cryptographic commitment verified: hash matches author {shortAddress(author)} at creation.
              </div>
            </Panel>
          ) : status === 1 && isAuthor ? (
            /* Revealable Form for Author */
            <Panel variant="callout" className="space-y-4">
              <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#F2B880]">
                4. Reveal Your Prediction Now
              </div>
              <p className="text-[13px] text-[#D9ECF2]">
                The window is open! Provide the exact prediction text and secret salt from your reveal file.
              </p>

              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] uppercase tracking-wider text-[#8FB0BC]">
                      Prediction Text
                    </label>
                    <label className="text-[11px] text-[#F2B880] hover:underline cursor-pointer">
                      Import hindsight-{id.toString()}.json
                      <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileImport(f);
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    rows={3}
                    value={revealTextInput}
                    onChange={(e) => {
                      setRevealTextInput(e.target.value);
                      setLocalPreCheckError(null);
                    }}
                    placeholder="Exact UTF-8 prediction text"
                    className="w-full p-2.5 bg-[#0E2A35] border border-[#24505F] rounded text-[14px] serif text-[#D9ECF2] focus:outline-none focus:border-[#F2B880]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#8FB0BC] mb-1">
                    Secret Salt (32-byte 0x-hex)
                  </label>
                  <input
                    type="text"
                    value={revealSaltInput}
                    onChange={(e) => {
                      setRevealSaltInput(e.target.value.trim());
                      setLocalPreCheckError(null);
                    }}
                    placeholder="0x..."
                    className="mono w-full px-3 py-2 bg-[#0E2A35] border border-[#24505F] rounded text-[12px] text-[#D9ECF2] focus:outline-none focus:border-[#F2B880]"
                  />
                </div>

                {localPreCheckError && (
                  <div className="p-3 bg-[#0E2A35] border-l-2 border-[#F28B82] text-[12px] text-[#F28B82]">
                    {localPreCheckError}
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <Button
                    variant="primary"
                    size="md"
                    loading={stage === "signing" || stage === "confirming"}
                    disabled={stage === "signing" || stage === "confirming"}
                    onClick={handleReveal}
                  >
                    Reveal to the World
                  </Button>
                </div>
              </div>
            </Panel>
          ) : status === 1 ? (
            /* Revealable awaiting author */
            <Panel variant="node" statusTone="revealable">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#F2B880]">
                4. Awaiting Author Reveal
              </div>
              <p className="mt-1 text-[13px] text-[#D9ECF2]">
                The author has until {closesDateString} to publish the secret salt and text.
              </p>
            </Panel>
          ) : status === 3 ? (
            /* Lapsed */
            <Panel variant="node" statusTone="lapsed">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FB0BC]">
                4. Unrevealed (Lapsed)
              </div>
              <p className="mt-1 text-[13px] text-[#8FB0BC]">
                Never revealed. The 90-day window closed on {closesDateString}.
              </p>
            </Panel>
          ) : (
            /* Sealed */
            <Panel variant="node">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FB0BC]">
                4. Prediction Text
              </div>
              <p className="mt-1 text-[13px] text-[#8FB0BC] italic">
                Secret cryptographic commitment until reveal date ({revealDateString}).
              </p>
            </Panel>
          )}
        </div>

        {/* Node 5: Community Verdicts */}
        {status === 2 && (
          <div className="relative">
            <div className="absolute -left-10 sm:-left-12 top-5 transform -translate-x-1/2 z-10">
              <div className="node-ring-past" title="Verdicts" />
            </div>

            <Panel variant="node" className="space-y-4">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8FB0BC]">
                <span>5. Community Judgements</span>
                <span>{totalJudgements} vote{totalJudgements === 1 ? "" : "s"}</span>
              </div>

              {/* Tally Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[13px] font-medium">
                  <span className="text-[#7BD3A1]">Called it ({right})</span>
                  <span className="text-[#F28B82]">Missed it ({wrong})</span>
                </div>
                <div className="w-full h-2.5 bg-[#0E2A35] rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-[#7BD3A1] transition-all"
                    style={{ width: `${rightPct}%` }}
                  />
                  <div
                    className="h-full bg-[#F28B82] transition-all"
                    style={{ width: `${100 - rightPct}%` }}
                  />
                </div>
              </div>

              {/* Vote controls */}
              <div className="pt-2 border-t border-[#24505F]/60">
                {isAuthor ? (
                  <p className="text-[12px] text-[#8FB0BC] italic">
                    You authored this prediction; authors cannot judge their own entries.
                  </p>
                ) : hasJudgedCaller ? (
                  <div className="p-2.5 bg-[#1B4556] rounded text-[12px] text-[#D9ECF2] flex items-center gap-2">
                    <span>✓</span> You have already cast a verdict on this prediction.
                  </div>
                ) : (
                  <BotChainGate noWalletNote="Connect a wallet to judge this prediction.">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <span className="text-[12px] text-[#8FB0BC]">
                        Did the author call this correctly?
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="right"
                          size="md"
                          loading={actionType === "judge" && (stage === "signing" || stage === "confirming")}
                          onClick={() => handleJudge(true)}
                        >
                          Called it
                        </Button>
                        <Button
                          variant="wrong"
                          size="md"
                          loading={actionType === "judge" && (stage === "signing" || stage === "confirming")}
                          onClick={() => handleJudge(false)}
                        >
                          Missed it
                        </Button>
                      </div>
                    </div>
                  </BotChainGate>
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
