import { NextResponse } from "next/server";

import { getWoopStatus } from "@/lib/woopsocial";
import { isR2Configured } from "@/lib/r2";
import { isAiConfigured } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getWoopStatus();
  return NextResponse.json({ ...status, r2Configured: isR2Configured(), aiConfigured: isAiConfigured() });
}
