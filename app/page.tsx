import { PulsePostApp } from "@/components/pulsepost-app";
import { getSecureConnectionSummaries } from "@/lib/social-env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const secureConnectionSummaries = getSecureConnectionSummaries();

  return <PulsePostApp secureConnectionSummaries={secureConnectionSummaries} />;
}
