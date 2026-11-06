import type { Metadata } from "next";
import { Suspense } from "react";
import Checkout from "@/components/Checkout";
import { Pip } from "@/components/Pip";

export const metadata: Metadata = {
  title: "Pay with Intents · Allpilot",
  description: "Pay with any token on any chain. The receiver gets exactly the amount, settled by NEAR Intents.",
};

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 grid place-items-center">
          <Pip size={64} mood="think" className="bob" />
        </div>
      }
    >
      <Checkout />
    </Suspense>
  );
}
