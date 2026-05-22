import { NextResponse } from "next/server";

import { getBundleStatus } from "@/lib/bundle-social";
import { isR2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getBundleStatus();
  return NextResponse.json({ ...status, r2Configured: isR2Configured() });
}
