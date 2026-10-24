"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { useChainId, useReadContract } from "wagmi";
import Panel from "@/components/ui/Panel";
import { hindsightAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import { statusOf } from "@/lib/hindsight";
import { shortAddress } from "@/lib/errors";

interface AuthorRecordProps {
  address: Address;
}

export default function AuthorRecord({ address }: AuthorRecordProps) {
  const chainId = useChainId();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );

  // Read recordOf(author) -> (committed, revealed)
  const { data: recordData, isLoading: recordLoading } = useReadContract({
    address: deployment?.address,
    abi: hindsightAbi,
    functionName: "recordOf",
    args: [address],
    query: {
      enabled: Boolean(deployment?.address && address),
    },
  });

  // Read predictionsBy(author, offset=0, count=50) -> PredictionView[]
  const { data: rawList, isLoading: predictionsLoading } = useReadContract({
    address: deployment?.address,
    abi: hindsightAbi,
    functionName: "predictionsBy",
    args: [address, 0n, 50n],
    query: {
      enabled: Boolean(deployment?.address && address),
    },
  });

  const committedCount = recordData ? Number(recordData[0]) : 0;
  const revealedCount = recordData ? Number(recordData[1]) : 0;

  // Deriving lapsed count & verdict totals
  const { lapsedCount, totalRight, totalWrong, predictions } = useMemo(() => {
    if (!rawList || !Array.isArray(rawList)) {
      return { lapsedCount: 0, totalRight: 0, totalWrong: 0, predictions: [] };
    }
    const now = Math.floor(Date.now() / 1000);

    let lapsed = 0;
    let right = 0;
    let wrong = 0;

    const list = rawList.map((p) => {
      const st = statusOf(p, now);
      if (st.kind === "lapsed") lapsed += 1;
      if (st.kind === "revealed") {
        right += Number(p.right);
        wrong += Number(p.wrong);
      }
      return { ...p, statusKind: st.kind, statusLabel: st.label };
    });

    return {
      lapsedCount: lapsed,
      totalRight: right,
      totalWrong: wrong,
      predictions: list,
    };
  }, [rawList]);

  const isLoading = recordLoading || predictionsLoading;

  return (
    <div className="space-y-8">
      {/* Author Record Header */}
      <Panel className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#24505F]/60 pb-5">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-[#8FB0BC] font-mono">
              Author Record
            </div>
            <h1 className="text-[20px] sm:text-[24px] font-mono text-[#D9ECF2] break-all mt-1">
              {address}
            </h1>
          </div>
          <Link
            href="/new"
            className="text-[13px] px-3.5 py-1.5 rounded bg-[#F2B880] text-[#0E2A35] font-medium hover:bg-[#F2B880]/90 transition-colors inline-block text-center no-underline shrink-0"
          >
            Commit a prediction
          </Link>
        </div>

        {/* The Key Copy line from §3.4 */}
        <div className="pt-5 pb-2">
          <div className="serif text-[20px] sm:text-[22px] text-[#F2B880] leading-snug">
            {isLoading ? (
              <span className="text-[#8FB0BC] text-[16px] sans">Loading record…</span>
            ) : (
              <>
                <span className="font-mono text-[#D9ECF2]">{shortAddress(address)}</span> committed{" "}
                <span className="font-semibold text-[#D9ECF2]">{committedCount}</span>, revealed{" "}
                <span className="font-semibold text-[#7BD3A1]">{revealedCount}</span>, and let{" "}
                <span className="font-semibold text-[#F28B82]">{lapsedCount}</span> lapse.
              </>
            )}
          </div>
        </div>

        {/* Verdicts summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#24505F]/40 text-center">
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#8FB0BC]">Committed</div>
            <div className="font-mono text-[20px] text-[#D9ECF2] mt-1">{committedCount}</div>
          </div>
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#8FB0BC]">Revealed</div>
            <div className="font-mono text-[20px] text-[#7BD3A1] mt-1">{revealedCount}</div>
          </div>
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#8FB0BC]">Called it</div>
            <div className="font-mono text-[20px] text-[#7BD3A1] mt-1">✓ {totalRight}</div>
          </div>
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#8FB0BC]">Missed it</div>
            <div className="font-mono text-[20px] text-[#F28B82] mt-1">✗ {totalWrong}</div>
          </div>
        </div>
      </Panel>

      {/* Predictions Timeline */}
      <div className="relative pl-6 sm:pl-8">
        {/* Timeline Spine line */}
        <div
          className="absolute left-[11px] sm:left-[15px] top-3 bottom-3 w-[2px] bg-[#24505F]"
          aria-hidden="true"
        />

        <div className="space-y-6">
          <div className="text-[13px] uppercase tracking-wider text-[#8FB0BC] font-mono mb-2">
            Predictions Timeline
          </div>

          {isLoading && (
            <div className="text-[#8FB0BC] text-[14px] py-8">Loading predictions…</div>
          )}

          {!isLoading && predictions.length === 0 && (
            <Panel className="p-6 text-center text-[#8FB0BC] text-[14px]">
              No predictions recorded for this author yet.
            </Panel>
          )}

          {!isLoading &&
            predictions.map((p) => {
              const idNum = p.id.toString();
              const committedDate = new Date(Number(p.committedAt) * 1000).toLocaleDateString(
                undefined,
                { year: "numeric", month: "short", day: "numeric" }
              );
              const revealAfterDate = new Date(Number(p.revealAfter) * 1000).toLocaleDateString(
                undefined,
                { year: "numeric", month: "short", day: "numeric" }
              );

              // Node status styling
              let nodeStyle = "border-2 border-[#8FB0BC] bg-[#0E2A35]";
              let statusBadge = (
                <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#8FB0BC]/15 text-[#8FB0BC]">
                  Sealed
                </span>
              );

              if (p.statusKind === "revealable") {
                nodeStyle = "bg-[#F2B880] ring-4 ring-[#F2B880]/30 shadow-[0_0_10px_#F2B880]";
                statusBadge = (
                  <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#F2B880]/20 text-[#F2B880]">
                    Reveal Window Open
                  </span>
                );
              } else if (p.statusKind === "revealed") {
                nodeStyle = "bg-[#7BD3A1] ring-4 ring-[#7BD3A1]/20";
                statusBadge = (
                  <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#7BD3A1]/20 text-[#7BD3A1]">
                    Revealed
                  </span>
                );
              } else if (p.statusKind === "lapsed") {
                nodeStyle = "border-2 border-dashed border-[#F28B82] bg-[#0E2A35]";
                statusBadge = (
                  <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#F28B82]/15 text-[#F28B82]">
                    Lapsed
                  </span>
                );
              }

              return (
                <div key={idNum} className="relative group">
                  {/* Timeline node marker */}
                  <span
                    className={`absolute -left-[19px] sm:-left-[23px] top-5 w-[14px] h-[14px] rounded-full transition-transform group-hover:scale-125 ${nodeStyle}`}
                    aria-hidden="true"
                  />

                  <Panel className="p-5 hover:border-[#8FB0BC]/40 transition-colors">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#24505F]/40 pb-3 mb-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/p/${idNum}`}
                          className="font-mono text-[14px] text-[#F2B880] hover:underline"
                        >
                          #{idNum}
                        </Link>
                        {statusBadge}
                      </div>
                      <div className="text-[12px] font-mono text-[#8FB0BC]">
                        Sealed {committedDate}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {p.statusKind === "revealed" ? (
                        <div className="text-[13px] text-[#8FB0BC]">
                          Revealed prediction on{" "}
                          <span className="font-mono text-[#D9ECF2]">
                            {new Date(Number(p.revealedAt) * 1000).toLocaleDateString()}
                          </span>
                          .
                        </div>
                      ) : p.statusKind === "lapsed" ? (
                        <div className="text-[13px] text-[#F28B82]/90 italic">
                          Never revealed. The 90-day window has closed.
                        </div>
                      ) : (
                        <div className="text-[13px] text-[#8FB0BC]">
                          Sealed until{" "}
                          <span className="font-mono text-[#D9ECF2]">{revealAfterDate}</span>.
                        </div>
                      )}

                      {/* Verdicts bar if revealed */}
                      {p.statusKind === "revealed" && (
                        <div className="flex items-center gap-3 text-[12px] font-mono pt-1">
                          <span className="text-[#7BD3A1]">Called it: {p.right.toString()}</span>
                          <span className="text-[#658592]">•</span>
                          <span className="text-[#F28B82]">Missed it: {p.wrong.toString()}</span>
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-2">
                        <span className="font-mono text-[11px] text-[#658592] truncate max-w-[200px] sm:max-w-[320px]">
                          Commitment: {p.commitment}
                        </span>
                        <Link
                          href={`/p/${idNum}`}
                          className="text-[12px] text-[#F2B880] hover:underline font-mono"
                        >
                          View Timeline →
                        </Link>
                      </div>
                    </div>
                  </Panel>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
