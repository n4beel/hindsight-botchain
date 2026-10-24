import { isAddress, type Address } from "viem";
import PageShell from "@/components/layout/PageShell";
import AuthorRecord from "@/components/hindsight/AuthorRecord";

interface AuthorPageProps {
  params: Promise<{ address: string }>;
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { address } = await params;

  if (!isAddress(address)) {
    return (
      <PageShell title="Invalid Address">
        <div className="p-6 text-center text-[#F28B82] font-mono">
          &ldquo;{address}&rdquo; is not a valid Ethereum address.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <AuthorRecord address={address as Address} />
    </PageShell>
  );
}
