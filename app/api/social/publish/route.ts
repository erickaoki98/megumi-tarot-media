import { NextResponse } from "next/server";

import {
  createPost,
  isWoopConfigured,
  listSocialAccounts,
  networkToPlatform,
  resolveProjectId,
  uploadMediaBlob,
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const networks = form
    .getAll("networks")
    .map((value) => String(value))
    .filter((value): value is NetworkKey => validNetworks.includes(value as NetworkKey));

  if (!networks.length) {
    return NextResponse.json({ ok: false, error: "Selecione pelo menos uma rede social." }, { status: 400 });
  }

  const title = String(form.get("title") ?? "").trim();
  const caption = String(form.get("caption") ?? "").trim();
  const scheduledFor = String(form.get("scheduledFor") ?? "").trim();
  const schedule = String(form.get("mode") ?? "scheduled") !== "draft";
  const mediaUrl = String(form.get("mediaUrl") ?? "").trim();
  const mediaType = String(form.get("mediaType") ?? "").trim();
  const mediaFormat = String(form.get("mediaFormat") ?? "").trim();

  const fileEntry = form.get("file");
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

  if (!file && !mediaUrl) {
    return NextResponse.json(
      { ok: false, error: "Forneca um arquivo ou uma URL de midia para publicar via WoopSocial." },
      { status: 400 },
    );
  }

  try {
    const projectId = await resolveProjectId();
    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "Nenhum projeto WoopSocial encontrado. Defina WOOPSOCIAL_PROJECT_ID." },
        { status: 400 },
      );
    }

    const social = await listSocialAccounts(projectId);
    const accounts = networks.flatMap((network) => {
      const platform = networkToPlatform[network];
      const match = social.find((account) => account.platform.toUpperCase() === platform);
      return match ? [{ socialAccountId: match.id, platform }] : [];
    });

    if (!accounts.length) {
      return NextResponse.json(
        { ok: false, error: "Nenhuma das redes selecionadas esta conectada na WoopSocial. Conecte as contas na aba Config." },
        { status: 400 },
      );
    }

    // Resolve o blob da midia (arquivo enviado ou URL publica do R2) e envia ao WoopSocial.
    let blob: Blob;
    if (file) {
      blob = file;
    } else {
      const remote = await fetch(mediaUrl);
      if (!remote.ok) {
        return NextResponse.json({ ok: false, error: "Falha ao baixar a midia da URL informada." }, { status: 400 });
      }
      blob = await remote.blob();
    }

    const isImage = (blob.type || (file?.type ?? "")).startsWith("image/")
      ? true
      : mediaType
        ? mediaType === "image"
        : false;

    const media = await uploadMediaBlob(blob, projectId);

    const post = await createPost({
      title,
      caption,
      scheduledFor,
      mediaId: media.id,
      isImage,
      schedule,
      accounts,
      format: mediaFormat || undefined,
    });

    return NextResponse.json({ ok: true, postId: post.id, status: post.status });
  } catch (error) {
    const status = error instanceof WoopSocialError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Falha ao publicar no WoopSocial.";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
