import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pip } from "@/components/Pip";

type Props = { params: Promise<{ account: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { account } = await params;
  const image = `/api/pnl-card/${account}`;
  return {
    title: `${account}'s meme PnL · Allpilot`,
    description: "Meme trading profit & loss, rebuilt from on-chain swaps by Pip, the AI co-pilot for NEAR.",
    openGraph: { images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [image] },
  };
}

async function Card({ params }: Props) {
  const { account } = await params;
  // eslint-disable-next-line @next/next/no-img-element -- generated PNG
  return <img src={`/api/pnl-card/${account}`} alt={`${account}'s PnL card`} className="w-full rounded-3xl border-2 border-line shadow-lg" />;
}

export default function SharePnl({ params }: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex-1 flex flex-col items-center gap-5">
      <Link href="/" className="flex items-center gap-2">
        <Pip size={40} />
        <span className="text-xl font-bold">
          All<span className="text-pink">pilot</span>
        </span>
      </Link>
      <Suspense fallback={<div className="w-full aspect-[1200/630] rounded-3xl border-2 border-line bg-surface-2 animate-pulse" />}>
        <Card params={params} />
      </Suspense>
      <Link href="/" className="btn bg-pink text-white px-5 py-3">
        Track your own PnL with Pip ✈️
      </Link>
    </div>
  );
}
