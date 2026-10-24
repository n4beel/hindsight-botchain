import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import MyPredictions from "@/components/hindsight/MyPredictions";

export default function MyPredictionsPage() {
  return (
    <PageShell
      title="My Predictions"
      description="Track the status of your sealed predictions, reveals, and stored backup files."
    >
      <BotChainGate noWalletNote="Connect your wallet to review your commitments and reveal predictions when their window opens.">
        <MyPredictions />
      </BotChainGate>
    </PageShell>
  );
}
