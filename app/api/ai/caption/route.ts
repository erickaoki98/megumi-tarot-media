import { NextResponse } from "next/server";

import { generateTarotCaption } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const result = await generateTarotCaption({
    title: String(body.title ?? "").trim(),
    theme: String(body.theme ?? "").trim(),
    baseCaption: String(body.baseCaption ?? "").trim(),
    network: String(body.network ?? "geral").trim(),
  });

  return NextResponse.json({ ok: true, caption: result.caption, ai: result.ai });
}
