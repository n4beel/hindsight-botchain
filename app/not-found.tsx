import Link from "next/link";
import PageShell from "@/components/layout/PageShell";

export default function NotFound() {
  return (
    <PageShell title="Prediction Not Found" subtitle="This timeline event could not be found">
      <div className="py-12 w-full max-w-lg mx-auto text-center font-mono">
        <div className="p-8 border border-[#24505F]/80 rounded-[4px] bg-[#0E2A35]/60 space-y-5">
          <div className="w-12 h-12 mx-auto bg-[#F2B880]/10 text-[#F2B880] rounded-full flex items-center justify-center text-xl font-serif">
            ⌛
          </div>
          <h2 className="text-xl font-serif font-normal text-[#D9ECF2]">
            Event Lost to Time
          </h2>
          <p className="text-xs text-[#8FB0BC] leading-relaxed max-w-sm mx-auto">
            The commitment or predictor profile requested does not exist on this timeline or has not been recorded on this network.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded bg-[#F2B880] text-[#0E2A35] hover:bg-[#E5A86D] transition-colors"
            >
              ← Return to Timeline Feed
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
