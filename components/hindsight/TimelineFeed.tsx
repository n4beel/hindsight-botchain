"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChainId, usePublicClient, useReadContract } from "wagmi";
import Panel from "@/components/ui/Panel";
import { hindsightAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import { statusOf } from "@/lib/hindsight";
import { shortAddress } from "@/lib/errors";

type FilterTab = "all" | "revealed" | "waiting" | "lapsed";

const revealedTextCache = new Map<string, string>();

export default function TimelineFeed() {
  const chainId = useChainId();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );
  const publicClient = usePublicClient();
  const clientRef = useRef(publicClient);
  clientRef.current = publicClient;

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [revealedTexts, setRevealedTexts] = useState<Record<string, string>>({});

  const filterStatusNum = useMemo(() => {
    switch (activeTab) {
      case "revealed":
        return 2;
      case "waiting":
        return 0; // or 1
      case "lapsed":
        return 3;
      case "all":
      default:
        return 255;
    }
  }, [activeTab]);

  const { data: latestData, isLoading } = useReadContract({
    address: deployment?.address,
    abi: hindsightAbi,
    functionName: "latest",
    args: [0n, 50n, filterStatusNum],
    query: { enabled: !!deployment },
  });

  const predictions = useMemo(() => {
    const list = latestData ?? [];
    if (activeTab === "waiting") {
      // Include both Sealed (0) and Revealable (1)
      return list.filter((p) => p.status === 0 || p.status === 1);
    }
    return list;
  }, [latestData, activeTab]);

  // Load revealed text from Revealed event logs
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !deployment?.address || predictions.length === 0) return;

    const revealedPreds = predictions.filter(
      (p) => p.status === 2 && p.revealedBlock && !revealedTextCache.has(p.id.toString())
    );

    if (revealedPreds.length === 0) {
      const cached: Record<string, string> = {};
      for (const p of predictions) {
        if (p.status === 2 && revealedTextCache.has(p.id.toString())) {
          cached[p.id.toString()] = revealedTextCache.get(p.id.toString())!;
        }
      }
      setRevealedTexts((prev) => ({ ...prev, ...cached }));
      return;
    }

    let cancelled = false;

    const fetchLogs = async () => {
      const newTexts: Record<string, string> = {};
      await Promise.all(
        revealedPreds.map(async (p) => {
          try {
            const blk = BigInt(p.revealedBlock);
            const logs = await client.getLogs({
              address: deployment.address,
              event: {
                type: "event",
                name: "Revealed",
                inputs: [
                  { indexed: true, name: "id", type: "uint256" },
                  { indexed: true, name: "author", type: "address" },
                  { indexed: false, name: "text", type: "string" },
                ],
              },
              args: { id: p.id },
              fromBlock: blk > 1n ? blk - 1n : 1n,
              toBlock: blk + 1n,
            });
            if (logs.length > 0) {
              const text = (logs[0] as any).args?.text;
              if (text) {
                revealedTextCache.set(p.id.toString(), text);
                newTexts[p.id.toString()] = text;
              }
            }
          } catch (err) {
            console.error(`Failed to load revealed log for prediction #${p.id}:`, err);
          }
        })
      );

      if (!cancelled && Object.keys(newTexts).length > 0) {
        setRevealedTexts((prev) => ({ ...prev, ...newTexts }));
      }
    };

    fetchLogs();

    return () => {
      cancelled = true;
    };
  }, [deployment?.address, predictions]);

  const formatDate = (ts: bigint | number) => {
    return new Date(Number(ts) * 1000).toISOString().split("T")[0];
  };

  return (
    <div className="space-y-8">
      {/* Hero header line */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#24505F]/80">
        <div>
          <h2 className="serif text-[28px] sm:text-[32px] text-[#D9ECF2] font-normal tracking-tight">
            Said first.
          </h2>
          <p className="text-[13px] text-[#8FB0BC] mt-1">
            Predictions sealed before outcomes, revealed within a 90-day window, judged by the community.
          </p>
        </div>

        <Link
          href="/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#F2B880] text-[#0E2A35] font-semibold text-[13px] rounded hover:bg-[#E4AB75] transition-colors shrink-0"
        >
          Commit a prediction &rarr;
        </Link>
      </div>

      {/* Filter tab row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(
          [
            { id: "all", label: "All Predictions" },
            { id: "revealed", label: "Revealed" },
            { id: "waiting", label: "Waiting" },
            { id: "lapsed", label: "Lapsed" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-[2px] text-[12px] font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-[#1B4556] text-[#F2B880] border border-[#F2B880]/50"
                : "bg-transparent text-[#8FB0BC] hover:text-[#D9ECF2]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Timeline Feed Container */}
      {isLoading ? (
        <div className="py-12 text-center text-[#8FB0BC]">
          <div className="w-6 h-6 border-2 border-[#F2B880] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[13px]">Reading predictions along the timeline...</p>
        </div>
      ) : predictions.length === 0 ? (
        <div className="py-12 text-center bg-[#143644] border border-[#24505F] rounded p-8 space-y-3">
          <div className="serif text-[20px] text-[#D9ECF2]">
            No predictions in this section
          </div>
          <p className="text-[13px] text-[#8FB0BC] max-w-sm mx-auto">
            Be the first to seal an outcome prediction on BOT Chain.
          </p>
          <Link
            href="/new"
            className="inline-block px-4 py-2 bg-[#F2B880] text-[#0E2A35] rounded font-semibold text-[13px]"
          >
            Commit a prediction
          </Link>
        </div>
      ) : (
        <div className="timeline-vertical-spine space-y-6 pl-10 sm:pl-12 relative">
          {predictions.map((p) => {
            const st = statusOf(p);
            const isRevealed = p.status === 2;
            const isRevealable = p.status === 1;
            const isLapsed = p.status === 3;
            const daysLead = Math.max(
              1,
              Math.round((Number(p.revealedAt) - Number(p.committedAt)) / 86400)
            );

            return (
              <div key={p.id.toString()} className="relative group">
                {/* Node Ring on the timeline spine */}
                <div className="absolute -left-10 sm:-left-12 top-5 transform -translate-x-1/2 z-10">
                  {isRevealed ? (
                    <div className="node-ring-past" title="Revealed" />
                  ) : isRevealable ? (
                    <div className="node-ring-active" title="Revealable now" />
                  ) : isLapsed ? (
                    <div className="node-ring-lapsed" title="Lapsed" />
                  ) : (
                    <div className="node-ring-future" title="Sealed" />
                  )}
                </div>

                {/* Timeline Card */}
                <Panel
                  variant="feed"
                  statusTone={st.kind}
                  className="relative space-y-3 hover:translate-x-0.5 transition-transform"
                >
                  {/* Stretched link covering the entire card without nesting <a> tags */}
                  <Link
                    href={`/p/${p.id.toString()}`}
                    className="absolute inset-0 z-0"
                    aria-label={`View prediction #${p.id.toString()}`}
                  />

                  {/* Header info */}
                  <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#8FB0BC]">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/p/${p.id.toString()}`}
                        className="mono text-[#F2B880] font-medium hover:underline"
                      >
                        #{p.id.toString()}
                      </Link>
                      <span>&middot;</span>
                      <Link
                        href={`/u/${p.author}`}
                        className="hover:text-[#F2B880] mono text-[#D9ECF2] hover:underline"
                      >
                        {shortAddress(p.author)}
                      </Link>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          isRevealed
                            ? "bg-[#7BD3A1]/15 text-[#7BD3A1]"
                            : isRevealable
                            ? "bg-[#F2B880]/15 text-[#F2B880]"
                            : isLapsed
                            ? "bg-[#658592]/20 text-[#8FB0BC]"
                            : "bg-[#1B4556] text-[#8FB0BC]"
                        }`}
                      >
                        {st.label}
                      </span>
                      <span className="mono text-[#658592]">
                        Sealed {formatDate(p.committedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Content preview */}
                  {isRevealed ? (
                    <div className="relative z-10 space-y-1">
                      <blockquote className="serif text-[17px] sm:text-[19px] text-[#D9ECF2] leading-snug italic font-normal">
                        &ldquo;{revealedTexts[p.id.toString()] ?? "Loading revealed prediction…"}&rdquo;
                      </blockquote>
                      <div className="text-[11px] text-[#8FB0BC]">
                        Revealed on {formatDate(p.revealedAt)}
                        {p.revealedAt > p.committedAt && (
                          <span>
                            {" "}· Sealed {daysLead} day{daysLead === 1 ? "" : "s"} before it was revealed
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="relative z-10 space-y-1">
                      <div className="mono text-[12px] text-[#8FB0BC] truncate">
                        Commitment: {p.commitment}
                      </div>
                      <div className="text-[12px] text-[#658592]">
                        {isLapsed
                          ? `Window closed on ${formatDate(Number(p.revealAfter) + 90 * 86400)}. Lapsed unrevealed.`
                          : `Earliest reveal date: ${formatDate(p.revealAfter)}`}
                      </div>
                    </div>
                  )}

                  {/* Footer verdicts if revealed */}
                  {isRevealed && (
                    <div className="relative z-10 pt-2 border-t border-[#24505F]/60 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-3">
                        <span className="text-[#7BD3A1] font-medium">
                          ✓ {p.right} Called it
                        </span>
                        <span className="text-[#F28B82] font-medium">
                          ✕ {p.wrong} Missed it
                        </span>
                      </div>

                      <span className="text-[#F2B880] font-medium group-hover:underline">
                        View timeline &rarr;
                      </span>
                    </div>
                  )}
                </Panel>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
