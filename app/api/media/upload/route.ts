import { NextResponse } from "next/server";

import { isR2Configured, putMedia } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isR2Configured()) {
    return NextResponse.json(
      { ok: false, error: "Cloudflare R2 nao configurado no servidor (defina as variaveis R2_*)." },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const fileEntry = form.get("file");
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;
  if (!file) {
    return NextResponse.json({ ok: false, error: "Nenhum arquivo enviado." }, { status: 400 });
  }

  try {
    const result = await putMedia(file);
    return NextResponse.json({
      ok: true,
      url: result.url,
      key: result.key,
      type: result.contentType.startsWith("image/") ? "image" : "video",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar arquivo para o R2.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
