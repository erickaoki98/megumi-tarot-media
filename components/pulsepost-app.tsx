"use client";

import { useEffect, useMemo, useState } from "react";
import { networkLabels, seedState, SESSION_STORAGE_KEY, STORAGE_KEY } from "@/lib/constants";
import { classNames, formatDate, formatNetworkList, getMediaHealth } from "@/lib/utils";
import {
  AppUser,
  FlashState,
  MediaItem,
  MediaStatus,
  NetworkKey,
  PersistedState,
  RepostRule,
  ScheduleItem,
  ViewKey,
} from "@/types/app";

type FiltersState = {
  mediaStatus: "all" | MediaStatus;
};

type DraftPreviewState = {
  name: string;
  type: MediaItem["type"];
  url: string;
};

type BundleClientStatus = {
  configured: boolean;
  hasApiKey: boolean;
  hasTeamId: boolean;
  accounts: Record<NetworkKey, { connected: boolean; username: string | null }>;
  error: string | null;
  r2Configured: boolean;
};

async function uploadFileToR2(file: File): Promise<{ url: string; type: MediaItem["type"] } | null> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/media/upload", { method: "POST", body: form });
  const result = await response.json();
  if (response.ok && result.ok) {
    return { url: result.url as string, type: result.type as MediaItem["type"] };
  }
  throw new Error(result.error ?? "Falha ao enviar arquivo para o R2.");
}

const defaultFilters: FiltersState = {
  mediaStatus: "all",
};

function loadState(): PersistedState {
  if (typeof window === "undefined") {
    return seedState;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seedState));
    return seedState;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<PersistedState>;
    return normalizeState(parsed);
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seedState));
    return seedState;
  }
}

function normalizeState(raw: Partial<PersistedState>): PersistedState {
  return {
    users: Array.isArray(raw.users) && raw.users.length ? raw.users : seedState.users,
    mediaLibrary: Array.isArray(raw.mediaLibrary) && raw.mediaLibrary.length ? raw.mediaLibrary : seedState.mediaLibrary,
    schedules: Array.isArray(raw.schedules) ? raw.schedules : seedState.schedules,
    repostRules: Array.isArray(raw.repostRules) ? raw.repostRules : seedState.repostRules,
    audit: Array.isArray(raw.audit) ? raw.audit : seedState.audit,
  };
}

function saveState(state: PersistedState) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function inferMediaTypeFromFile(file: File): MediaItem["type"] {
  return file.type.startsWith("image/") ? "image" : "video";
}

function buildMediaItem(params: {
  id: string;
  title: string;
  type: MediaItem["type"];
  format: string;
  duration: string;
  status: MediaStatus;
  category: string;
  fileName: string;
  url?: string | null;
}): MediaItem {
  return {
    id: params.id,
    title: params.title,
    type: params.type,
    format: params.format,
    duration: params.duration,
    status: params.status,
    category: params.category,
    fileName: params.fileName,
    url: params.url ?? null,
    createdAt: new Date().toISOString(),
    stats: {
      instagram: { views: 0, engagement: 0, score: 0 },
      facebook: { views: 0, engagement: 0, score: 0 },
      youtube: { views: 0, engagement: 0, score: 0 },
      tiktok: { views: 0, engagement: 0, score: 0 },
    },
  };
}

