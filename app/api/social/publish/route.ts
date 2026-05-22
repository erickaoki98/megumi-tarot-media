import { NextResponse } from "next/server";

import { BundleSocialError, createPost, isBundleConfigured, uploadFromUrl, uploadMedia } from "@/lib/bundle-social";
import { NetworkKey } from "@/types/app";

export const dynamic = "force-dynamic";

const validNetworks: NetworkKey[] = ["instagram", "facebook", "youtube", "tiktok"];

export async function POST(request: Request) {
  if (!isBundleConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Integracao bundle.social nao configurada (defina BUNDLE_SOCIAL_API_KEY e BUNDLE_SOCIAL_TEAM_ID)." },
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

  const fileEntry = form.get("file");
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

  if (!file && !mediaUrl) {
    return NextResponse.json(
      { ok: false, error: "Forneca um arquivo ou uma URL de midia para publicar via bundle.social." },
      { status: 400 },
    );
  }

  try {
    const upload = mediaUrl ? await uploadFromUrl(mediaUrl) : await uploadMedia(file as File);
    const uploadMime = upload.mime ?? upload.mimeType ?? "";
    const isImage = uploadMime
      ? uploadMime.startsWith("image/")
      : mediaType
        ? mediaType === "image"
        : (file?.type ?? "").startsWith("image/");

    const post = await createPost({
      title,
      caption,
      scheduledFor,
      networks,
      uploadIds: [upload.id],
      isImage,
      schedule,
    });

    return NextResponse.json({ ok: true, postId: post.id, status: post.status ?? (schedule ? "SCHEDULED" : "DRAFT") });
  } catch (error) {
    const status = error instanceof BundleSocialError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Falha ao publicar no bundle.social.";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
