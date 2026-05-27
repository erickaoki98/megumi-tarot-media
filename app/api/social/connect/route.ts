import { NextResponse } from "next/server";

import {
  createOAuthAuthorization,
  isWoopConfigured,
  networkToPlatform,
  resolveProjectId,
  WoopSocialError,
} from "@/lib/woopsocial";
import { NetworkKey } from "@/types/app";

export const dynamic = "force-dynamic";

const validNetworks: NetworkKey[] = ["instagram", "facebook", "youtube", "tiktok"];

export async function POST(request: Request) {
  if (!isWoopConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Integracao WoopSocial nao configurada (defina WOOPSOCIAL_API_KEY)." },
      { status: 400 },
    );
  }

  let payload: { network?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const network = payload.network as NetworkKey;
  if (!validNetworks.includes(network)) {
    return NextResponse.json({ ok: false, error: "Rede social invalida." }, { status: 400 });
  }

  try {
    const projectId = await resolveProjectId();
    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "Nenhum projeto WoopSocial encontrado. Defina WOOPSOCIAL_PROJECT_ID." },
        { status: 400 },
      );
    }

    const origin = request.headers.get("origin") || new URL(request.url).origin;
    const { url } = await createOAuthAuthorization({
      platform: networkToPlatform[network],
      projectId,
      redirectUrl: origin,
    });

    return NextResponse.json({ ok: true, url });
  } catch (error) {
    const status = error instanceof WoopSocialError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Falha ao gerar a URL de conexao.";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
