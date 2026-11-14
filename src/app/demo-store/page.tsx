import type { Metadata } from "next";
import DemoStore from "@/components/DemoStore";

export const metadata: Metadata = {
  title: "Pip's Plushie Shop · Allpilot checkout demo",
  description: "A demo store taking payment with the Allpilot universal checkout: pay with any crypto, the shop receives NEAR.",
};

export default function DemoStorePage() {
  return <DemoStore />;
}