export function PulsePostApp() {
  const [data, setData] = useState<PersistedState>(seedState);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("scheduler");
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [flash, setFlash] = useState<FlashState>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [mediaFormPreview, setMediaFormPreview] = useState<DraftPreviewState | null>(null);
  const [scheduleFormPreview, setScheduleFormPreview] = useState<DraftPreviewState | null>(null);
  const [ephemeralMediaPreviews, setEphemeralMediaPreviews] = useState<Record<string, DraftPreviewState>>({});
  const [mediaFormKey, setMediaFormKey] = useState(0);
  const [scheduleFormKey, setScheduleFormKey] = useState(0);
  const [bundleStatus, setBundleStatus] = useState<BundleClientStatus | null>(null);
  const [publishingSchedule, setPublishingSchedule] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((status: BundleClientStatus | null) => {
        if (!cancelled) {
          setBundleStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBundleStatus(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextState = loadState();
    setData(nextState);
    const storedSessionUserId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (storedSessionUserId && nextState.users.some((user) => user.id === storedSessionUserId)) {
      setSessionUserId(storedSessionUserId);
    }
  }, []);

  useEffect(() => {
    if (!flash) {
      return;
    }

    const timer = window.setTimeout(() => setFlash(null), 3200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const pageTitle = pageTitleMap[activeView];
    document.title = `Megumi Tarot - Media Center${pageTitle ? ` - ${pageTitle}` : ""}`;
  }, [activeView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (sessionUserId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionUserId);
      return;
    }

    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }, [sessionUserId]);

  const currentUser = useMemo(
    () => data.users.find((user) => user.id === sessionUserId) ?? null,
    [data.users, sessionUserId],
  );

  const isAdmin = currentUser?.role === "admin";

  const suggestedRemovals = useMemo(
    () => data.mediaLibrary.filter((item) => getMediaHealth(item).underperforming),
    [data.mediaLibrary],
  );

  const filteredMedia = useMemo(
    () => data.mediaLibrary.filter((item) => (filters.mediaStatus === "all" ? true : item.status === filters.mediaStatus)),
    [data.mediaLibrary, filters.mediaStatus],
  );


  function persist(nextState: PersistedState, message?: string, kind: "success" | "error" = "success") {
    setData(nextState);
    saveState(nextState);
    if (message) {
      setFlash({ message, kind });
    }
  }

  function handleLogin(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const user = data.users.find((item) => item.email.toLowerCase() === email && item.password === password);

    if (!user) {
      setFlash({ message: "E-mail ou senha invalidos.", kind: "error" });
      return;
    }

    setSessionUserId(user.id);
    setActiveView("scheduler");
    setFlash({ message: `Sessao iniciada para ${user.name}.`, kind: "success" });
  }

  async function handleCreateMedia(formData: FormData) {
    const upload = formData.get("uploadFile");
    const uploadedFile = upload instanceof File && upload.size > 0 ? upload : null;
    const inferredType = uploadedFile ? inferMediaTypeFromFile(uploadedFile) : null;
    const nextItemId = randomId("media");
    const fileName = uploadedFile?.name || String(formData.get("fileName") ?? "").trim();

    if (!fileName) {
      setFlash({ message: "Envie um arquivo ou informe o nome do arquivo.", kind: "error" });
      return;
    }

    let storedUrl: string | null = null;
    if (uploadedFile) {
      try {
        const stored = await uploadFileToR2(uploadedFile);
        storedUrl = stored?.url ?? null;
      } catch (error) {
        setFlash({
          message: `Midia salva localmente, mas o upload para o R2 falhou: ${error instanceof Error ? error.message : "erro"}`,
          kind: "error",
        });
      }
    }

    const nextItem = buildMediaItem({
      id: nextItemId,
      title: String(formData.get("title") ?? "").trim(),
      type: inferredType ?? (String(formData.get("type") ?? "video") as MediaItem["type"]),
      format: String(formData.get("format") ?? "").trim(),
      duration: String(formData.get("duration") ?? "").trim() || (inferredType === "image" ? "Imagem" : "00:00"),
      status: String(formData.get("status") ?? "active") as MediaStatus,
      category: String(formData.get("category") ?? "").trim(),
      fileName,
      url: storedUrl,
    });

    if (uploadedFile && mediaFormPreview) {
      setEphemeralMediaPreviews((current) => ({
        ...current,
        [nextItemId]: mediaFormPreview,
      }));
    }

    persist(
      { ...data, mediaLibrary: [nextItem, ...data.mediaLibrary] },
      storedUrl ? "Midia enviada para o R2 e adicionada na biblioteca." : "Midia adicionada na biblioteca.",
    );
    setMediaFormPreview(null);
    setMediaFormKey((current) => current + 1);
  }

  async function handleCreateSchedule(formData: FormData) {
    const networks = formData.getAll("networks").map((item) => String(item) as NetworkKey);

    if (!networks.length) {
      setFlash({ message: "Selecione pelo menos uma rede social.", kind: "error" });
      return;
    }

    let mediaId = String(formData.get("mediaId") ?? "") || null;
    let resolvedMediaUrl: string | null = mediaId
      ? data.mediaLibrary.find((item) => item.id === mediaId)?.url ?? null
      : null;
    const upload = formData.get("scheduleUploadFile");
    const uploadedFile = upload instanceof File && upload.size > 0 ? upload : null;
    const manualMediaTitle = String(formData.get("manualMediaTitle") ?? "").trim();
    const manualCategory = String(formData.get("manualCategory") ?? "").trim();
    const manualFormat = String(formData.get("manualFormat") ?? "").trim();
    const manualDuration = String(formData.get("manualDuration") ?? "").trim();
    const manualStatus = String(formData.get("manualStatus") ?? "active") as MediaStatus;
    const manualFileName = uploadedFile?.name || String(formData.get("manualFileName") ?? "").trim();
    let nextMediaLibrary = data.mediaLibrary;

    if (!mediaId && (uploadedFile || manualMediaTitle || manualFileName)) {
      if (!manualMediaTitle) {
        setFlash({ message: "Informe um titulo para a midia manual do agendamento.", kind: "error" });
        return;
      }

      if (!manualFileName) {
        setFlash({ message: "Envie o arquivo da nova midia ou informe o nome do arquivo.", kind: "error" });
        return;
      }

      const nextItemId = randomId("media");
      const inferredType = uploadedFile ? inferMediaTypeFromFile(uploadedFile) : (String(formData.get("manualMediaType") ?? "video") as MediaItem["type"]);

      if (uploadedFile) {
        try {
          const stored = await uploadFileToR2(uploadedFile);
          resolvedMediaUrl = stored?.url ?? null;
        } catch (error) {
          setFlash({
            message: `Upload para o R2 falhou: ${error instanceof Error ? error.message : "erro"}`,
            kind: "error",
          });
        }
      }

      const nextMediaItem = buildMediaItem({
        id: nextItemId,
        title: manualMediaTitle,
        type: inferredType,
        format: manualFormat || "Post manual",
        duration: manualDuration || (inferredType === "image" ? "Imagem" : "00:00"),
        status: manualStatus,
        category: manualCategory || "Agendamento manual",
        fileName: manualFileName,
        url: resolvedMediaUrl,
      });

      nextMediaLibrary = [nextMediaItem, ...data.mediaLibrary];
      mediaId = nextItemId;

      if (uploadedFile && scheduleFormPreview) {
        setEphemeralMediaPreviews((current) => ({
          ...current,
          [nextItemId]: scheduleFormPreview,
        }));
      }
    }

    const scheduledFor = String(formData.get("scheduledFor") ?? "");
    const caption = String(formData.get("caption") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const bundleMode = String(formData.get("bundleMode") ?? "off");

    const nextSchedule: ScheduleItem = {
      id: randomId("schedule"),
      title,
      mediaId,
      networks,
      scheduledFor,
      caption,
      status: "scheduled",
      repostRuleId: String(formData.get("repostRuleId") ?? "") || null,
      bundlePostId: null,
      bundleStatus: null,
    };

    const baseState = { ...data, mediaLibrary: nextMediaLibrary, schedules: [nextSchedule, ...data.schedules] };
    persist(baseState, "Agendamento criado.");
    setScheduleFormPreview(null);

    if (bundleMode !== "off") {
      if (!resolvedMediaUrl && !uploadedFile) {
        setFlash({ message: "Anexe um arquivo ou use uma midia ja enviada ao R2 para publicar.", kind: "error" });
      } else {
        setPublishingSchedule(true);
        const publishForm = new FormData();
        publishForm.set("title", title || "Post");
        publishForm.set("caption", caption);
        publishForm.set("scheduledFor", scheduledFor);
        publishForm.set("mode", bundleMode);
        if (resolvedMediaUrl) {
          publishForm.set("mediaUrl", resolvedMediaUrl);
        } else if (uploadedFile) {
          publishForm.set("file", uploadedFile);
        }
        networks.forEach((network) => publishForm.append("networks", network));

        try {
          const response = await fetch("/api/social/publish", { method: "POST", body: publishForm });
          const result = await response.json();
          if (response.ok && result.ok) {
            updateScheduleBundleResult(baseState, nextSchedule.id, {
              bundlePostId: result.postId ?? null,
              bundleStatus: result.status === "DRAFT" ? "DRAFT" : "SCHEDULED",
            });
            setFlash({
              message: result.status === "DRAFT" ? "Rascunho criado no bundle.social." : "Post enviado e agendado no bundle.social.",
              kind: "success",
            });
          } else {
            updateScheduleBundleResult(baseState, nextSchedule.id, { bundlePostId: null, bundleStatus: "error" });
            setFlash({ message: `Falha no bundle.social: ${result.error ?? "erro desconhecido"}`, kind: "error" });
          }
        } catch {
          updateScheduleBundleResult(baseState, nextSchedule.id, { bundlePostId: null, bundleStatus: "error" });
          setFlash({ message: "Nao foi possivel contatar a API do bundle.social.", kind: "error" });
        } finally {
          setPublishingSchedule(false);
        }
      }
    }

    setScheduleFormKey((current) => current + 1);
  }

  async function publishExistingSchedule(schedule: ScheduleItem, mode: "scheduled" | "draft" = "scheduled") {
    const media = schedule.mediaId ? data.mediaLibrary.find((item) => item.id === schedule.mediaId) : null;
    if (!media?.url) {
      setFlash({ message: "Esta midia nao possui arquivo no R2. Reenvie o arquivo para publicar.", kind: "error" });
      return;
    }

    setPublishingSchedule(true);
    const publishForm = new FormData();
    publishForm.set("title", schedule.title || "Post");
    publishForm.set("caption", schedule.caption);
    publishForm.set("scheduledFor", schedule.scheduledFor);
    publishForm.set("mode", mode);
    publishForm.set("mediaUrl", media.url);
    publishForm.set("mediaType", media.type);
    schedule.networks.forEach((network) => publishForm.append("networks", network));

    try {
      const response = await fetch("/api/social/publish", { method: "POST", body: publishForm });
      const result = await response.json();
      const nextState = {
        ...data,
        schedules: data.schedules.map((item) =>
          item.id === schedule.id
            ? {
                ...item,
                bundlePostId: response.ok && result.ok ? result.postId ?? null : null,
                bundleStatus: (response.ok && result.ok ? (result.status === "DRAFT" ? "DRAFT" : "SCHEDULED") : "error") as ScheduleItem["bundleStatus"],
              }
            : item,
        ),
      };
      persist(
        nextState,
        response.ok && result.ok
          ? "Agendamento publicado no bundle.social."
          : `Falha no bundle.social: ${result.error ?? "erro desconhecido"}`,
        response.ok && result.ok ? "success" : "error",
      );
    } catch {
      setFlash({ message: "Nao foi possivel contatar a API do bundle.social.", kind: "error" });
    } finally {
      setPublishingSchedule(false);
    }
  }

  function updateScheduleBundleResult(
    fromState: PersistedState,
    scheduleId: string,
    patch: Pick<ScheduleItem, "bundlePostId" | "bundleStatus">,
  ) {
    const nextState = {
      ...fromState,
      schedules: fromState.schedules.map((schedule) =>
        schedule.id === scheduleId ? { ...schedule, ...patch } : schedule,
      ),
    };
    persist(nextState);
  }

  function handleCreateRule(formData: FormData) {
    const networks = formData.getAll("ruleNetworks").map((item) => String(item) as NetworkKey);

    if (!networks.length) {
      setFlash({ message: "Escolha ao menos uma rede para a regra.", kind: "error" });
      return;
    }

    const nextRule: RepostRule = {
      id: randomId("rule"),
      name: String(formData.get("name") ?? "").trim(),
      minScore: Number(formData.get("minScore") ?? 0),
      removeBelowScore: Number(formData.get("removeBelowScore") ?? 0),
      intervalDays: Number(formData.get("intervalDays") ?? 0),
      maxReposts: Number(formData.get("maxReposts") ?? 0),
      networks,
      active: true,
    };

    persist({ ...data, repostRules: [nextRule, ...data.repostRules] }, "Regra salva.");
  }

  function handleCreateUser(formData: FormData) {
    if (!isAdmin) {
      setFlash({ message: "Somente administradores podem criar usuarios.", kind: "error" });
      return;
    }

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const exists = data.users.some((user) => user.email.toLowerCase() === email);
    if (exists) {
      setFlash({ message: "Ja existe um usuario com esse e-mail.", kind: "error" });
      return;
    }

    const nextUser: AppUser = {
      id: randomId("user"),
      name: String(formData.get("name") ?? "").trim(),
      email,
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "editor") as AppUser["role"],
      createdAt: new Date().toISOString(),
    };

    persist({ ...data, users: [nextUser, ...data.users] }, "Usuario criado.");
  }

  function handleUpdateUser(userId: string, formData: FormData) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const duplicate = data.users.some((user) => user.id !== userId && user.email.toLowerCase() === email);

    if (duplicate) {
      setFlash({ message: "Outro usuario ja usa esse e-mail.", kind: "error" });
      return;
    }

    const nextUsers = data.users.map((user) =>
      user.id === userId
        ? {
            ...user,
            name: String(formData.get("name") ?? "").trim(),
            email,
            password: String(formData.get("password") ?? ""),
            role: String(formData.get("role") ?? user.role) as AppUser["role"],
          }
        : user,
    );

    persist({ ...data, users: nextUsers }, "Usuario atualizado.");
    setEditingUserId(null);
  }

  function deleteUser(userId: string) {
    if (!isAdmin) {
      setFlash({ message: "Somente administradores podem remover usuarios.", kind: "error" });
      return;
    }

    const user = data.users.find((item) => item.id === userId);
    if (!user) {
      return;
    }

    const adminCount = data.users.filter((item) => item.role === "admin").length;
    if (user.role === "admin" && adminCount === 1) {
      setFlash({ message: "O ultimo admin nao pode ser removido.", kind: "error" });
      return;
    }

    if (user.id === sessionUserId) {
      setFlash({ message: "Nao e possivel remover o usuario em uso.", kind: "error" });
      return;
    }

    persist({ ...data, users: data.users.filter((item) => item.id !== userId) }, "Usuario removido.");
  }

  function removeMedia(id: string) {
    const media = data.mediaLibrary.find((item) => item.id === id);
    if (!media) {
      setFlash({ message: "Midia nao encontrada.", kind: "error" });
      return;
    }

    persist(
      {
        ...data,
        mediaLibrary: data.mediaLibrary.filter((item) => item.id !== id),
        schedules: data.schedules.map((schedule) => (schedule.mediaId === id ? { ...schedule, mediaId: null } : schedule)),
      },
      `Midia "${media.title}" removida.`,
    );
  }

  function refreshStats(id: string) {
    const nextState: PersistedState = {
      ...data,
      mediaLibrary: data.mediaLibrary.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const nextStats = { ...item.stats };
        (Object.keys(nextStats) as NetworkKey[]).forEach((network) => {
          const current = nextStats[network];
          const views = Math.max(0, current.views + Math.round((Math.random() - 0.15) * 2400));
          const engagement = Math.max(0, Number((current.engagement + (Math.random() - 0.4) * 1.8).toFixed(1)));
          const score = Math.max(0, Math.min(100, Math.round(views / 350 + engagement * 7)));
          nextStats[network] = { views, engagement, score };
        });

        return { ...item, stats: nextStats };
      }),
    };

    persist(nextState, "Estatisticas atualizadas.");
  }

  function getLinkedMediaTitle(mediaId: string | null) {
    return data.mediaLibrary.find((item) => item.id === mediaId)?.title ?? "Midia nao vinculada";
  }

  function scheduleHasStoredMedia(schedule: ScheduleItem) {
    if (!schedule.mediaId) {
      return false;
    }
    return Boolean(data.mediaLibrary.find((item) => item.id === schedule.mediaId)?.url);
  }

  if (!currentUser) {
    return (
      <main className="min-h-screen px-4 py-6 md:px-6">
        <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] border border-violet/10 bg-white/70 p-8 shadow-panel backdrop-blur md:p-12">
            <div className="inline-flex items-center gap-4">
              <LogoMark />
              <div>
                <div className="text-sm uppercase tracking-[0.26em] text-violet/80">Megumi Tarot</div>
                <div className="mt-1 font-display text-2xl tracking-[-0.04em]">Media Center</div>
              </div>
            </div>
            <h1 className="mt-10 max-w-[10ch] font-display text-5xl leading-[0.92] tracking-[-0.04em] md:text-7xl">
              Conteudo bem guiado, visual e pronto para publicar.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink/65">
              Um painel mais calmo e intuitivo para organizar midias, publicar em varias redes e configurar conexoes
              de API sem ruido visual.
            </p>

            <div className="mt-10 grid gap-4">
              <IllustrationRow
                icon={<HeartPlayIcon className="size-5 text-violet" />}
                title="Publicacao multicanal"
                description="Organize uma mesma campanha para Instagram, Facebook, YouTube Shorts e TikTok."
              />
              <IllustrationRow
                icon={<LibraryIcon className="size-5 text-violet" />}
                title="Biblioteca central"
                description="Fotos e videos ficam reunidos em um fluxo mais limpo para selecionar, revisar e publicar."
              />
              <IllustrationRow
                icon={<ConnectionIcon className="size-5 text-violet" />}
                title="Conexoes de API"
                description="A area de configuracao concentra tokens, chaves, webhooks e status por rede."
              />
            </div>
          </section>

          <section className="rounded-[2rem] border border-violet/10 bg-white/88 p-8 shadow-panel backdrop-blur md:p-10">
            <div className="text-sm uppercase tracking-[0.26em] text-violet/80">Entrar</div>
            <h2 className="mt-4 font-display text-4xl tracking-[-0.04em]">Megumi Tarot - Media Center</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-ink/60">
              Entre com as credenciais da sua operacao para abrir o painel administrativo.
            </p>

            {flash ? <FlashBanner flash={flash} className="mt-6" /> : null}

            <form
              className="mt-8 grid gap-4"
              action={(formData) => {
                handleLogin(formData);
              }}
            >
              <Field label="E-mail" name="email" type="email" placeholder="seuemail@empresa.com" />
              <Field label="Senha" name="password" type="password" placeholder="Digite sua senha" />
              <button className="mt-2 rounded-full bg-violet px-5 py-3 font-medium text-white shadow-lg shadow-violet/20">
                Acessar painel
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[2rem] border border-violet/10 bg-white/80 shadow-panel backdrop-blur">
          <header className="flex flex-col gap-5 border-b border-violet/10 px-5 py-5 md:px-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <LogoMark compact />
              <div>
                <div className="text-sm uppercase tracking-[0.26em] text-violet/80">Megumi Tarot</div>
                <h1 className="mt-1 font-display text-3xl tracking-[-0.04em] md:text-4xl">Media Center</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-violet/10 bg-violet/5 px-4 py-2 text-sm text-ink/70">
                {currentUser.name} · {currentUser.role}
              </div>
              <button
                type="button"
                className="rounded-full border border-violet/15 px-4 py-2 text-sm font-medium text-violet"
                onClick={() => setActiveView("config")}
              >
                Config
              </button>
              <button
                type="button"
                className="rounded-full bg-violet px-4 py-2 text-sm font-medium text-white"
                onClick={() => {
                  setSessionUserId(null);
                  setActiveView("scheduler");
                  setFlash({ message: "Sessao encerrada.", kind: "success" });
                }}
              >
                Sair
              </button>
            </div>
          </header>

          <div className="border-b border-violet/10 px-5 py-4 md:px-8">
            <nav className="flex flex-wrap gap-2">
                {[
                  { key: "library", label: "Biblioteca" },
                  { key: "scheduler", label: "Agendamentos" },
                  { key: "reposts", label: "Repostagem" },
                  { key: "users", label: "Usuarios" },
                  { key: "config", label: "Config" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveView(item.key as ViewKey)}
                    className={classNames(
                      "rounded-full px-4 py-2.5 text-sm transition",
                      activeView === item.key ? "bg-violet text-white shadow-lg shadow-violet/15" : "bg-violet/5 text-ink/65 hover:bg-violet/10",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <NavIcon view={item.key as ViewKey} />
                      {item.label}
                    </span>
                  </button>
                ))}
            </nav>
          </div>

          <section className="grid gap-6 p-5 md:p-8">
              {flash ? <FlashBanner flash={flash} /> : null}

              <ViewHeader
                title={viewMeta[activeView].title}
                description={viewMeta[activeView].description}
                actionLabel={viewMeta[activeView].actionLabel}
                onAction={viewMeta[activeView].onAction(setActiveView)}
              />

              {activeView === "library" ? (
                <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card title="Nova midia" description="Adicione fotos e videos para uso em varias redes.">
                    <FormGrid key={mediaFormKey} action={handleCreateMedia}>
                      <Field label="Titulo" name="title" placeholder="Ex: video da semana" />
                      <label className="grid gap-2 text-sm font-medium">
                        <span className="text-ink/75">Upload do arquivo</span>
                        <input
                          name="uploadFile"
                          type="file"
                          accept="video/*,image/*"
                          className="rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 text-sm outline-none transition file:mr-4 file:rounded-full file:border-0 file:bg-violet file:px-4 file:py-2 file:text-white focus:border-violet focus:bg-white"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (!file) {
                              setMediaFormPreview(null);
                              return;
                            }

                            setMediaFormPreview({
                              name: file.name,
                              type: inferMediaTypeFromFile(file),
                              url: URL.createObjectURL(file),
                            });
                          }}
                        />
                      </label>
                      <AssetPreview preview={mediaFormPreview} title="Preview da nova midia" />
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Arquivo (opcional se houver upload)" name="fileName" placeholder="video.mp4" required={false} />
                        <Field label="Categoria" name="category" placeholder="Campanha" />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <SelectField
                          label="Tipo"
                          name="type"
                          options={[
                            { label: "Video", value: "video" },
                            { label: "Imagem", value: "image" },
                          ]}
                        />
                        <Field label="Formato" name="format" placeholder="Reel / Story" />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Duracao" name="duration" placeholder="00:30 ou Imagem" />
                        <SelectField
                          label="Status"
                          name="status"
                          options={[
                            { label: "Ativa", value: "active" },
                            { label: "Revisao", value: "review" },
                            { label: "Arquivada", value: "archived" },
                          ]}
                        />
                      </div>
                      <PrimaryButton label="Salvar midia" />
                    </FormGrid>
                  </Card>

                  <Card title="Biblioteca" description="Visual limpo para filtrar, revisar e remover ativos.">
                    <div className="mb-5 flex flex-wrap gap-2">
                      {[
                        { label: "Todos", value: "all" },
                        { label: "Ativas", value: "active" },
                        { label: "Revisao", value: "review" },
                        { label: "Arquivadas", value: "archived" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            setFilters((current) => ({
                              ...current,
                              mediaStatus: option.value as FiltersState["mediaStatus"],
                            }))
                          }
                          className={classNames(
                            "rounded-full px-4 py-2 text-sm",
                            filters.mediaStatus === option.value ? "bg-violet text-white" : "bg-violet/6 text-ink/70",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-3">
                      {filteredMedia.map((item) => {
                        const health = getMediaHealth(item);
                        const preview = ephemeralMediaPreviews[item.id] ?? null;
                        return (
                          <article key={item.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                            {preview ? (
                              <div className="mb-4 overflow-hidden rounded-[1rem] border border-violet/10 bg-violet/4">
                                {preview.type === "video" ? (
                                  <video controls className="max-h-72 w-full bg-black/80" src={preview.url} />
                                ) : (
                                  <img src={preview.url} alt={item.title} className="max-h-72 w-full object-cover" />
                                )}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="font-medium">{item.title}</h3>
                                <p className="mt-1 text-sm text-ink/55">
                                  {item.fileName} · {item.format} · {item.category}
                                </p>
                              </div>
                              <span className="rounded-full bg-violet/8 px-3 py-1 text-xs text-violet">{item.status}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(Object.keys(item.stats) as NetworkKey[])
                                .filter((network) => item.stats[network].views > 0)
                                .map((network) => (
                                  <span
                                    key={network}
                                    className={classNames(
                                      "rounded-full px-3 py-1 text-xs",
                                      item.stats[network].score < 35 ? "bg-rose-100 text-rose-700" : "bg-violet/8 text-violet",
                                    )}
                                  >
                                    {networkLabels[network]} {item.stats[network].score}/100
                                  </span>
                                ))}
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                                media {health.average}/100
                              </span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <SecondaryButton label="Atualizar estatisticas" onClick={() => refreshStats(item.id)} />
                              <GhostDangerButton label="Remover" onClick={() => removeMedia(item.id)} />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </Card>
                </section>
              ) : null}

              {activeView === "scheduler" ? (
                <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card title="Novo agendamento" description="Programe uma postagem para varias redes ao mesmo tempo.">
                    <FormGrid key={scheduleFormKey} action={handleCreateSchedule}>
                      <Field label="Titulo interno" name="title" placeholder="Lote de domingo" />
                      <SelectField
                        label="Midia"
                        name="mediaId"
                        options={[
                          { label: "Sem vinculo", value: "" },
                          ...data.mediaLibrary.map((item) => ({ label: item.title, value: item.id })),
                        ]}
                      />
                      <div className="rounded-[1.25rem] border border-violet/10 bg-violet/4 p-4">
                        <div className="mb-4">
                          <h4 className="font-medium text-ink">Adicionar nova midia neste agendamento</h4>
                          <p className="mt-1 text-sm text-ink/55">
                            Se voce nao selecionar uma midia existente, pode cadastrar uma nova aqui. Ao salvar, ela entra automaticamente na biblioteca.
                          </p>
                        </div>
                        <div className="grid gap-4">
                          <label className="grid gap-2 text-sm font-medium">
                            <span className="text-ink/75">Upload do arquivo</span>
                            <input
                              name="scheduleUploadFile"
                              type="file"
                              accept="video/*,image/*"
                              className="rounded-2xl border border-violet/12 bg-white px-4 py-3 text-sm outline-none transition file:mr-4 file:rounded-full file:border-0 file:bg-violet file:px-4 file:py-2 file:text-white focus:border-violet"
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (!file) {
                                  setScheduleFormPreview(null);
                                  return;
                                }

                                setScheduleFormPreview({
                                  name: file.name,
                                  type: inferMediaTypeFromFile(file),
                                  url: URL.createObjectURL(file),
                                });
                              }}
                            />
                          </label>
                          <AssetPreview preview={scheduleFormPreview} title="Preview da nova midia do agendamento" />
                          <Field label="Titulo da nova midia" name="manualMediaTitle" placeholder="Ex: video exclusivo do post" required={false} />
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Arquivo (opcional se houver upload)" name="manualFileName" placeholder="video-curto.mp4" required={false} />
                            <Field label="Categoria" name="manualCategory" placeholder="Agendamento manual" required={false} />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <SelectField
                              label="Tipo"
                              name="manualMediaType"
                              options={[
                                { label: "Video", value: "video" },
                                { label: "Imagem", value: "image" },
                              ]}
                            />
                            <Field label="Formato" name="manualFormat" placeholder="Short / Reel / Feed" required={false} />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Duracao" name="manualDuration" placeholder="00:30 ou Imagem" required={false} />
                            <SelectField
                              label="Status na biblioteca"
                              name="manualStatus"
                              options={[
                                { label: "Ativa", value: "active" },
                                { label: "Revisao", value: "review" },
                                { label: "Arquivada", value: "archived" },
                              ]}
                            />
                          </div>
                        </div>
                      </div>
                      <CheckGrid legend="Redes">
                        {(Object.keys(networkLabels) as NetworkKey[]).map((network) => (
                          <CheckCard key={network} name="networks" value={network} label={networkLabels[network]} />
                        ))}
                      </CheckGrid>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Data e hora" name="scheduledFor" type="datetime-local" />
                        <SelectField
                          label="Regra de repost"
                          name="repostRuleId"
                          options={[
                            { label: "Sem regra", value: "" },
                            ...data.repostRules.map((rule) => ({ label: rule.name, value: rule.id })),
                          ]}
                        />
                      </div>
                      <Field label="Legenda base" name="caption" placeholder="Legenda adaptavel por rede" />
                      <div className="rounded-[1.25rem] border border-violet/10 bg-violet/4 p-4">
                        <SelectField
                          label="Publicacao via bundle.social"
                          name="bundleMode"
                          options={[
                            { label: "Somente local (nao enviar)", value: "off" },
                            { label: "Agendar no bundle.social", value: "scheduled" },
                            { label: "Salvar como rascunho", value: "draft" },
                          ]}
                        />
                        <p className="mt-2 text-xs text-ink/55">
                          {bundleStatus?.configured
                            ? bundleStatus.r2Configured
                              ? "O arquivo anexado e enviado ao Cloudflare R2 e publicado via bundle.social. Voce tambem pode publicar agendamentos existentes pela fila ao lado."
                              : "Anexe o arquivo de midia acima. (R2 nao configurado: o arquivo sera enviado direto, sem armazenamento permanente.)"
                            : "Integracao bundle.social nao configurada. Defina BUNDLE_SOCIAL_API_KEY e BUNDLE_SOCIAL_TEAM_ID no servidor."}
                        </p>
                      </div>
                      <PrimaryButton label={publishingSchedule ? "Enviando..." : "Salvar agendamento"} />
                    </FormGrid>
                  </Card>

                  <Card title="Fila programada" description="Timeline clara dos proximos disparos.">
                    <div className="grid gap-3">
                      {[...data.schedules]
                        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                        .map((schedule) => (
                          <article key={schedule.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="font-medium">{schedule.title}</h3>
                                <p className="mt-1 text-sm text-ink/55">{formatNetworkList(schedule.networks)}</p>
                              </div>
                              <span className="text-sm text-violet">{formatDate(schedule.scheduledFor)}</span>
                            </div>
                            <p className="mt-3 text-sm text-ink/60">Midia: {getLinkedMediaTitle(schedule.mediaId)}</p>
                            <p className="mt-1 text-sm text-ink/60">{schedule.caption}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              {schedule.bundleStatus ? (
                                <span
                                  className={classNames(
                                    "inline-flex rounded-full px-3 py-1 text-xs",
                                    schedule.bundleStatus === "error"
                                      ? "bg-rose-100 text-rose-700"
                                      : "bg-emerald-100 text-emerald-700",
                                  )}
                                >
                                  {schedule.bundleStatus === "error"
                                    ? "Falha no bundle.social"
                                    : schedule.bundleStatus === "DRAFT"
                                      ? "Rascunho no bundle.social"
                                      : "Agendado no bundle.social"}
                                </span>
                              ) : null}
                              {scheduleHasStoredMedia(schedule) && bundleStatus?.configured ? (
                                <SecondaryButton
                                  label={publishingSchedule ? "Enviando..." : "Publicar no bundle.social"}
                                  onClick={() => publishExistingSchedule(schedule)}
                                />
                              ) : null}
                            </div>
                          </article>
                        ))}
                    </div>
                  </Card>
                </section>
              ) : null}

              {activeView === "reposts" ? (
                <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card title="Nova regra de repostagem" description="Defina como o algoritmo deve reciclar ou cortar conteudos.">
                    <FormGrid action={handleCreateRule}>
                      <Field label="Nome da regra" name="name" placeholder="Repostar melhores clips" />
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Score minimo" name="minScore" type="number" defaultValue="70" />
                        <Field label="Score para remocao" name="removeBelowScore" type="number" defaultValue="35" />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Intervalo em dias" name="intervalDays" type="number" defaultValue="14" />
                        <Field label="Maximo de reposts" name="maxReposts" type="number" defaultValue="3" />
                      </div>
                      <CheckGrid legend="Redes consideradas">
                        {(Object.keys(networkLabels) as NetworkKey[]).map((network) => (
                          <CheckCard key={network} name="ruleNetworks" value={network} label={networkLabels[network]} />
                        ))}
                      </CheckGrid>
                      <PrimaryButton label="Salvar regra" />
                    </FormGrid>
                  </Card>

                  <div className="grid gap-5">
                    <Card title="Regras ativas" description="Visualizacao rapida das automatizacoes de repost.">
                      <div className="grid gap-3">
                        {data.repostRules.map((rule) => (
                          <article key={rule.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="font-medium">{rule.name}</h3>
                              <span className={classNames("rounded-full px-3 py-1 text-xs", rule.active ? "bg-violet/8 text-violet" : "bg-slate-100 text-slate-600")}>
                                {rule.active ? "ativa" : "pausada"}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-1 text-sm text-ink/60">
                              <span>Reposta acima de {rule.minScore}/100</span>
                              <span>Remove abaixo de {rule.removeBelowScore}/100</span>
                              <span>{rule.intervalDays} dias · max {rule.maxReposts} reposts</span>
                              <span>{formatNetworkList(rule.networks)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </Card>

                    <Card title="Itens para revisar" description="Baixa performance identificada nas estatisticas atuais.">
                      <div className="grid gap-3">
                        {suggestedRemovals.map((item) => {
                          const health = getMediaHealth(item);
                          return (
                            <article key={item.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                              <h3 className="font-medium">{item.title}</h3>
                              <p className="mt-2 text-sm text-ink/60">Media {health.average}/100 · pior score {health.weakest}/100</p>
                              <div className="mt-3">
                                <GhostDangerButton label="Remover da biblioteca" onClick={() => removeMedia(item.id)} />
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </Card>
                  </div>
                </section>
              ) : null}

              {activeView === "users" ? (
                <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                  <Card title="Novo usuario" description="Admins podem criar novos acessos para a operacao.">
                    <FormGrid action={handleCreateUser}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Nome" name="name" placeholder="Nome completo" />
                        <SelectField
                          label="Perfil"
                          name="role"
                          options={[
                            { label: "Editor", value: "editor" },
                            { label: "Admin", value: "admin" },
                          ]}
                        />
                      </div>
                      <Field label="E-mail" name="email" type="email" placeholder="usuario@empresa.com" />
                      <Field label="Senha" name="password" type="text" placeholder="Defina a senha inicial" />
                      <PrimaryButton label="Criar usuario" />
                    </FormGrid>
                  </Card>

                  <Card title="Gerenciar usuarios" description="Edite nome, e-mail, senha e papel sem sair do painel.">
                    <div className="grid gap-3">
                      {data.users.map((user) => (
                        <article key={user.id} className="rounded-[1.25rem] border border-violet/10 p-4">
                          {editingUserId === user.id ? (
                            <form
                              className="grid gap-4"
                              action={(formData) => {
                                handleUpdateUser(user.id, formData);
                              }}
                            >
                              <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Nome" name="name" defaultValue={user.name} />
                                <SelectField
                                  label="Perfil"
                                  name="role"
                                  defaultValue={user.role}
                                  options={[
                                    { label: "Editor", value: "editor" },
                                    { label: "Admin", value: "admin" },
                                  ]}
                                />
                              </div>
                              <Field label="E-mail" name="email" type="email" defaultValue={user.email} />
                              <Field label="Senha" name="password" type="text" defaultValue={user.password} />
                              <div className="flex flex-wrap gap-3">
                                <PrimaryButton label="Salvar alteracoes" />
                                <SecondaryButton label="Cancelar" onClick={() => setEditingUserId(null)} type="button" />
                              </div>
                            </form>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h3 className="font-medium">{user.name}</h3>
                                  <p className="mt-1 text-sm text-ink/55">{user.email}</p>
                                </div>
                                <span className="rounded-full bg-violet/8 px-3 py-1 text-xs text-violet">{user.role}</span>
                              </div>
                              <p className="mt-3 text-sm text-ink/50">Criado em {formatDate(user.createdAt)}</p>
                              <div className="mt-4 flex flex-wrap gap-3">
                                <SecondaryButton label="Editar" onClick={() => setEditingUserId(user.id)} />
                                <GhostDangerButton label="Remover" onClick={() => deleteUser(user.id)} />
                              </div>
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                  </Card>
                </section>
              ) : null}

              {activeView === "config" ? (
                <section className="grid gap-5">
                  <Card title="Publicacao via bundle.social" description="Integracao real de publicacao. O bundle.social cuida do OAuth e da entrega para cada rede; aqui basta uma API key e o team.">
                    <div
                      className={classNames(
                        "mb-5 rounded-[1.25rem] border px-4 py-4 text-sm leading-6",
                        bundleStatus?.configured
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-amber-200 bg-amber-50 text-amber-900",
                      )}
                    >
                      {bundleStatus === null
                        ? "Verificando configuracao do bundle.social..."
                        : bundleStatus.configured
                          ? bundleStatus.error
                            ? `Chave configurada, mas houve erro ao consultar contas: ${bundleStatus.error}`
                            : "API key e team configurados. As contas conectadas aparecem abaixo."
                          : "Defina BUNDLE_SOCIAL_API_KEY e BUNDLE_SOCIAL_TEAM_ID no ambiente do servidor (Vercel) e faca um novo deploy."}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(Object.keys(networkLabels) as NetworkKey[]).map((network) => {
                        const account = bundleStatus?.accounts?.[network];
                        const connected = Boolean(account?.connected);
                        return (
                          <div key={network} className="flex items-center justify-between rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                            <div>
                              <div className="text-sm font-medium text-ink">{networkLabels[network]}</div>
                              <div className="mt-1 text-xs text-ink/55">{account?.username ? `@${account.username}` : "conta nao conectada"}</div>
                            </div>
                            <StatusPill status={connected ? "connected" : "pending"} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-ink/60">
                      <div className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                        <span className="font-mono text-xs text-violet">BUNDLE_SOCIAL_API_KEY</span>
                        <span className="ml-2 text-xs">{bundleStatus?.hasApiKey ? "configurada" : "pendente"}</span>
                      </div>
                      <div className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                        <span className="font-mono text-xs text-violet">BUNDLE_SOCIAL_TEAM_ID</span>
                        <span className="ml-2 text-xs">{bundleStatus?.hasTeamId ? "configurado" : "pendente"}</span>
                      </div>
                      <div className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                        <span className="font-mono text-xs text-violet">Cloudflare R2 (R2_*)</span>
                        <span className="ml-2 text-xs">{bundleStatus?.r2Configured ? "configurado" : "pendente"}</span>
                      </div>
                      <p className="text-xs text-ink/50">
                        Conecte as contas em app.bundle.social (ou via portal link) e configure as variaveis acima. As midias enviadas vao para o Cloudflare R2, e a publicacao acontece na aba Agendamentos.
                      </p>
                    </div>
                  </Card>

                  <Card title="Como conectar as contas" description="As contas sao conectadas direto no bundle.social, que cuida de todo o OAuth e da entrega para cada rede.">
                    <div className="grid gap-3 text-sm leading-6 text-ink/60">
                      <p>Autorize Instagram, Facebook, YouTube e TikTok pelo portal de conexao do bundle.social (gerado no painel deles ou por link). O status de cada conta aparece no card acima.</p>
                      <p>Nao e mais necessario preencher segredos por rede aqui: a publicacao usa somente a API key do bundle.social e o team, configurados em variaveis de ambiente no servidor.</p>
                      <p>As midias enviadas ficam no Cloudflare R2; ao publicar, a URL e enviada ao bundle.social. Faca os envios e agendamentos pela aba Agendamentos.</p>
                    </div>
                  </Card>
                </section>
              ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

const viewMeta: Record<
  ViewKey,
  {
    title: string;
    description: string;
    actionLabel: string;
    onAction: (setActiveView: (view: ViewKey) => void) => (() => void) | undefined;
  }
> = {
  library: {
    title: "Biblioteca",
    description: "Gerencie arquivos, filtros e conteudos que continuam ou saem da base.",
    actionLabel: "Novo agendamento",
    onAction: (setActiveView) => () => setActiveView("scheduler"),
  },
  scheduler: {
    title: "Agendamentos",
    description: "Planeje a distribuicao de posts de forma simultanea entre redes.",
    actionLabel: "Abrir conexoes",
    onAction: (setActiveView) => () => setActiveView("config"),
  },
  reposts: {
    title: "Repostagem",
    description: "Configure os gatilhos de reaproveitamento e de remocao por score.",
    actionLabel: "Ajustar conexoes",
    onAction: (setActiveView) => () => setActiveView("config"),
  },
  users: {
    title: "Usuarios",
    description: "Crie, edite e revise acessos, nomes, e-mails e senhas.",
    actionLabel: "Novo usuario",
    onAction: () => undefined,
  },
  config: {
    title: "Config",
    description: "Central de conexoes e parametros de integracao via API.",
    actionLabel: "Ir para agendamentos",
    onAction: (setActiveView) => () => setActiveView("scheduler"),
  },
};

const pageTitleMap: Record<ViewKey, string> = {
  library: "Biblioteca",
  scheduler: "Agendamentos",
  reposts: "Repostagem",
  users: "Usuarios",
  config: "Config",
};

function ViewHeader({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 className="font-display text-3xl tracking-[-0.04em]">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60">{description}</p>
      </div>
      {onAction ? (
        <button type="button" onClick={onAction} className="rounded-full border border-violet/15 px-4 py-2 text-sm font-medium text-violet">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={classNames(
        "flex items-center justify-center rounded-[1.4rem] border border-violet/12 bg-white shadow-sm",
        compact ? "size-14" : "size-16",
      )}
    >
      <HeartPlayIcon className={compact ? "size-8 text-rose-600" : "size-9 text-rose-600"} />
    </div>
  );
}

function AssetPreview({
  preview,
  title,
}: {
  preview: DraftPreviewState | null;
  title: string;
}) {
  if (!preview) {
    return (
      <div className="rounded-[1.25rem] border border-dashed border-violet/20 bg-violet/4 px-4 py-6 text-sm text-ink/50">
        O preview do arquivo aparece aqui para voce conferir antes de salvar.
      </div>
    );
  }

  return (
    <div className="rounded-[1.25rem] border border-violet/10 bg-violet/4 p-3">
      {preview.type === "video" ? (
        <video controls className="w-full rounded-2xl bg-black/80" src={preview.url} />
      ) : (
        <img src={preview.url} alt={title} className="w-full rounded-2xl object-cover" />
      )}
      <p className="mt-3 text-sm text-ink/60">{preview.name}</p>
    </div>
  );
}

function IllustrationRow({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="flex items-start gap-4 rounded-[1.4rem] border border-violet/10 bg-violet/5 p-4">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-white">{icon}</div>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-ink/58">{description}</p>
      </div>
    </article>
  );
}

function NavIcon({ view }: { view: ViewKey }) {
  switch (view) {
    case "library":
      return <LibraryIcon className="size-4" />;
    case "scheduler":
      return <CalendarIcon className="size-4" />;
    case "reposts":
      return <CycleIcon className="size-4" />;
    case "users":
      return <UsersIcon className="size-4" />;
    case "config":
      return <ConnectionIcon className="size-4" />;
    default:
      return <HeartPlayIcon className="size-4" />;
  }
}

function HeartPlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7.1 6A3.6 3.6 0 0 0 3.5 9.6c0 4.3 6.5 7.9 7.8 8.6a1.2 1.2 0 0 0 1.1 0c1.3-.7 7.8-4.3 7.8-8.6A3.6 3.6 0 0 0 16.6 6c-1.2 0-2.3.5-3 1.7C12.9 6.5 11.8 6 10.6 6c-1 0-2 .3-2.7.9A3.5 3.5 0 0 0 7.1 6Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path d="M11.4 8.4v6.8l5.4-3.4-5.4-3.4Z" fill="#fca5a5" />
    </svg>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="5" width="4" height="14" rx="1.2" fill="currentColor" opacity="0.95" />
      <rect x="10" y="4" width="4" height="15" rx="1.2" fill="currentColor" opacity="0.72" />
      <rect x="16" y="7" width="4" height="12" rx="1.2" fill="currentColor" opacity="0.52" />
    </svg>
  );
}

function ConnectionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M9.2 8.2 6.8 10.6a2.4 2.4 0 0 0 0 3.4 2.4 2.4 0 0 0 3.4 0l2.3-2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m14.8 15.8 2.4-2.4a2.4 2.4 0 0 0 0-3.4 2.4 2.4 0 0 0-3.4 0l-2.3 2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m9.8 14.2 4.4-4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 4v4M16 4v4M4 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

function CycleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7 7h5V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 17h-5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.6 17.6A6 6 0 0 1 6 9.5L7 8.3M16.4 6.4A6 6 0 0 1 18 14.5L17 15.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" opacity="0.7" />
      <path d="M4.5 18.5a4.5 4.5 0 0 1 9 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14.5 18.5a3.5 3.5 0 0 1 5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
      <div className="mb-5">
        <h3 className="font-display text-2xl tracking-[-0.04em]">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-ink/58">{description}</p>
      </div>
      {children}
    </section>
  );
}

function FormGrid({ action, children }: { action: (formData: FormData) => void; children: React.ReactNode }) {
  return <form action={action} className="grid gap-4">{children}</form>;
}

function FlashBanner({ flash, className }: { flash: NonNullable<FlashState>; className?: string }) {
  return (
    <div
      className={classNames(
        "rounded-2xl px-4 py-3 text-sm",
        flash.kind === "error" ? "bg-rose-100 text-rose-700" : "bg-violet/10 text-violet",
        className,
      )}
    >
      {flash.message}
    </div>
  );
}

function StatusPill({ status }: { status: "connected" | "pending" | "disconnected" }) {
  return (
    <span
      className={classNames(
        "rounded-full px-3 py-1 text-xs",
        status === "connected"
          ? "bg-emerald-100 text-emerald-700"
          : status === "pending"
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-600",
      )}
    >
      {status}
    </span>
  );
}

function CheckGrid({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium text-ink/75">{legend}</legend>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function CheckCard({ name, value, label }: { name: string; value: string; label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
      <input name={name} type="checkbox" value={value} className="size-4 accent-violet" />
      <span className="text-sm text-ink/75">{label}</span>
    </label>
  );
}

function PrimaryButton({ label }: { label: string }) {
  return <button className="mt-2 rounded-full bg-violet px-5 py-3 text-sm font-medium text-white">{label}</button>;
}

function SecondaryButton({
  label,
  onClick,
  type = "button",
}: {
  label: string;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="rounded-full border border-violet/15 px-4 py-2 text-sm font-medium text-violet"
    >
      {label}
    </button>
  );
}

function GhostDangerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full bg-rose-100 px-4 py-2 text-sm font-medium text-rose-700">
      {label}
    </button>
  );
}

function Field({
  label,
  name,
  placeholder,
  type = "text",
  defaultValue,
  required = true,
}: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="text-ink/75">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 outline-none transition focus:border-violet focus:bg-white"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  defaultValue?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="text-ink/75">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 outline-none transition focus:border-violet focus:bg-white"
      >
        {options.map((option) => (
          <option key={`${name}-${option.value}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
