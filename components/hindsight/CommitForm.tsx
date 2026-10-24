"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { type Hex, decodeEventLog } from "viem";
import {
  useAccount,
  useChainId,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { hindsightAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import {
  commitmentOf,
  exportRevealFile,
  linkSavedRevealId,
  randomSalt,
  saveReveal,
  textByteLength,
  type RevealPayload,
} from "@/lib/hindsight";
import { MAX_LEAD, MAX_TEXT_BYTES, MIN_LEAD } from "@/lib/limits";
import { describeError } from "@/lib/errors";

type TxStage = "idle" | "signing" | "confirming" | "confirmed" | "error";

export default function CommitForm() {
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );

  const [text, setText] = useState("");
  const [leadPreset, setLeadPreset] = useState<"1w" | "1m" | "3m" | "1y" | "custom">("1m");
  const [customDate, setCustomDate] = useState("");

  // Stored pending commitment info
  const [pendingReveal, setPendingReveal] = useState<RevealPayload | null>(null);

  // File gate state
  const [fileDownloaded, setFileDownloaded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Transaction states
  const [stage, setStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [committedId, setCommittedId] = useState<bigint | null>(null);

  const settledRef = useRef<Hex | null>(null);

  const { writeContractAsync } = useWriteContract();
  const {
    data: receipt,
    isSuccess: isReceiptSuccess,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });

  // Compute reveal timestamp
  const revealAfter = useMemo<bigint>(() => {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (leadPreset === "1w") return nowSec + 7n * 86400n;
    if (leadPreset === "1m") return nowSec + 30n * 86400n;
    if (leadPreset === "3m") return nowSec + 90n * 86400n;
    if (leadPreset === "1y") return nowSec + 365n * 86400n;
    if (leadPreset === "custom" && customDate) {
      const parsed = Math.floor(new Date(customDate).getTime() / 1000);
      if (!isNaN(parsed) && parsed > 0) return BigInt(parsed);
    }
    return nowSec + 30n * 86400n;
  }, [leadPreset, customDate]);

  // Validation
  const validation = useMemo(() => {
    const errors: string[] = [];
    const tLen = textByteLength(text.trim());

    if (tLen === 0) {
      errors.push("Prediction text is required.");
    } else if (tLen > MAX_TEXT_BYTES) {
      errors.push(`Text exceeds limit (${tLen}/${MAX_TEXT_BYTES} bytes).`);
    }

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (revealAfter < nowSec + MIN_LEAD) {
      errors.push("Reveal date must be at least 1 hour in the future.");
    } else if (revealAfter > nowSec + MAX_LEAD) {
      errors.push("Reveal date cannot exceed 5 years.");
    }

    return {
      canSubmit: errors.length === 0,
      errors,
    };
  }, [text, revealAfter]);

  // Handle receipt confirmation with settledRef
  useEffect(() => {
    if (!txHash) return;
    if (settledRef.current === txHash) return;

    if (isReceiptSuccess && receipt) {
      settledRef.current = txHash;
      setStage("confirmed");

      // Extract prediction ID from Committed event
      try {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: hindsightAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "Committed" && decoded.args) {
              const args = decoded.args as { id?: bigint };
              if (args.id !== undefined) {
                setCommittedId(args.id);
                if (pendingReveal) {
                  linkSavedRevealId(pendingReveal.commitment, args.id);
                }
                break;
              }
            }
          } catch {
            // Not matching
          }
        }
      } catch {
        // Fallback
      }
    } else if (isReceiptError) {
      settledRef.current = txHash;
      setStage("error");
      setErrorMessage(describeError(receiptError));
    }
  }, [txHash, isReceiptSuccess, isReceiptError, receipt, receiptError, pendingReveal]);

  // Handle submit action
  const handleCommit = async () => {
    if (!validation.canSubmit || !connectedAddress || !deployment) return;

    setStage("signing");
    setErrorMessage(null);

    const cleanText = text.trim();
    const salt = randomSalt();
    const commitment = commitmentOf(connectedAddress, cleanText, salt);

    const payload: RevealPayload = {
      text: cleanText,
      salt,
      author: connectedAddress,
      revealAfter: Number(revealAfter),
      commitment,
    };

    // CRITICAL: Persist to local storage BEFORE wallet prompt
    saveReveal(payload);
    setPendingReveal(payload);

    try {
      const hash = await writeContractAsync({
        address: deployment.address,
        abi: hindsightAbi,
        functionName: "commit",
        args: [commitment, revealAfter],
      });

      setTxHash(hash);
      setStage("confirming");
    } catch (err) {
      setStage("error");
      setErrorMessage(describeError(err));
    }
  };

  // Download reveal file
  const handleDownloadFile = () => {
    if (!pendingReveal) return;
    const dataToSave = {
      ...pendingReveal,
      id: committedId ? String(committedId) : undefined,
    };
    const json = exportRevealFile(dataToSave);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hindsight-${committedId?.toString() || "sealed"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFileDownloaded(true);
  };

  const handleCopyFile = () => {
    if (!pendingReveal) return;
    const dataToSave = {
      ...pendingReveal,
      id: committedId ? String(committedId) : undefined,
    };
    navigator.clipboard.writeText(exportRevealFile(dataToSave));
    setFileDownloaded(true);
  };

  // Render confirmed stage FIRST
  if (stage === "confirmed") {
    const canDismiss = fileDownloaded || acknowledged;
    const predictionUrl = committedId ? `/p/${committedId}` : "/";

    return (
      <div className="space-y-6">
        <div className="p-5 bg-[#1B4556] border-l-4 border-[#7BD3A1] rounded-[2px]">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#7BD3A1]">
            <span>✓</span> Prediction Sealed On-Chain
          </div>
          <p className="mt-1 text-[13px] text-[#D9ECF2]">
            Your commitment has been anchored on BOT Chain. The text remains secret until the reveal date.
          </p>
        </div>

        {/* The Save Your Reveal File Gate */}
        <Panel variant="callout" className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F2B880] animate-pulse" />
            <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#F2B880]">
              Save Your Reveal File (Required)
            </h3>
          </div>

          <p className="text-[13px] text-[#D9ECF2] leading-relaxed">
            Without this file and its secret salt, your prediction can <strong>never be revealed</strong>.
            The contract cannot recover it, and neither can anyone else. It will lapse forever unrevealed.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="primary" size="md" onClick={handleDownloadFile}>
              Download hindsight-{committedId ? `${committedId}.json` : "file.json"}
            </Button>
            <Button variant="secondary" size="md" onClick={handleCopyFile}>
              Copy Reveal JSON
            </Button>
          </div>

          <div className="pt-3 border-t border-[#24505F]/80">
            <label className="flex items-start gap-2.5 text-[12px] text-[#8FB0BC] cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 accent-[#F2B880]"
              />
              <span>
                I understand that without the text and salt in this file, this prediction cannot be revealed and will lapse.
              </span>
            </label>
          </div>
        </Panel>

        {/* Next actions (guarded by file save gate) */}
        <div className="flex items-center justify-between pt-2">
          {canDismiss ? (
            <Link
              href={predictionUrl}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F2B880] text-[#0E2A35] rounded font-semibold text-[13px] hover:bg-[#E4AB75] transition-colors"
            >
              Open Prediction Timeline &rarr;
            </Link>
          ) : (
            <div className="text-[12px] text-[#8FB0BC] italic">
              Save your reveal file or check the acknowledgement above to proceed.
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText("");
              setStage("idle");
              setTxHash(null);
              setCommittedId(null);
              setPendingReveal(null);
              setFileDownloaded(false);
              setAcknowledged(false);
              settledRef.current = null;
            }}
          >
            Seal another prediction
          </Button>
        </div>
      </div>
    );
  }

  const revealDateString = new Date(Number(revealAfter) * 1000)
    .toISOString()
    .split("T")[0];

  return (
    <div className="space-y-7">
      {/* 1. Prediction text input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label
            htmlFor="prediction-text"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8FB0BC]"
          >
            1. Your Prediction (Max 280 Bytes)
          </label>
          <span
            className={`text-[11px] mono ${
              textByteLength(text.trim()) > MAX_TEXT_BYTES
                ? "text-[#F28B82] font-bold"
                : "text-[#658592]"
            }`}
          >
            {textByteLength(text.trim())} / {MAX_TEXT_BYTES} bytes
          </span>
        </div>
        <textarea
          id="prediction-text"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="State what you believe will happen. Write with quiet certainty..."
          className="w-full p-3.5 bg-[#143644] border border-[#24505F] rounded-[2px] text-[15px] serif text-[#D9ECF2] placeholder:text-[#658592] focus:outline-none focus:border-[#F2B880] transition-colors"
        />
      </div>

      {/* 2. Reveal Date */}
      <div>
        <label className="block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8FB0BC] mb-2">
          2. Earliest Date to Reveal (90-day window starts here)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {(["1w", "1m", "3m", "1y", "custom"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setLeadPreset(p)}
              className={`px-3.5 py-1.5 rounded-[2px] text-[12px] font-medium border transition-colors ${
                leadPreset === p
                  ? "bg-[#F2B880] text-[#0E2A35] border-[#F2B880] font-semibold"
                  : "bg-[#143644] text-[#D9ECF2] border-[#24505F] hover:bg-[#1B4556]"
              }`}
            >
              {p === "1w"
                ? "1 week"
                : p === "1m"
                ? "1 month"
                : p === "3m"
                ? "3 months"
                : p === "1y"
                ? "1 year"
                : "Custom date"}
            </button>
          ))}
        </div>

        {leadPreset === "custom" && (
          <div className="mt-3">
            <input
              type="datetime-local"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="px-3.5 py-2 bg-[#143644] border border-[#24505F] rounded text-[13px] text-[#D9ECF2] focus:outline-none focus:border-[#F2B880]"
            />
          </div>
        )}
      </div>

      {/* 3. Live Preview: What becomes public now */}
      <Panel variant="inset" className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F2B880]">
          What Becomes Public Now
        </div>
        <p className="text-[12px] text-[#8FB0BC]">
          Only your author address, the cryptographic commitment hash, and the earliest reveal date (
          <span className="text-[#D9ECF2] font-mono">{revealDateString}</span>) are broadcast to BOT Chain.
          Your prediction text stays completely hidden until you reveal it.
        </p>
      </Panel>

      {/* 4. Honest limits warning */}
      <div className="p-3.5 bg-[#143644] border-l-2 border-[#F2B880] text-[12px] text-[#8FB0BC] space-y-1">
        <div className="font-semibold text-[#D9ECF2]">Important Warning</div>
        <p>
          Keep the reveal file. Without the text and the secret salt, this prediction can never be revealed.
          Judgements come from other wallets and prove nothing legally.
        </p>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="p-3.5 bg-[#143644] border-l-2 border-[#F28B82] rounded text-[13px] text-[#F28B82]">
          {errorMessage}
        </div>
      )}

      {/* Validation feedback */}
      {!validation.canSubmit && validation.errors.length > 0 && (
        <div className="text-[12px] text-[#658592] space-y-1">
          {validation.errors.map((err, i) => (
            <div key={i}>&bull; {err}</div>
          ))}
        </div>
      )}

      {/* Submit button */}
      <div className="pt-2 border-t border-[#24505F]/80 flex items-center justify-between">
        <span className="text-[12px] text-[#658592]">
          Lead time: reveals after {revealDateString}
        </span>
        <Button
          variant="primary"
          size="lg"
          disabled={!validation.canSubmit || stage === "signing" || stage === "confirming"}
          loading={stage === "signing" || stage === "confirming"}
          onClick={handleCommit}
        >
          {stage === "signing"
            ? "Confirm in Wallet..."
            : stage === "confirming"
            ? "Sealing on BOT Chain..."
            : "Commit Prediction"}
        </Button>
      </div>
    </div>
  );
}
