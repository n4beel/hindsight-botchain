"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { hindsightAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import {
  exportRevealFile,
  getSavedReveal,
  importRevealFile,
  listSavedReveals,
  saveReveal,
  statusOf,
  windowCloses,
  type PredictionView,
  type RevealItem,
} from "@/lib/hindsight";

export default function MyPredictions() {
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : undefined),
    [chainId]
  );

  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  // Read predictionsBy(connectedAddress, 0, 50)
  const {
    data: rawList,
    isLoading,
  } = useReadContract({
    address: deployment?.address,
    abi: hindsightAbi,
    functionName: "predictionsBy",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000", 0n, 50n],
    query: {
      enabled: Boolean(deployment?.address && connectedAddress),
    },
  });

  const nowSec = Math.floor(Date.now() / 1000);

  // Group predictions into the 4 required sections
  const { needsReveal, waiting, revealed, lapsed } = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = localRefresh; // trigger recalculation on import
    if (!rawList || !Array.isArray(rawList)) {
      return { needsReveal: [], waiting: [], revealed: [], lapsed: [] };
    }

    const now = Math.floor(Date.now() / 1000);

    const needs: Array<PredictionView & { closingAt: number; hasLocal: boolean }> = [];
    const wait: PredictionView[] = [];
    const rev: PredictionView[] = [];
    const lap: PredictionView[] = [];

    for (const p of rawList) {
      const st = statusOf(p, now);
      if (st.kind === "revealable") {
        const closingAt = windowCloses(p);
        const saved = getSavedReveal(p.commitment as Hex);
        needs.push({ ...p, closingAt, hasLocal: Boolean(saved) });
      } else if (st.kind === "sealed") {
        wait.push(p);
      } else if (st.kind === "revealed") {
        rev.push(p);
      } else if (st.kind === "lapsed") {
        lap.push(p);
      }
    }

    // Sort needsReveal by window closing soonest
    needs.sort((a, b) => a.closingAt - b.closingAt);

    return {
      needsReveal: needs,
      waiting: wait,
      revealed: rev,
      lapsed: lap,
    };
  }, [rawList, localRefresh]);

  // Saved reveals in local storage
  const savedReveals = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = localRefresh;
    return listSavedReveals();
  }, [localRefresh]);

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportNotice(null);
    setImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        const payload = importRevealFile(json);
        saveReveal(payload);
        setLocalRefresh((n) => n + 1);
        setImportNotice(
          `Imported reveal for ${payload.id ? `prediction #${payload.id}` : "commitment"}.`
        );
      } catch (err: unknown) {
        setImportError(err instanceof Error ? err.message : "Failed to import reveal file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleExport(rev: RevealItem) {
    exportRevealFile({
      id: rev.id,
      text: rev.text,
      salt: rev.salt,
      author: rev.author,
      revealAfter: rev.revealAfter,
      commitment: rev.commitment,
    });
  }

  return (
    <div className="space-y-8">
      {/* Top Header & Quick Actions */}
      <Panel className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#24505F]/60 pb-5">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-[#8FB0BC] font-mono">
              My Predictions
            </div>
            <h1 className="text-[24px] sm:text-[28px] serif font-normal text-[#D9ECF2] mt-1">
              Commitment Log
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[12px] px-3 py-1.5 rounded border border-[#24505F] text-[#8FB0BC] hover:text-[#D9ECF2] hover:border-[#8FB0BC]/60 transition-colors cursor-pointer inline-flex items-center gap-1.5">
              <span>Import reveal file</span>
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </label>
            <Link
              href="/new"
              className="text-[13px] px-3.5 py-1.5 rounded bg-[#F2B880] text-[#0E2A35] font-medium hover:bg-[#F2B880]/90 transition-colors no-underline"
            >
              + Commit new
            </Link>
          </div>
        </div>

        {importNotice && (
          <div className="mt-4 p-3 rounded bg-[#7BD3A1]/15 border border-[#7BD3A1]/40 text-[#7BD3A1] text-[13px] font-mono">
            ✓ {importNotice}
          </div>
        )}
        {importError && (
          <div className="mt-4 p-3 rounded bg-[#F28B82]/15 border border-[#F28B82]/40 text-[#F28B82] text-[13px] font-mono">
            ✗ {importError}
          </div>
        )}

        {/* Quick summary counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 text-center">
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#F2B880]">Needs Reveal</div>
            <div className="font-mono text-[20px] text-[#F2B880] mt-1">{needsReveal.length}</div>
          </div>
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#8FB0BC]">Waiting</div>
            <div className="font-mono text-[20px] text-[#D9ECF2] mt-1">{waiting.length}</div>
          </div>
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#7BD3A1]">Revealed</div>
            <div className="font-mono text-[20px] text-[#7BD3A1] mt-1">{revealed.length}</div>
          </div>
          <div className="bg-[#0E2A35]/60 rounded p-3 border border-[#24505F]/40">
            <div className="text-[11px] uppercase tracking-wider text-[#F28B82]">Lapsed</div>
            <div className="font-mono text-[20px] text-[#F28B82] mt-1">{lapsed.length}</div>
          </div>
        </div>
      </Panel>

      {isLoading && (
        <div className="text-center py-12 text-[#8FB0BC] text-[14px]">
          Reading prediction ledger…
        </div>
      )}

      {/* SECTION 1: Needs reveal now */}
      {!isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F2B880] ring-4 ring-[#F2B880]/20" />
            <h2 className="text-[16px] font-medium text-[#D9ECF2] tracking-wide">
              Needs Reveal Now ({needsReveal.length})
            </h2>
          </div>

          {needsReveal.length === 0 ? (
            <Panel className="p-4 text-[13px] text-[#8FB0BC]">
              No predictions currently in their 90-day reveal window.
            </Panel>
          ) : (
            <div className="space-y-3">
              {needsReveal.map((p) => {
                const idNum = p.id.toString();
                const daysLeft = Math.max(0, Math.ceil((p.closingAt - nowSec) / 86400));
                const closesStr = new Date(p.closingAt * 1000).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                });

                return (
                  <Panel
                    key={idNum}
                    className="p-5 border-l-4 border-l-[#F2B880] hover:border-[#F2B880]/60 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/p/${idNum}`}
                            className="font-mono text-[15px] text-[#F2B880] hover:underline"
                          >
                            #{idNum}
                          </Link>
                          <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#F2B880]/20 text-[#F2B880]">
                            Window closes in {daysLeft} {daysLeft === 1 ? "day" : "days"}
                          </span>
                        </div>
                        <div className="text-[12px] text-[#8FB0BC] mt-1 font-mono">
                          Window closes on {closesStr}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {p.hasLocal ? (
                          <Link
                            href={`/p/${idNum}`}
                            className="text-[12px] px-3.5 py-1.5 rounded bg-[#F2B880] text-[#0E2A35] font-medium hover:bg-[#F2B880]/90 transition-colors no-underline"
                          >
                            Reveal prediction →
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[#F28B82] italic">
                              Local data missing
                            </span>
                            <Link
                              href={`/p/${idNum}`}
                              className="text-[12px] px-3 py-1 rounded border border-[#24505F] text-[#D9ECF2] hover:border-[#8FB0BC] no-underline"
                            >
                              Import &amp; Reveal →
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>

                    {!p.hasLocal && (
                      <div className="mt-3 pt-3 border-t border-[#24505F]/40 text-[12px] text-[#F28B82]/90">
                        Without the text and salt this can&apos;t be revealed. Import your backup JSON
                        to reveal.
                      </div>
                    )}
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: Waiting */}
      {!isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-[#8FB0BC]" />
            <h2 className="text-[16px] font-medium text-[#D9ECF2] tracking-wide">
              Waiting ({waiting.length})
            </h2>
          </div>

          {waiting.length === 0 ? (
            <Panel className="p-4 text-[13px] text-[#8FB0BC]">
              No predictions waiting for their reveal date.
            </Panel>
          ) : (
            <div className="space-y-3">
              {waiting.map((p) => {
                const idNum = p.id.toString();
                const revealDate = new Date(Number(p.revealAfter) * 1000).toLocaleDateString(
                  undefined,
                  { year: "numeric", month: "short", day: "numeric" }
                );
                const hasLocal = Boolean(getSavedReveal(p.commitment as Hex));

                return (
                  <Panel key={idNum} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/p/${idNum}`}
                            className="font-mono text-[14px] text-[#F2B880] hover:underline"
                          >
                            #{idNum}
                          </Link>
                          <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#8FB0BC]/15 text-[#8FB0BC]">
                            Sealed until {revealDate}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[#658592] mt-1 truncate max-w-[280px] sm:max-w-[400px]">
                          Commitment: {p.commitment}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={`text-[11px] font-mono ${
                            hasLocal ? "text-[#7BD3A1]" : "text-[#8FB0BC]"
                          }`}
                        >
                          {hasLocal ? "✓ Saved locally" : "Not in browser"}
                        </span>
                        <Link
                          href={`/p/${idNum}`}
                          className="text-[12px] text-[#F2B880] hover:underline font-mono"
                        >
                          Details →
                        </Link>
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: Revealed */}
      {!isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#7BD3A1]" />
            <h2 className="text-[16px] font-medium text-[#D9ECF2] tracking-wide">
              Revealed ({revealed.length})
            </h2>
          </div>

          {revealed.length === 0 ? (
            <Panel className="p-4 text-[13px] text-[#8FB0BC]">
              No revealed predictions yet.
            </Panel>
          ) : (
            <div className="space-y-3">
              {revealed.map((p) => {
                const idNum = p.id.toString();
                const revDate = new Date(Number(p.revealedAt) * 1000).toLocaleDateString();

                return (
                  <Panel key={idNum} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/p/${idNum}`}
                            className="font-mono text-[14px] text-[#F2B880] hover:underline"
                          >
                            #{idNum}
                          </Link>
                          <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#7BD3A1]/15 text-[#7BD3A1]">
                            Revealed {revDate}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-mono text-[#8FB0BC] mt-1">
                          <span className="text-[#7BD3A1]">Called it: {p.right.toString()}</span>
                          <span>•</span>
                          <span className="text-[#F28B82]">Missed it: {p.wrong.toString()}</span>
                        </div>
                      </div>

                      <Link
                        href={`/p/${idNum}`}
                        className="text-[12px] text-[#F2B880] hover:underline font-mono"
                      >
                        View Record →
                      </Link>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: Lapsed */}
      {!isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-[#F28B82]" />
            <h2 className="text-[16px] font-medium text-[#D9ECF2] tracking-wide">
              Lapsed ({lapsed.length})
            </h2>
          </div>

          {lapsed.length === 0 ? (
            <Panel className="p-4 text-[13px] text-[#8FB0BC]">
              No predictions lapsed.
            </Panel>
          ) : (
            <div className="space-y-3">
              {lapsed.map((p) => {
                const idNum = p.id.toString();
                const windowEnd = Number(p.revealAfter) + 90 * 86400;
                const windowEndStr = new Date(windowEnd * 1000).toLocaleDateString();

                return (
                  <Panel key={idNum} className="p-4 opacity-75">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/p/${idNum}`}
                            className="font-mono text-[14px] text-[#8FB0BC] hover:underline"
                          >
                            #{idNum}
                          </Link>
                          <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-[#F28B82]/15 text-[#F28B82]">
                            Lapsed on {windowEndStr}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#8FB0BC] mt-1 italic">
                          Never revealed. The 90-day reveal window has closed.
                        </div>
                      </div>

                      <Link
                        href={`/p/${idNum}`}
                        className="text-[12px] text-[#8FB0BC] hover:underline font-mono"
                      >
                        Details →
                      </Link>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 5: Saved Local Backups */}
      <Panel className="p-6">
        <div className="flex items-center justify-between border-b border-[#24505F]/60 pb-3 mb-4">
          <div className="text-[13px] uppercase tracking-wider text-[#8FB0BC] font-mono">
            Browser Storage ({savedReveals.length} saved)
          </div>
          <button
            type="button"
            onClick={() => setLocalRefresh((n) => n + 1)}
            className="text-[11px] font-mono text-[#8FB0BC] hover:text-[#D9ECF2]"
          >
            Refresh
          </button>
        </div>

        {savedReveals.length === 0 ? (
          <div className="text-[13px] text-[#8FB0BC]">
            No reveal secrets stored in this browser.
          </div>
        ) : (
          <div className="space-y-3">
            {savedReveals.map((r, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded bg-[#0E2A35]/50 border border-[#24505F]/40"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-[#D9ECF2]">
                      {r.id ? `Prediction #${r.id}` : "Unlinked commitment"}
                    </span>
                    <span className="text-[11px] font-mono text-[#8FB0BC]">
                      Reveal after: {new Date(r.revealAfter * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-[12px] text-[#8FB0BC] line-clamp-1 italic mt-0.5">
                    &ldquo;{r.text}&rdquo;
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleExport(r)}
                  className="shrink-0 text-[11px]"
                >
                  Export JSON
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
