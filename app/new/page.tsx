import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import CommitForm from "@/components/hindsight/CommitForm";

export default function NewPredictionPage() {
  return (
    <PageShell
      title="Commit a prediction"
      description="Write your prediction in secret. It remains sealed until the reveal date you choose."
    >
      <BotChainGate noWalletNote="You need a connected wallet on BOT Chain to commit a sealed prediction.">
        <CommitForm />
      </BotChainGate>
    </PageShell>
  );
}
