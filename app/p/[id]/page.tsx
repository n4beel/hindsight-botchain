import PageShell from "@/components/layout/PageShell";
import PredictionTimeline from "@/components/hindsight/PredictionTimeline";

interface PredictionPageProps {
  params: Promise<{ id: string }>;
}

export default async function PredictionPage({ params }: PredictionPageProps) {
  const { id } = await params;
  let predictionId: bigint;
  try {
    predictionId = BigInt(id);
  } catch {
    return (
      <PageShell title="Prediction Not Found">
        <div className="p-6 text-center text-[#F28B82] font-mono">
          Invalid prediction identifier: {id}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PredictionTimeline id={predictionId} />
    </PageShell>
  );
}
