import type { Metadata } from "next";
import { Suspense } from "react";
import WidgetBuilder from "@/components/WidgetBuilder";
import { Pip } from "@/components/Pip";

export const metadata: Metadata = {
  title: "Universal checkout widget · Allpilot",
  description: "Add a crypto checkout button to any website. Customers pay with any token on any chain; you receive exactly the amount via NEAR Intents.",
};

export default function CheckoutWidgetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 grid place-items-center">
          <Pip size={64} mood="think" className="bob" />
        </div>
      }
    >
      <WidgetBuilder />
    </Suspense>
  );
}
