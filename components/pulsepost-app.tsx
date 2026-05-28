"use client";

import { useEffect, useMemo, useState } from "react";
import { networkLabels, seedState, SESSION_STORAGE_KEY, STORAGE_KEY, inferContentType, contentTypeLabels, contentTypeColors } from "@/lib/constants";
import { classNames, formatDate, formatNetworkList, getMediaHealth } from "@/lib/utils";
import {
  assessRepost,
  buildDailyPlan,
  DailyPlan,
  defaultPlanOptions,
  PlanOptions,
  rankRepostCandidates,
} from "@/lib/repost-engine";
import {
  AppUser,
  CaptionDraft,
  Competitor,
  ContentType,
  FlashState,
  MediaItem,
  MediaStatus,
  NetworkKey,
  PersistedState,
  RepostRule,
  ScheduleItem,
  Script,
  ScriptStatus,
  ViewKey,
} from "@/types/app";
import { MediaPicker, MediaPickerTrigger } from "@/components/media-picker";

type FiltersState = {
  mediaStatus: "all" | MediaStatus;
  contentType: "all" | ContentType;
};

type DraftPreviewState = {
  name: string;
  type: MediaItem["type"];
  url: string;
};

type WoopClientStatus = {
  configured: boolean;
  projectId: string | null;
  projectName: string | null;
  accounts: Record<NetworkKey, { connected: boolean; username: string | null; socialAccountId: string | null }>;
  error: string | null;
  r2Configured: boolean;
  aiConfigured: boolean;
};

type PostMetrics = {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  impressions: number;
  reach: number;
  clicks: number;
};

type ScoredPost = {
  id: string;
  network: NetworkKey | null;
  platform: string;
  caption: string;
  publishedAt: string | null;
  permalink: string | null;
  metrics: PostMetrics;
  engagementRate: number;
  score: number;
  hasMetrics: boolean;
};

type EngagementDashboard = {
  totalPosts: number;
  postsWithMetrics: number;
  avgScore: number;
  totals: PostMetrics;
  byNetwork: Array<{
    network: NetworkKey;
    posts: number;
    avgScore: number;
    avgEngagementRate: number;
    totals: PostMetrics;
  }>;
  topPosts: ScoredPost[];
  metricsAvailable: boolean;
};

function todayLocalDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

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
  contentType: "all",
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

function computeCompositeScore(stats: Record<string, { score: number }>): number {
  const scores = Object.values(stats).map((s) => s.score).filter((s) => s > 0);
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}

function normalizeState(raw: Partial<PersistedState>): PersistedState {
  // Migrate media items — add numericId, contentType, compositeScore
  let nextNumericId = typeof raw.nextMediaNumericId === "number" ? raw.nextMediaNumericId : 1;
  const mediaLibrary = (Array.isArray(raw.mediaLibrary) && raw.mediaLibrary.length ? raw.mediaLibrary : seedState.mediaLibrary).map((item) => {
    const numericId = item.numericId ?? nextNumericId++;
    const contentType = item.contentType ?? inferContentType(item.format ?? "", item.isAd);
    const compositeScore = item.compositeScore ?? computeCompositeScore(item.stats ?? {});
    return { ...item, numericId, contentType, compositeScore };
  });

  return {
    users: Array.isArray(raw.users) && raw.users.length ? raw.users : seedState.users,
    mediaLibrary,
    schedules: Array.isArray(raw.schedules) ? raw.schedules : seedState.schedules,
    repostRules: Array.isArray(raw.repostRules) ? raw.repostRules : seedState.repostRules,
    audit: Array.isArray(raw.audit) ? raw.audit : seedState.audit,
    scripts: Array.isArray(raw.scripts) ? raw.scripts : [],
    recordingQueue: Array.isArray(raw.recordingQueue) ? raw.recordingQueue : [],
    captions: Array.isArray(raw.captions) ? raw.captions : [],
    competitors: Array.isArray(raw.competitors) ? raw.competitors : [],
    competitorSnapshots: Array.isArray(raw.competitorSnapshots) ? raw.competitorSnapshots : [],
    dailySnapshots: Array.isArray(raw.dailySnapshots) ? raw.dailySnapshots : [],
    nextMediaNumericId: nextNumericId,
    nextScriptNumericId: typeof raw.nextScriptNumericId === "number" ? raw.nextScriptNumericId : 1,
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

function normalizeWoopStatus(status: unknown): NonNullable<ScheduleItem["woopStatus"]> {
  const value = String(status ?? "").toUpperCase();
  if (value === "DRAFT") return "DRAFT";
  if (value === "PUBLISHED" || value === "PUBLISH_NOW") return "PUBLISHED";
  return "SCHEDULED";
}

const numberFmt = new Intl.NumberFormat("pt-BR");

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function setFormFieldValue(
  form: HTMLFormElement | null,
  name: string,
  value: string,
  onlyIfEmpty = false,
) {
  if (!form) {
    return;
  }
  const element = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  if (!element) {
    return;
  }
  if (onlyIfEmpty && element.value.trim()) {
    return;
  }
  element.value = value;
}

// Auto-fills a media form from the chosen file: suggests title/filename/type and
// reads the real video duration from metadata. Title is only suggested when empty.
// onDetect callback receives { duration, format } for display purposes.
// fieldNames allows overriding the form field names (used by the scheduler form).
function prefillMediaFormFromFile(
  file: File,
  form: HTMLFormElement | null,
  onDetect?: (info: { duration: string; format: string }) => void,
  fieldNames?: { fileName?: string; title?: string; type?: string; duration?: string; format?: string },
) {
  const fn = (name: string) => fieldNames?.[name as keyof typeof fieldNames] ?? name;
  const type = inferMediaTypeFromFile(file);
  setFormFieldValue(form, fn("fileName"), file.name);
  setFormFieldValue(form, fn("title"), stripExtension(file.name), true);
  setFormFieldValue(form, fn("type"), type);

  if (type === "image") {
    setFormFieldValue(form, fn("duration"), "Imagem");
    setFormFieldValue(form, fn("format"), "Feed");
    onDetect?.({ duration: "Imagem", format: "Feed" });
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const probe = document.createElement("video");
  probe.preload = "metadata";
  const finish = (seconds: number) => {
    const duration = formatDurationSeconds(seconds);
    const format = seconds < 15 ? "Story" : "Reel";
    setFormFieldValue(form, fn("duration"), duration);
    setFormFieldValue(form, fn("format"), format);
    onDetect?.({ duration, format });
    URL.revokeObjectURL(objectUrl);
  };
  probe.onloadedmetadata = () => {
    // Some containers (e.g. MediaRecorder webm) report Infinity until seeked.
    if (probe.duration === Infinity || Number.isNaN(probe.duration)) {
      probe.ontimeupdate = () => {
        probe.ontimeupdate = null;
        finish(probe.duration);
      };
      probe.currentTime = 1e101;
      return;
    }
    finish(probe.duration);
  };
  probe.onerror = () => URL.revokeObjectURL(objectUrl);
  probe.src = objectUrl;
}

function buildMediaItem(params: {
  id: string;
  numericId: number;
  title: string;
  type: MediaItem["type"];
  format: string;
  contentType?: ContentType;
  duration: string;
  status: MediaStatus;
  category: string;
  fileName: string;
  url?: string | null;
  isAd?: boolean;
}): MediaItem {
  const ct = params.contentType ?? inferContentType(params.format, params.isAd);
  return {
    id: params.id,
    numericId: params.numericId,
    title: params.title,
    type: params.type,
    format: params.format,
    contentType: ct,
    duration: params.duration,
    status: params.status,
    category: params.category,
    fileName: params.fileName,
    url: params.url ?? null,
    createdAt: new Date().toISOString(),
    compositeScore: 0,
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
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [flash, setFlash] = useState<FlashState>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [mediaFormPreview, setMediaFormPreview] = useState<DraftPreviewState | null>(null);
  const [scheduleFormPreview, setScheduleFormPreview] = useState<DraftPreviewState | null>(null);
  const [ephemeralMediaPreviews, setEphemeralMediaPreviews] = useState<Record<string, DraftPreviewState>>({});
  const [mediaFormKey, setMediaFormKey] = useState(0);
  const [scheduleFormKey, setScheduleFormKey] = useState(0);
  const [detectedMediaInfo, setDetectedMediaInfo] = useState<{ duration: string; format: string } | null>(null);
  const [detectedScheduleMediaInfo, setDetectedScheduleMediaInfo] = useState<{ duration: string; format: string } | null>(null);
  const [woopStatus, setWoopStatus] = useState<WoopClientStatus | null>(null);
  const [publishingSchedule, setPublishingSchedule] = useState(false);
  const [connectingNetwork, setConnectingNetwork] = useState<NetworkKey | null>(null);
  const [insights, setInsights] = useState<EngagementDashboard | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [planOptions, setPlanOptions] = useState<PlanOptions>(defaultPlanOptions);
  const [planDate, setPlanDate] = useState<string>(todayLocalDate());
  const [planNewMediaIds, setPlanNewMediaIds] = useState<string[]>([]);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [scheduleContentType, setScheduleContentType] = useState<ContentType>("reel");
  const [planUseAi, setPlanUseAi] = useState(false);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMediaId, setPickerMediaId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((status: WoopClientStatus | null) => {
        if (!cancelled) {
          setWoopStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWoopStatus(null);
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
    if (activeView === "insights" && insights === null && !insightsLoading && woopStatus?.configured) {
      loadInsights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, woopStatus?.configured]);

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
    () =>
      data.mediaLibrary.filter((item) => {
        if (filters.mediaStatus !== "all" && item.status !== filters.mediaStatus) return false;
        if (filters.contentType !== "all" && item.contentType !== filters.contentType) return false;
        return true;
      }),
    [data.mediaLibrary, filters.mediaStatus, filters.contentType],
  );

  const rankedCandidates = useMemo(
    () => rankRepostCandidates(data.mediaLibrary, planOptions),
    [data.mediaLibrary, planOptions],
  );

  const connectedNetworks = useMemo<NetworkKey[]>(() => {
    const connected = (Object.keys(networkLabels) as NetworkKey[]).filter(
      (network) => woopStatus?.accounts?.[network]?.connected,
    );
    return connected.length ? connected : (Object.keys(networkLabels) as NetworkKey[]);
  }, [woopStatus]);

  async function refreshStatus() {
    try {
      const response = await fetch("/api/social/status");
      if (response.ok) {
        setWoopStatus(await response.json());
      }
    } catch {
      // mantem o status atual em caso de falha de rede
    }
  }

  async function connectNetwork(network: NetworkKey) {
    setConnectingNetwork(network);
    try {
      const response = await fetch("/api/social/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network }),
      });
      const result = await response.json();
      if (response.ok && result.ok && result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
        setFlash({
          message: `Abrimos a autorizacao do ${networkLabels[network]}. Conclua e clique em "Atualizar status".`,
          kind: "success",
        });
      } else {
        setFlash({ message: `Falha ao conectar: ${result.error ?? "erro desconhecido"}`, kind: "error" });
      }
    } catch {
      setFlash({ message: "Nao foi possivel contatar a API da WoopSocial.", kind: "error" });
    } finally {
      setConnectingNetwork(null);
    }
  }

  async function loadInsights() {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const response = await fetch("/api/social/insights");
      const result = await response.json();
      if (response.ok && result.ok) {
        setInsights(result.dashboard as EngagementDashboard);
        if (result.connectedAccounts === 0) {
          setInsightsError("Nenhuma conta conectada na WoopSocial. Conecte as contas na aba Config.");
        }
      } else {
        setInsightsError(result.error ?? "Falha ao puxar os dados de engajamento.");
      }
    } catch {
      setInsightsError("Nao foi possivel contatar a API da WoopSocial.");
    } finally {
      setInsightsLoading(false);
    }
  }

  function togglePlanNewMedia(id: string) {
    setPlanNewMediaIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function generateDailyPlan() {
    const plan = buildDailyPlan({
      date: planDate,
      library: data.mediaLibrary,
      newMediaIds: planNewMediaIds,
      options: planOptions,
    });
    setDailyPlan(plan);
    setFlash({
      message: `Plano gerado: ${plan.summary.news} novo(s), ${plan.summary.reposts} repost(s)${plan.summary.empty ? `, ${plan.summary.empty} vazio(s)` : ""}.`,
      kind: plan.summary.empty ? "error" : "success",
    });
  }

  async function applyDailyPlan() {
    if (!dailyPlan) {
      return;
    }

    const filledSlots = dailyPlan.slots.filter((slot) => slot.mediaId);
    if (!filledSlots.length) {
      setFlash({ message: "Nenhum horario preenchido para agendar.", kind: "error" });
      return;
    }

    setApplyingPlan(true);
    const newSchedules: ScheduleItem[] = [];
    const repostedIds = new Set<string>();
    const postedAtById = new Map<string, string>();

    for (const slot of filledSlots) {
      const media = data.mediaLibrary.find((item) => item.id === slot.mediaId);
      if (!media) {
        continue;
      }

      let caption = "";
      if (planUseAi && slot.kind === "repost") {
        try {
          const response = await fetch("/api/ai/caption", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: media.title,
              theme: media.category,
              baseCaption: "",
              network: connectedNetworks[0] ?? "instagram",
            }),
          });
          const result = await response.json();
          if (response.ok && result.ok) {
            caption = String(result.caption ?? "");
          }
        } catch {
          // mantém legenda vazia em caso de falha da IA
        }
      }

      newSchedules.push({
        id: randomId("schedule"),
        title: `${slot.kind === "new" ? "Novo" : "Repost"} · ${media.title}`,
        mediaId: media.id,
        networks: connectedNetworks,
        scheduledFor: slot.time,
        caption,
        status: "scheduled",
        repostRuleId: null,
        woopPostId: null,
        woopStatus: null,
      });

      postedAtById.set(media.id, slot.time);
      if (slot.kind === "repost") {
        repostedIds.add(media.id);
      }
    }

    const nextLibrary = data.mediaLibrary.map((item) => {
      const postedAt = postedAtById.get(item.id);
      if (!postedAt) {
        return item;
      }
      return {
        ...item,
        lastPostedAt: postedAt,
        repostCount: (item.repostCount ?? 0) + (repostedIds.has(item.id) ? 1 : 0),
      };
    });

    persist(
      { ...data, mediaLibrary: nextLibrary, schedules: [...newSchedules, ...data.schedules] },
      `${newSchedules.length} horario(s) do plano agendado(s). Publique pela fila em Agendamentos.`,
    );
    setDailyPlan(null);
    setPlanNewMediaIds([]);
    setApplyingPlan(false);
    setActiveView("scheduler");
  }


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

    const nextNumId = data.nextMediaNumericId ?? 1;
    const nextItem = buildMediaItem({
      id: nextItemId,
      numericId: nextNumId,
      title: String(formData.get("title") ?? "").trim() || stripExtension(fileName),
      type: inferredType ?? (String(formData.get("type") ?? "video") as MediaItem["type"]),
      format: String(formData.get("format") ?? "").trim(),
      contentType: String(formData.get("contentType") ?? "") as ContentType || undefined,
      duration: String(formData.get("duration") ?? "").trim() || (inferredType === "image" ? "Imagem" : "00:00"),
      status: String(formData.get("status") ?? "active") as MediaStatus,
      category: "Geral",
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
      { ...data, mediaLibrary: [nextItem, ...data.mediaLibrary], nextMediaNumericId: nextNumId + 1 },
      storedUrl ? "Midia enviada para o R2 e adicionada na biblioteca." : "Midia adicionada na biblioteca.",
    );
    setMediaFormPreview(null);
    setDetectedMediaInfo(null);
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

      const schedNextId = data.nextMediaNumericId ?? 1;
      const nextMediaItem = buildMediaItem({
        id: nextItemId,
        numericId: schedNextId,
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
      // We'll increment nextMediaNumericId when persisting below
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
    const woopMode = String(formData.get("woopMode") ?? "off");

    const schedContentType = (String(formData.get("scheduleContentType") ?? "") || undefined) as ContentType | undefined;
    const isStory = schedContentType === "story";

    const nextSchedule: ScheduleItem = {
      id: randomId("schedule"),
      title,
      mediaId,
      networks,
      scheduledFor,
      caption,
      contentType: schedContentType,
      status: "scheduled",
      repostRuleId: String(formData.get("repostRuleId") ?? "") || null,
      woopPostId: null,
      woopStatus: null,
      storyNotification: isStory,
    };

    const newNextNumId = nextMediaLibrary !== data.mediaLibrary ? (data.nextMediaNumericId ?? 1) + 1 : data.nextMediaNumericId;
    const baseState = { ...data, mediaLibrary: nextMediaLibrary, schedules: [nextSchedule, ...data.schedules], nextMediaNumericId: newNextNumId };
    persist(baseState, "Agendamento criado.");
    setScheduleFormPreview(null);
    setDetectedScheduleMediaInfo(null);
    setPickerMediaId(null);

    if (woopMode !== "off") {
      if (!resolvedMediaUrl && !uploadedFile) {
        setFlash({ message: "Anexe um arquivo ou use uma midia ja enviada ao R2 para publicar.", kind: "error" });
      } else {
        setPublishingSchedule(true);
        const publishForm = new FormData();
        publishForm.set("title", title || "Post");
        publishForm.set("caption", caption);
        publishForm.set("scheduledFor", scheduledFor);
        publishForm.set("mode", woopMode);
        if (resolvedMediaUrl) {
          publishForm.set("mediaUrl", resolvedMediaUrl);
        } else if (uploadedFile) {
          publishForm.set("file", uploadedFile);
        }
        networks.forEach((network) => publishForm.append("networks", network));
        const resolvedFormat = mediaId
          ? data.mediaLibrary.find((item) => item.id === mediaId)?.format ?? manualFormat
          : manualFormat;
        if (resolvedFormat) publishForm.set("mediaFormat", resolvedFormat);

        try {
          const response = await fetch("/api/social/publish", { method: "POST", body: publishForm });
          const result = await response.json();
          if (response.ok && result.ok) {
            updateScheduleWoopResult(baseState, nextSchedule.id, {
              woopPostId: result.postId ?? null,
              woopStatus: normalizeWoopStatus(result.status),
            });
            setFlash({
              message:
                result.status === "DRAFT"
                  ? "Rascunho criado na WoopSocial."
                  : result.status === "PUBLISH_NOW" || result.status === "PUBLISHED"
                    ? "Post publicado na WoopSocial."
                    : "Post agendado na WoopSocial.",
              kind: "success",
            });
          } else {
            updateScheduleWoopResult(baseState, nextSchedule.id, { woopPostId: null, woopStatus: "error" });
            setFlash({ message: `Falha na WoopSocial: ${result.error ?? "erro desconhecido"}`, kind: "error" });
          }
        } catch {
          updateScheduleWoopResult(baseState, nextSchedule.id, { woopPostId: null, woopStatus: "error" });
          setFlash({ message: "Nao foi possivel contatar a API da WoopSocial.", kind: "error" });
        } finally {
          setPublishingSchedule(false);
        }
      }
    }

    setScheduleFormKey((current) => current + 1);
    setScheduleContentType("reel");
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
    if (media.format) publishForm.set("mediaFormat", media.format);
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
                woopPostId: response.ok && result.ok ? result.postId ?? null : null,
                woopStatus: (response.ok && result.ok ? normalizeWoopStatus(result.status) : "error") as ScheduleItem["woopStatus"],
              }
            : item,
        ),
      };
      persist(
        nextState,
        response.ok && result.ok
          ? "Agendamento publicado na WoopSocial."
          : `Falha na WoopSocial: ${result.error ?? "erro desconhecido"}`,
        response.ok && result.ok ? "success" : "error",
      );
    } catch {
      setFlash({ message: "Nao foi possivel contatar a API da WoopSocial.", kind: "error" });
    } finally {
      setPublishingSchedule(false);
    }
  }

  function updateScheduleWoopResult(
    fromState: PersistedState,
    scheduleId: string,
    patch: Pick<ScheduleItem, "woopPostId" | "woopStatus">,
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

  function removeSchedule(id: string) {
    persist(
      {
        ...data,
        schedules: data.schedules.filter((s) => s.id !== id),
        captions: data.captions.filter((c) => c.scheduleId !== id),
      },
      "Agendamento removido.",
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
                  { key: "dashboard", label: "Dashboard" },
                  { key: "library", label: "Biblioteca" },
                  { key: "calendar", label: "Calendario" },
                  { key: "scheduler", label: "Agendamentos" },
                  { key: "scripts", label: "Roteiros" },
                  { key: "plan", label: "Plano do dia" },
                  { key: "insights", label: "Engajamento" },
                  { key: "competitors", label: "Concorrentes" },
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

              {/* ── Dashboard ── */}
              {activeView === "dashboard" ? (
                <DashboardView data={data} setActiveView={setActiveView} />
              ) : null}

              {/* ── Calendar ── */}
              {activeView === "calendar" ? (
                <CalendarView schedules={data.schedules} mediaLibrary={data.mediaLibrary} setActiveView={setActiveView} />
              ) : null}

              {/* ── Scripts ── */}
              {activeView === "scripts" ? (
                <ScriptsView data={data} persist={persist} />
              ) : null}

              {/* ── Competitors ── */}
              {activeView === "competitors" ? (
                <CompetitorsView data={data} persist={persist} />
              ) : null}

              {activeView === "library" ? (
                <section className="grid gap-5">
                  {/* Add new media — collapsible */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setMediaFormKey((k) => (k === -1 ? 0 : -1))}
                      className="rounded-full bg-violet px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet/15 transition hover:bg-violet/85"
                    >
                      {mediaFormKey === -1 ? "+ Nova midia" : "Cancelar"}
                    </button>
                    <p className="text-sm text-ink/40">{data.mediaLibrary.length} midias no acervo</p>
                  </div>

                  {mediaFormKey !== -1 && (
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
                              const form = event.currentTarget.form;
                              if (!file) {
                                setMediaFormPreview(null);
                                return;
                              }
                              setMediaFormPreview({
                                name: file.name,
                                type: inferMediaTypeFromFile(file),
                                url: URL.createObjectURL(file),
                              });
                              prefillMediaFormFromFile(file, form, setDetectedMediaInfo);
                            }}
                          />
                        </label>
                        <AssetPreview preview={mediaFormPreview} title="Preview da nova midia" />
                        {detectedMediaInfo && (
                          <p className="rounded-xl bg-violet/8 px-4 py-2 text-sm text-ink/70">
                            Duracao: <span className="font-medium text-ink">{detectedMediaInfo.duration}</span> · Formato: <span className="font-medium text-ink">{detectedMediaInfo.format}</span>
                          </p>
                        )}
                        <Field label="Arquivo (opcional se houver upload)" name="fileName" placeholder="video.mp4" required={false} />
                        <input type="hidden" name="duration" />
                        <input type="hidden" name="format" />
                        <div className="grid gap-4 md:grid-cols-2">
                          <SelectField
                            label="Tipo"
                            name="type"
                            options={[
                              { label: "Video", value: "video" },
                              { label: "Imagem", value: "image" },
                            ]}
                          />
                          <SelectField
                            label="Tipo de conteudo"
                            name="contentType"
                            options={[
                              { label: "Reels", value: "reel" },
                              { label: "Story", value: "story" },
                              { label: "Anuncio", value: "ad" },
                              { label: "Organico", value: "organic" },
                            ]}
                          />
                        </div>
                        <SelectField
                          label="Status"
                          name="status"
                          options={[
                            { label: "Ativa", value: "active" },
                            { label: "Revisao", value: "review" },
                            { label: "Arquivada", value: "archived" },
                          ]}
                        />
                        <PrimaryButton label="Salvar midia" />
                      </FormGrid>
                    </Card>
                  )}

                  {/* Filters */}
                  <div className="flex flex-wrap gap-2">
                    {/* Status filters */}
                    {[
                      { label: "Todos", value: "all" as const },
                      { label: "Ativas", value: "active" as const },
                      { label: "Revisao", value: "review" as const },
                      { label: "Arquivadas", value: "archived" as const },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFilters((c) => ({ ...c, mediaStatus: option.value }))}
                        className={classNames(
                          "rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                          filters.mediaStatus === option.value ? "bg-violet text-white" : "bg-violet/6 text-ink/60 hover:bg-violet/12",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                    <span className="mx-1 self-center text-violet/20">|</span>
                    {/* Content type filters */}
                    <button
                      type="button"
                      onClick={() => setFilters((c) => ({ ...c, contentType: "all" }))}
                      className={classNames(
                        "rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                        filters.contentType === "all" ? "bg-violet text-white" : "bg-violet/6 text-ink/60 hover:bg-violet/12",
                      )}
                    >
                      Todos tipos
                    </button>
                    {(Object.entries(contentTypeLabels) as [ContentType, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setFilters((c) => ({ ...c, contentType: key }))}
                        className={classNames(
                          "rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                          filters.contentType === key ? contentTypeColors[key] : "bg-violet/6 text-ink/60 hover:bg-violet/12",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Media grid */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredMedia.length === 0 && (
                      <p className="col-span-full rounded-2xl border border-dashed border-violet/15 px-6 py-10 text-center text-sm text-ink/40">
                        Nenhuma midia encontrada com esses filtros.
                      </p>
                    )}
                    {filteredMedia.map((item) => {
                      const health = getMediaHealth(item);
                      const preview = ephemeralMediaPreviews[item.id] ?? null;
                      const score = item.compositeScore ?? health.average;
                      return (
                        <article key={item.id} className="group relative overflow-hidden rounded-[1.25rem] border border-violet/10 bg-white transition hover:border-violet/25 hover:shadow-lg hover:shadow-violet/5">
                          {/* Thumbnail / preview area */}
                          <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-violet/5 to-violet/10">
                            {preview ? (
                              preview.type === "video" ? (
                                <video controls className="h-full w-full object-cover" src={preview.url} />
                              ) : (
                                <img src={preview.url} alt={item.title} className="h-full w-full object-cover" />
                              )
                            ) : item.thumbnailUrl ? (
                              <img src={item.thumbnailUrl} alt={item.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center">
                                <span className="text-3xl text-violet/20">{item.type === "video" ? "🎬" : "🖼️"}</span>
                              </div>
                            )}
                            {/* Numeric ID badge */}
                            <span className="absolute left-2.5 top-2.5 rounded-lg bg-black/60 px-2 py-0.5 text-xs font-bold text-white backdrop-blur-sm">
                              #{String(item.numericId ?? 0).padStart(4, "0")}
                            </span>
                            {/* Score badge */}
                            <span className={classNames(
                              "absolute right-2.5 top-2.5 rounded-lg px-2 py-0.5 text-xs font-bold backdrop-blur-sm",
                              score >= 70 ? "bg-emerald-500/90 text-white" : score >= 40 ? "bg-amber-500/90 text-white" : "bg-rose-500/90 text-white",
                            )}>
                              {score}
                            </span>
                            {/* Duration badge */}
                            {item.duration && item.duration !== "Imagem" && (
                              <span className="absolute bottom-2.5 right-2.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                                {item.duration}
                              </span>
                            )}
                          </div>
                          {/* Info area */}
                          <div className="p-3.5">
                            <div className="mb-2 flex items-center gap-1.5">
                              <span className={classNames("rounded-full px-2 py-0.5 text-[10px] font-bold", contentTypeColors[item.contentType ?? "organic"])}>
                                {contentTypeLabels[item.contentType ?? "organic"]}
                              </span>
                              <span className={classNames(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                item.status === "active" ? "bg-emerald-100 text-emerald-700" : item.status === "review" ? "bg-amber-100 text-amber-700" : "bg-ink/8 text-ink/40",
                              )}>
                                {item.status === "active" ? "Ativa" : item.status === "review" ? "Revisao" : "Arquivada"}
                              </span>
                            </div>
                            <h3 className="line-clamp-1 text-sm font-semibold text-ink">{item.title}</h3>
                            <p className="mt-0.5 line-clamp-1 text-xs text-ink/45">{item.fileName}</p>
                            {/* Per-network mini scores */}
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {(Object.keys(item.stats) as NetworkKey[])
                                .filter((net) => item.stats[net].views > 0)
                                .map((net) => (
                                  <span key={net} className="inline-flex items-center gap-1 rounded-md bg-violet/6 px-1.5 py-0.5 text-[10px] text-ink/55">
                                    <span className="font-medium text-ink/70">{networkLabels[net].slice(0, 2).toUpperCase()}</span>
                                    <span className={classNames(
                                      "font-bold",
                                      item.stats[net].score >= 70 ? "text-emerald-600" : item.stats[net].score >= 40 ? "text-amber-600" : "text-rose-500",
                                    )}>
                                      {item.stats[net].score}
                                    </span>
                                  </span>
                                ))}
                              {Object.values(item.stats).every((s) => s.views === 0) && (
                                <span className="text-[10px] text-ink/30">Sem dados ainda</span>
                              )}
                            </div>
                            {/* Actions */}
                            <div className="mt-3 flex gap-2">
                              <button type="button" onClick={() => refreshStats(item.id)} className="rounded-full bg-violet/8 px-3 py-1 text-[11px] font-medium text-violet transition hover:bg-violet/15">Atualizar</button>
                              <button type="button" onClick={() => removeMedia(item.id)} className="rounded-full bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-500 transition hover:bg-rose-100">Remover</button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {activeView === "scheduler" ? (
                <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card title="Novo agendamento" description="Programe uma postagem para varias redes ao mesmo tempo.">
                    <FormGrid key={scheduleFormKey} action={handleCreateSchedule}>
                      {/* Step 1 — Content type selector (determines which fields show) */}
                      <div className="grid gap-2">
                        <span className="text-sm font-medium text-ink/75">Tipo de conteudo</span>
                        <input type="hidden" name="scheduleContentType" value={scheduleContentType} />
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {(Object.entries(contentTypeLabels) as [ContentType, string][]).map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setScheduleContentType(key)}
                              className={classNames(
                                "rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition",
                                scheduleContentType === key
                                  ? "border-violet bg-violet/8 text-violet"
                                  : "border-violet/10 text-ink/50 hover:border-violet/25",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <Field label="Titulo interno" name="title" placeholder="Lote de domingo" />

                      {/* Media picker */}
                      <div className="grid gap-2 text-sm font-medium">
                        <span className="text-ink/75">Midia</span>
                        <input type="hidden" name="mediaId" value={pickerMediaId ?? ""} />
                        <MediaPickerTrigger
                          label={pickerMediaId ? (data.mediaLibrary.find((m) => m.id === pickerMediaId)?.title ?? "Midia selecionada") : "Escolher da biblioteca..."}
                          onClick={() => setPickerOpen(true)}
                        />
                        {pickerMediaId ? (
                          <button type="button" onClick={() => setPickerMediaId(null)} className="text-left text-xs text-ink/45 hover:text-violet">
                            ✕ Remover vinculo
                          </button>
                        ) : null}
                      </div>
                      {pickerOpen ? (
                        <MediaPicker
                          library={data.mediaLibrary}
                          selectedId={pickerMediaId}
                          onSelect={setPickerMediaId}
                          onClose={() => setPickerOpen(false)}
                        />
                      ) : null}

                      {/* Inline new media upload (collapsible) */}
                      <details className="rounded-[1.25rem] border border-violet/10 bg-violet/4">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink/70 hover:text-violet">
                          + Subir nova midia neste agendamento
                        </summary>
                        <div className="grid gap-4 px-4 pb-4 pt-2">
                          <label className="grid gap-2 text-sm font-medium">
                            <span className="text-ink/75">Upload do arquivo</span>
                            <input
                              name="scheduleUploadFile"
                              type="file"
                              accept="video/*,image/*"
                              className="rounded-2xl border border-violet/12 bg-white px-4 py-3 text-sm outline-none transition file:mr-4 file:rounded-full file:border-0 file:bg-violet file:px-4 file:py-2 file:text-white focus:border-violet"
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                const form = event.currentTarget.form;
                                if (!file) {
                                  setScheduleFormPreview(null);
                                  setDetectedScheduleMediaInfo(null);
                                  return;
                                }
                                setScheduleFormPreview({
                                  name: file.name,
                                  type: inferMediaTypeFromFile(file),
                                  url: URL.createObjectURL(file),
                                });
                                prefillMediaFormFromFile(file, form, setDetectedScheduleMediaInfo, {
                                  fileName: "manualFileName",
                                  title: "manualMediaTitle",
                                  type: "manualMediaType",
                                  duration: "manualDuration",
                                  format: "manualFormat",
                                });
                              }}
                            />
                          </label>
                          <AssetPreview preview={scheduleFormPreview} title="Preview da nova midia do agendamento" />
                          {detectedScheduleMediaInfo && (
                            <p className="rounded-xl bg-violet/8 px-4 py-2 text-sm text-ink/70">
                              Duracao: <span className="font-medium text-ink">{detectedScheduleMediaInfo.duration}</span> · Formato: <span className="font-medium text-ink">{detectedScheduleMediaInfo.format}</span>
                            </p>
                          )}
                          <Field label="Titulo da nova midia" name="manualMediaTitle" placeholder="Ex: video exclusivo do post" required={false} />
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Arquivo (opcional se houver upload)" name="manualFileName" placeholder="video-curto.mp4" required={false} />
                            <Field label="Categoria" name="manualCategory" placeholder="Agendamento manual" required={false} />
                          </div>
                          <input type="hidden" name="manualFormat" />
                          <input type="hidden" name="manualDuration" />
                          <input type="hidden" name="manualMediaType" />
                        </div>
                      </details>

                      {/* Networks */}
                      <CheckGrid legend="Redes">
                        {(Object.keys(networkLabels) as NetworkKey[]).map((network) => (
                          <CheckCard key={network} name="networks" value={network} label={networkLabels[network]} />
                        ))}
                      </CheckGrid>

                      {/* Story notification banner */}
                      {scheduleContentType === "story" && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <p className="font-medium">Agendamento de Story</p>
                          <p className="mt-1 text-xs text-amber-600">
                            Stories nao podem ser publicados automaticamente. Ao agendar um Story, voce recebera uma notificacao no horario marcado para publicar manualmente.
                          </p>
                        </div>
                      )}

                      {/* Ad-specific notice */}
                      {scheduleContentType === "ad" && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                          <p className="font-medium">Conteudo patrocinado</p>
                          <p className="mt-1 text-xs text-rose-600">
                            Anuncios serao separados das metricas organicas no score e analytics.
                          </p>
                        </div>
                      )}

                      {/* Schedule + repost rule */}
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

                      {/* Caption */}
                      <label className="grid gap-2 text-sm font-medium">
                        <span className="text-ink/75">Legenda</span>
                        <textarea
                          name="caption"
                          rows={3}
                          placeholder="Escreva a legenda aqui... Use #hashtags e @mencoes"
                          className="rounded-2xl border border-violet/12 bg-white px-4 py-3 text-sm outline-none transition focus:border-violet"
                        />
                      </label>

                      {/* WoopSocial */}
                      <div className="rounded-[1.25rem] border border-violet/10 bg-violet/4 p-4">
                        <SelectField
                          label="Publicacao via WoopSocial"
                          name="woopMode"
                          options={[
                            { label: "Somente local (nao enviar)", value: "off" },
                            { label: "Agendar/publicar na WoopSocial", value: "scheduled" },
                            { label: "Salvar como rascunho", value: "draft" },
                          ]}
                        />
                        <p className="mt-2 text-xs text-ink/55">
                          {woopStatus?.configured
                            ? woopStatus.r2Configured
                              ? "O arquivo e enviado ao R2 e publicado via WoopSocial."
                              : "R2 nao configurado: arquivo enviado direto."
                            : "WoopSocial nao configurada. Defina WOOPSOCIAL_API_KEY."}
                        </p>
                      </div>
                      <PrimaryButton label={publishingSchedule ? "Enviando..." : "Salvar agendamento"} />
                    </FormGrid>
                  </Card>

                  <Card title="Fila programada" description="Timeline dos proximos disparos com legendas por rede.">
                    <div className="grid gap-3">
                      {data.schedules.length === 0 && (
                        <p className="rounded-2xl border border-dashed border-violet/15 px-6 py-10 text-center text-sm text-ink/40">Nenhum agendamento criado ainda.</p>
                      )}
                      {[...data.schedules]
                        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                        .map((schedule) => {
                          const scheduleCaptions = data.captions.filter((c) => c.scheduleId === schedule.id);
                          return (
                          <article key={schedule.id} className="rounded-[1.25rem] border border-violet/10 bg-white p-4 transition hover:border-violet/20">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                  {schedule.contentType && (
                                    <span className={classNames("rounded-full px-2 py-0.5 text-[10px] font-bold", contentTypeColors[schedule.contentType])}>
                                      {contentTypeLabels[schedule.contentType]}
                                    </span>
                                  )}
                                  {schedule.storyNotification && (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Notificacao</span>
                                  )}
                                </div>
                                <h3 className="font-medium text-ink">{schedule.title}</h3>
                                <p className="mt-0.5 text-xs text-ink/45">{formatNetworkList(schedule.networks)}</p>
                              </div>
                              <div className="text-right">
                                <span className="text-sm font-medium text-violet">{formatDate(schedule.scheduledFor)}</span>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-ink/50">Midia: {getLinkedMediaTitle(schedule.mediaId)}</p>
                            {schedule.caption && <p className="mt-1 line-clamp-2 text-xs text-ink/45">{schedule.caption}</p>}

                            {/* Per-network captions */}
                            <details className="mt-3 rounded-xl border border-violet/8">
                              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-violet hover:bg-violet/4">
                                Legendas por rede ({scheduleCaptions.length}/{schedule.networks.length})
                              </summary>
                              <div className="grid gap-2 px-3 pb-3 pt-1">
                                {schedule.networks.map((net) => {
                                  const existing = scheduleCaptions.find((c) => c.network === net);
                                  return (
                                    <div key={net} className="grid gap-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-medium text-ink/60">{networkLabels[net]}</span>
                                        {existing && (
                                          <span className={classNames(
                                            "rounded-full px-1.5 py-0.5 text-[8px] font-bold",
                                            existing.status === "approved" ? "bg-emerald-100 text-emerald-700"
                                              : existing.status === "published" ? "bg-violet/10 text-violet"
                                              : "bg-gray-100 text-gray-600",
                                          )}>
                                            {existing.status === "approved" ? "Aprovada" : existing.status === "published" ? "Publicada" : "Rascunho"}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex gap-1">
                                        <input
                                          type="text"
                                          defaultValue={existing?.text ?? schedule.caption}
                                          placeholder="Legenda para esta rede..."
                                          className="flex-1 rounded-lg border border-violet/10 bg-violet/3 px-2 py-1.5 text-[11px] outline-none focus:border-violet"
                                          onBlur={(e) => {
                                            const text = e.target.value.trim();
                                            if (!text) return;
                                            if (existing) {
                                              persist({
                                                ...data,
                                                captions: data.captions.map((c) => c.id === existing.id ? { ...c, text } : c),
                                              });
                                            } else {
                                              const newCaption: CaptionDraft = {
                                                id: randomId("caption"),
                                                mediaId: schedule.mediaId,
                                                scheduleId: schedule.id,
                                                text,
                                                network: net,
                                                status: "draft",
                                                createdAt: new Date().toISOString(),
                                              };
                                              persist({ ...data, captions: [...data.captions, newCaption] });
                                            }
                                          }}
                                        />
                                        {existing && existing.status === "draft" && (
                                          <button
                                            type="button"
                                            onClick={() => persist({
                                              ...data,
                                              captions: data.captions.map((c) => c.id === existing.id ? { ...c, status: "approved" as const } : c),
                                            })}
                                            className="shrink-0 rounded-lg bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700 hover:bg-emerald-200"
                                          >
                                            Aprovar
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {schedule.woopStatus ? (
                                <span
                                  className={classNames(
                                    "inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold",
                                    schedule.woopStatus === "error" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700",
                                  )}
                                >
                                  {schedule.woopStatus === "error"
                                    ? "Falha"
                                    : schedule.woopStatus === "DRAFT"
                                      ? "Rascunho"
                                      : schedule.woopStatus === "PUBLISHED"
                                        ? "Publicado"
                                        : "Agendado"}
                                </span>
                              ) : null}
                              {scheduleHasStoredMedia(schedule) && woopStatus?.configured ? (
                                <button
                                  type="button"
                                  onClick={() => publishExistingSchedule(schedule)}
                                  className="rounded-full bg-violet/8 px-3 py-1 text-[11px] font-medium text-violet transition hover:bg-violet/15"
                                >
                                  {publishingSchedule ? "Enviando..." : "Publicar"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => removeSchedule(schedule.id)}
                                className="rounded-full bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-500 transition hover:bg-rose-100"
                              >
                                Remover
                              </button>
                            </div>
                          </article>
                          );
                        })}
                    </div>
                  </Card>
                </section>
              ) : null}

              {activeView === "plan" ? (
                <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <Card
                    title="Configurar o dia"
                    description="Escolha os videos novos de hoje. O algoritmo preenche os horarios restantes com os reposts de melhor desempenho."
                  >
                    <div className="grid gap-5">
                      <div className="rounded-[1.25rem] border border-violet/10 bg-violet/4 p-4 text-sm leading-6 text-ink/65">
                        <p className="font-medium text-ink">Como funciona</p>
                        <ol className="mt-2 grid list-decimal gap-1 pl-5">
                          <li>Marque os 1-2 videos novos do dia.</li>
                          <li>Ajuste a janela e o intervalo (padrao: 9h-21h, de 2 em 2h).</li>
                          <li>Clique em <strong>Gerar plano</strong> e revise a grade ao lado.</li>
                          <li>Clique em <strong>Aplicar plano</strong> para criar os agendamentos.</li>
                        </ol>
                      </div>

                      <label className="grid gap-2 text-sm font-medium">
                        <span className="text-ink/75">Data do plano</span>
                        <input
                          type="date"
                          value={planDate}
                          onChange={(event) => setPlanDate(event.target.value)}
                          className="rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 outline-none transition focus:border-violet focus:bg-white"
                        />
                      </label>

                      <div className="grid gap-4 md:grid-cols-3">
                        <NumberField
                          label="Inicio (h)"
                          value={planOptions.startHour}
                          min={0}
                          max={23}
                          onChange={(value) => setPlanOptions((current) => ({ ...current, startHour: value }))}
                        />
                        <NumberField
                          label="Fim (h)"
                          value={planOptions.endHour}
                          min={0}
                          max={23}
                          onChange={(value) => setPlanOptions((current) => ({ ...current, endHour: value }))}
                        />
                        <NumberField
                          label="Intervalo (h)"
                          value={planOptions.intervalHours}
                          min={1}
                          max={12}
                          onChange={(value) => setPlanOptions((current) => ({ ...current, intervalHours: value }))}
                        />
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <NumberField
                          label="Descanso (dias)"
                          hint="Dias minimos antes de repostar a mesma midia"
                          value={planOptions.minDaysBetweenReposts}
                          min={0}
                          max={90}
                          onChange={(value) => setPlanOptions((current) => ({ ...current, minDaysBetweenReposts: value }))}
                        />
                        <NumberField
                          label="Score minimo"
                          hint="Nota minima (0-100) para repostar"
                          value={planOptions.minRepostScore}
                          min={0}
                          max={100}
                          onChange={(value) => setPlanOptions((current) => ({ ...current, minRepostScore: value }))}
                        />
                        <NumberField
                          label="Max reposts"
                          hint="Limite de reposts por midia"
                          value={planOptions.maxRepostsPerItem}
                          min={1}
                          max={20}
                          onChange={(value) => setPlanOptions((current) => ({ ...current, maxRepostsPerItem: value }))}
                        />
                      </div>

                      <fieldset className="grid gap-3">
                        <legend className="text-sm font-medium text-ink/75">Videos novos de hoje</legend>
                        <p className="text-xs text-ink/55">Selecione os conteudos gravados para hoje (recomendado 1 a 2).</p>
                        <div className="grid gap-2">
                          {data.mediaLibrary.filter((item) => item.status !== "archived").length === 0 ? (
                            <p className="rounded-2xl border border-dashed border-violet/20 bg-violet/4 px-4 py-3 text-sm text-ink/55">
                              Nenhuma midia ativa. Adicione conteudos na Biblioteca primeiro.
                            </p>
                          ) : null}
                          {data.mediaLibrary
                            .filter((item) => item.status !== "archived")
                            .map((item) => {
                              const checked = planNewMediaIds.includes(item.id);
                              return (
                                <label
                                  key={item.id}
                                  className={classNames(
                                    "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition",
                                    checked ? "border-violet bg-violet/10" : "border-violet/10 bg-violet/5",
                                  )}
                                >
                                  <span className="flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => togglePlanNewMedia(item.id)}
                                      className="size-4 accent-violet"
                                    />
                                    <span>
                                      <span className="font-medium text-ink">{item.title}</span>
                                      <span className="block text-xs text-ink/50">{item.category}</span>
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      </fieldset>

                      <label className="flex items-center gap-3 rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={planUseAi}
                          onChange={(event) => setPlanUseAi(event.target.checked)}
                          className="size-4 accent-violet"
                        />
                        <span className="text-ink/75">
                          Gerar legendas novas com IA para os reposts
                          <span className="block text-xs text-ink/50">
                            {woopStatus?.aiConfigured
                              ? "OpenAI configurada — legendas frescas de tarot por repost."
                              : "Sem OPENAI_API_KEY: usa variacao local para o repost nao sair identico."}
                          </span>
                        </span>
                      </label>

                      <button
                        type="button"
                        onClick={generateDailyPlan}
                        className="mt-2 rounded-full bg-violet px-5 py-3 text-sm font-medium text-white"
                      >
                        Gerar plano do dia
                      </button>
                    </div>
                  </Card>

                  <div className="grid gap-5">
                    <Card title="Grade gerada" description="Revise cada horario e o motivo da escolha antes de agendar.">
                      {dailyPlan ? (
                        <div className="grid gap-4">
                          <div className="flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full bg-violet/10 px-3 py-1 text-violet">{dailyPlan.summary.total} horarios</span>
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">{dailyPlan.summary.news} novo(s)</span>
                            <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-700">{dailyPlan.summary.reposts} repost(s)</span>
                            {dailyPlan.summary.empty ? (
                              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">{dailyPlan.summary.empty} vazio(s)</span>
                            ) : null}
                          </div>

                          <div className="grid gap-2">
                            {dailyPlan.slots.map((slot) => (
                              <article
                                key={slot.time}
                                className={classNames(
                                  "rounded-[1.1rem] border p-3",
                                  slot.kind === "empty" ? "border-amber-200 bg-amber-50" : "border-violet/10 bg-white",
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <span className="rounded-full bg-violet/8 px-3 py-1 text-xs font-medium text-violet">
                                      {String(slot.hour).padStart(2, "0")}:00
                                    </span>
                                    {slot.prime ? (
                                      <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] uppercase tracking-wide text-rose-700">
                                        nobre
                                      </span>
                                    ) : null}
                                    <SlotKindBadge kind={slot.kind} />
                                  </div>
                                  {slot.score !== null ? (
                                    <span className="text-xs text-ink/55">score {slot.score}/100</span>
                                  ) : null}
                                </div>
                                <p className="mt-2 text-sm font-medium text-ink">{slot.mediaTitle ?? "—"}</p>
                                <p className="mt-1 text-xs leading-5 text-ink/55">{slot.reason}</p>
                              </article>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={applyDailyPlan}
                            disabled={applyingPlan}
                            className="rounded-full bg-violet px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                          >
                            {applyingPlan ? "Agendando..." : "Aplicar plano (agendar tudo)"}
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-[1.25rem] border border-dashed border-violet/20 bg-violet/4 px-4 py-8 text-center text-sm text-ink/55">
                          Configure o dia ao lado e clique em <strong>Gerar plano do dia</strong> para ver a grade aqui.
                        </div>
                      )}
                    </Card>

                    <Card title="Ranking de repost" description="Conteudos ordenados pelo potencial de repostagem agora.">
                      <div className="grid gap-2">
                        {rankedCandidates.slice(0, 6).map(({ item, assessment }) => (
                          <article key={item.id} className="rounded-[1.1rem] border border-violet/10 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-ink">{item.title}</span>
                              <span
                                className={classNames(
                                  "rounded-full px-3 py-1 text-xs",
                                  assessment.recommended ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600",
                                )}
                              >
                                {assessment.score}/100
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-ink/55">
                              {assessment.recommended
                                ? "Pronto para repostar"
                                : assessment.inCooldown
                                  ? "Em descanso"
                                  : assessment.reachedRepostCap
                                    ? "Limite de reposts atingido"
                                    : "Abaixo do score minimo"}
                              {" · "}
                              {assessment.reasons[0]}
                            </p>
                          </article>
                        ))}
                        {rankedCandidates.length === 0 ? (
                          <p className="text-sm text-ink/55">Sem midias para avaliar.</p>
                        ) : null}
                      </div>
                    </Card>
                  </div>
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
                  <Card
                    title="Conectar contas (WoopSocial)"
                    description="A WoopSocial cuida do OAuth e da entrega para cada rede. Conecte cada conta abaixo; a chave fica em WOOPSOCIAL_API_KEY no servidor."
                  >
                    <div
                      className={classNames(
                        "mb-5 rounded-[1.25rem] border px-4 py-4 text-sm leading-6",
                        woopStatus?.configured && !woopStatus.error
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-amber-200 bg-amber-50 text-amber-900",
                      )}
                    >
                      {woopStatus === null
                        ? "Verificando configuracao da WoopSocial..."
                        : woopStatus.configured
                          ? woopStatus.error
                            ? `Chave configurada, mas houve erro ao consultar a WoopSocial: ${woopStatus.error}`
                            : `Conectado ao projeto ${woopStatus.projectName ?? woopStatus.projectId ?? "(padrao)"}. Conecte ou revise as contas abaixo.`
                          : "Defina WOOPSOCIAL_API_KEY (e opcionalmente WOOPSOCIAL_PROJECT_ID) no ambiente do servidor (Vercel) e faca um novo deploy."}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {(Object.keys(networkLabels) as NetworkKey[]).map((network) => {
                        const account = woopStatus?.accounts?.[network];
                        const connected = Boolean(account?.connected);
                        return (
                          <div key={network} className="flex items-center justify-between gap-3 rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                            <div>
                              <div className="text-sm font-medium text-ink">{networkLabels[network]}</div>
                              <div className="mt-1 text-xs text-ink/55">
                                {connected ? (account?.username ? `@${account.username}` : "conta conectada") : "conta nao conectada"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={connected ? "connected" : "pending"} />
                              <button
                                type="button"
                                disabled={!woopStatus?.configured || connectingNetwork === network}
                                onClick={() => connectNetwork(network)}
                                className="rounded-full bg-violet px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                              >
                                {connectingNetwork === network ? "Abrindo..." : connected ? "Reconectar" : "Conectar"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <SecondaryButton label="Atualizar status" onClick={refreshStatus} />
                    </div>

                    <div className="mt-4 grid gap-2 text-sm text-ink/60">
                      <div className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                        <span className="font-mono text-xs text-violet">WOOPSOCIAL_API_KEY</span>
                        <span className="ml-2 text-xs">{woopStatus?.configured ? "configurada" : "pendente"}</span>
                      </div>
                      <div className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                        <span className="font-mono text-xs text-violet">Projeto WoopSocial</span>
                        <span className="ml-2 text-xs">{woopStatus?.projectId ? woopStatus.projectName ?? woopStatus.projectId : "pendente"}</span>
                      </div>
                      <div className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                        <span className="font-mono text-xs text-violet">Cloudflare R2 (R2_*)</span>
                        <span className="ml-2 text-xs">{woopStatus?.r2Configured ? "configurado" : "pendente"}</span>
                      </div>
                    </div>
                  </Card>

                  <Card title="Como conectar" description="Fluxo de conexao via OAuth da WoopSocial.">
                    <ol className="grid list-decimal gap-2 pl-5 text-sm leading-6 text-ink/60">
                      <li>Defina <span className="font-mono text-xs text-violet">WOOPSOCIAL_API_KEY</span> no servidor (e opcionalmente <span className="font-mono text-xs text-violet">WOOPSOCIAL_PROJECT_ID</span>) e faca um novo deploy.</li>
                      <li>Clique em <strong>Conectar</strong> na rede desejada. Abrimos a autorizacao OAuth da WoopSocial em uma nova aba.</li>
                      <li>Autorize a conta na rede social e volte. Clique em <strong>Atualizar status</strong> para confirmar a conexao.</li>
                      <li>Publique e agende pela aba <strong>Agendamentos</strong>. Acompanhe o engajamento na aba <strong>Engajamento</strong>.</li>
                    </ol>
                  </Card>
                </section>
              ) : null}

              {activeView === "insights" ? (
                <section className="grid gap-5">
                  {/* Local analytics — from library data */}
                  <InsightsLocalView data={data} />

                  {/* WoopSocial-powered insights */}
                  <Card
                    title="Dados da WoopSocial"
                    description="Engajamento real puxado das contas conectadas."
                  >
                    <div className="mb-5 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={loadInsights}
                        disabled={insightsLoading || !woopStatus?.configured}
                        className="rounded-full bg-violet px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {insightsLoading ? "Puxando dados..." : "Atualizar dados dos posts"}
                      </button>
                      {!woopStatus?.configured ? (
                        <span className="text-xs text-ink/55">Configure a WoopSocial na aba Config para puxar os dados.</span>
                      ) : null}
                    </div>

                    {insightsError ? <FlashBanner flash={{ message: insightsError, kind: "error" }} className="mb-4" /> : null}

                    {insights ? (
                      <div className="grid gap-5">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <MetricCard label="Posts analisados" value={numberFmt.format(insights.totalPosts)} />
                          <MetricCard label="Nota media de engajamento" value={`${insights.avgScore}/100`} />
                          <MetricCard label="Total de curtidas" value={numberFmt.format(insights.totals.likes)} />
                        </div>

                        {!insights.metricsAvailable ? (
                          <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                            Os posts foram puxados, mas a WoopSocial ainda nao retornou metricas de engajamento para estas contas.
                          </div>
                        ) : null}

                        {insights.byNetwork.length ? (
                          <div>
                            <h4 className="mb-3 text-sm font-medium text-ink/75">Por rede</h4>
                            <div className="grid gap-3 md:grid-cols-2">
                              {insights.byNetwork.map((row) => (
                                <div key={row.network} className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-ink">{networkLabels[row.network]}</span>
                                    <span className="rounded-full bg-violet/10 px-3 py-1 text-xs text-violet">{row.avgScore}/100</span>
                                  </div>
                                  <p className="mt-2 text-xs text-ink/55">
                                    {row.posts} post(s) · {row.avgEngagementRate}% engajamento · {numberFmt.format(row.totals.views)} views
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div>
                          <h4 className="mb-3 text-sm font-medium text-ink/75">Top posts por engajamento</h4>
                          <div className="grid gap-2">
                            {insights.topPosts.length ? (
                              insights.topPosts.map((post) => (
                                <article key={post.id} className="rounded-[1.1rem] border border-violet/10 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                      {post.network ? (
                                        <span className="rounded-full bg-violet/8 px-3 py-1 text-xs font-medium text-violet">
                                          {networkLabels[post.network]}
                                        </span>
                                      ) : null}
                                      {post.publishedAt ? (
                                        <span className="text-xs text-ink/45">{formatDate(post.publishedAt)}</span>
                                      ) : null}
                                    </div>
                                    <span
                                      className={classNames(
                                        "rounded-full px-3 py-1 text-xs",
                                        post.score >= 60 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600",
                                      )}
                                    >
                                      {post.score}/100
                                    </span>
                                  </div>
                                  <p className="mt-2 line-clamp-2 text-sm text-ink/70">{post.caption || "(sem legenda)"}</p>
                                  <p className="mt-1 text-xs text-ink/50">
                                    {numberFmt.format(post.metrics.likes)} curtidas · {numberFmt.format(post.metrics.comments)} comentarios · {numberFmt.format(post.metrics.shares)} compart. · {post.engagementRate}% eng.
                                  </p>
                                </article>
                              ))
                            ) : (
                              <p className="text-sm text-ink/55">Nenhum post encontrado nas contas conectadas.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : !insightsLoading ? (
                      <div className="rounded-[1.25rem] border border-dashed border-violet/20 bg-violet/4 px-4 py-8 text-center text-sm text-ink/55">
                        Clique em <strong>Atualizar dados dos posts</strong> para puxar o engajamento.
                      </div>
                    ) : null}
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
  plan: {
    title: "Plano do dia",
    description: "Monte a grade do dia: 1-2 videos novos + reposts dos melhores conteudos, de 2 em 2 horas.",
    actionLabel: "Ver fila",
    onAction: (setActiveView) => () => setActiveView("scheduler"),
  },
  insights: {
    title: "Engajamento",
    description: "Pontuacao de engajamento dos posts puxados da WoopSocial, por rede e por post.",
    actionLabel: "Conectar contas",
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
  dashboard: {
    title: "Dashboard",
    description: "Visao geral de desempenho: comparativo diario de views e engajamento.",
    actionLabel: "Ver biblioteca",
    onAction: (setActiveView) => () => setActiveView("library"),
  },
  calendar: {
    title: "Calendario",
    description: "Visualizacao mensal de todos os posts agendados.",
    actionLabel: "Novo agendamento",
    onAction: (setActiveView) => () => setActiveView("scheduler"),
  },
  scripts: {
    title: "Roteiros",
    description: "Roteiros de conteudo e fila de gravacao.",
    actionLabel: "Novo roteiro",
    onAction: () => undefined,
  },
  competitors: {
    title: "Concorrentes",
    description: "Analise comparativa diaria com perfis concorrentes.",
    actionLabel: "Adicionar concorrente",
    onAction: () => undefined,
  },
};

const pageTitleMap: Record<ViewKey, string> = {
  dashboard: "Dashboard",
  library: "Biblioteca",
  calendar: "Calendario",
  scheduler: "Agendamentos",
  scripts: "Roteiros",
  plan: "Plano do dia",
  insights: "Engajamento",
  competitors: "Concorrentes",
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
    case "dashboard":
      return <DashboardIcon className="size-4" />;
    case "library":
      return <LibraryIcon className="size-4" />;
    case "calendar":
      return <CalendarIcon className="size-4" />;
    case "scheduler":
      return <ClockIcon className="size-4" />;
    case "scripts":
      return <ScriptIcon className="size-4" />;
    case "plan":
      return <CalendarIcon className="size-4" />;
    case "insights":
      return <ChartIcon className="size-4" />;
    case "competitors":
      return <CompetitorsIcon className="size-4" />;
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-violet/10 bg-violet/5 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-ink/50">{label}</div>
      <div className="mt-1 font-display text-2xl tracking-[-0.03em] text-ink">{value}</div>
    </div>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 20V5M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="7.5" y="12" width="3" height="5" rx="0.8" fill="currentColor" opacity="0.8" />
      <rect x="12.5" y="8" width="3" height="9" rx="0.8" fill="currentColor" opacity="0.6" />
      <rect x="17" y="10" width="3" height="7" rx="0.8" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.9" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="3" y="13" width="8" height="5" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="13" y="10" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" opacity="0.8" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ScriptIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 4h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="currentColor" opacity="0.7" />
      <path d="M14 4v6h6" fill="currentColor" opacity="0.4" />
      <path d="M8 13h8M8 17h5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function CompetitorsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="9" cy="8" r="3" fill="currentColor" opacity="0.8" />
      <circle cx="16" cy="8" r="3" fill="currentColor" opacity="0.5" />
      <path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="currentColor" opacity="0.6" />
      <path d="M14 19c0-3.3 2.7-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Dashboard View — Big numbers + yesterday/today comparison
// ═══════════════════════════════════════════════════════════════════════

function DashboardView({ data, setActiveView }: { data: PersistedState; setActiveView: (v: ViewKey) => void }) {
  const totalMedia = data.mediaLibrary.length;
  const totalScheduled = data.schedules.length;
  const avgScore = totalMedia
    ? Math.round(data.mediaLibrary.reduce((sum, m) => sum + (m.compositeScore ?? 0), 0) / totalMedia)
    : 0;
  const totalViews = data.mediaLibrary.reduce((sum, m) => {
    return sum + Object.values(m.stats).reduce((s, n) => s + n.views, 0);
  }, 0);
  const totalEngagement = totalMedia
    ? +(data.mediaLibrary.reduce((sum, m) => {
        const vals = Object.values(m.stats).filter((n) => n.views > 0);
        return sum + (vals.length ? vals.reduce((s, n) => s + n.engagement, 0) / vals.length : 0);
      }, 0) / totalMedia).toFixed(1)
    : 0;

  const topContent = [...data.mediaLibrary].sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0)).slice(0, 5);

  // Upcoming schedules (next 5)
  const upcoming = [...data.schedules]
    .filter((s) => new Date(s.scheduledFor).getTime() > Date.now())
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
    .slice(0, 5);

  // Script status counters
  const scriptsDraft = data.scripts.filter((s) => s.status === "draft").length;
  const scriptsReady = data.scripts.filter((s) => s.status === "ready").length;
  const scriptsRecorded = data.scripts.filter((s) => s.status === "recorded").length;

  return (
    <section className="grid gap-5">
      {/* Big Numbers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BigNumber label="Total de midias" value={totalMedia} icon="library" />
        <BigNumber label="Agendamentos" value={totalScheduled} icon="calendar" />
        <BigNumber label="Score medio" value={avgScore} suffix="/100" icon="chart" color={avgScore >= 60 ? "emerald" : avgScore >= 40 ? "amber" : "rose"} />
        <BigNumber label="Views totais" value={totalViews.toLocaleString("pt-BR")} icon="eye" />
      </div>

      {/* Quick actions row */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setActiveView("scheduler")} className="rounded-full bg-violet px-4 py-2 text-xs font-medium text-white shadow-md shadow-violet/15 transition hover:bg-violet/85">+ Novo agendamento</button>
        <button type="button" onClick={() => setActiveView("library")} className="rounded-full bg-violet/8 px-4 py-2 text-xs font-medium text-violet transition hover:bg-violet/15">Biblioteca</button>
        <button type="button" onClick={() => setActiveView("scripts")} className="rounded-full bg-violet/8 px-4 py-2 text-xs font-medium text-violet transition hover:bg-violet/15">Roteiros</button>
        <button type="button" onClick={() => setActiveView("insights")} className="rounded-full bg-violet/8 px-4 py-2 text-xs font-medium text-violet transition hover:bg-violet/15">Analytics</button>
      </div>

      {/* Engagement + Top Content */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
          <h3 className="mb-4 font-display text-lg tracking-tight">Engajamento medio</h3>
          <div className="flex items-end gap-3">
            <span className="font-display text-4xl tracking-tighter text-violet">{totalEngagement}%</span>
            <span className="mb-1 text-sm text-ink/50">media entre todas as midias</span>
          </div>
          <div className="mt-5 grid gap-2">
            {(Object.keys(networkLabels) as NetworkKey[]).map((network) => {
              const networkViews = data.mediaLibrary.reduce((s, m) => s + (m.stats[network]?.views ?? 0), 0);
              const networkAvgEng = totalMedia
                ? +(data.mediaLibrary.reduce((s, m) => s + (m.stats[network]?.engagement ?? 0), 0) / totalMedia).toFixed(1)
                : 0;
              return (
                <div key={network} className="flex items-center justify-between rounded-xl bg-violet/5 px-4 py-2.5 text-sm">
                  <span className="font-medium text-ink/70">{networkLabels[network]}</span>
                  <span className="text-ink/50">{networkViews.toLocaleString("pt-BR")} views · {networkAvgEng}% eng</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Top Content */}
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg tracking-tight">Top conteudos</h3>
            <button type="button" onClick={() => setActiveView("library")} className="text-xs text-violet hover:underline">Ver tudo</button>
          </div>
          <div className="grid gap-2">
            {topContent.map((item, i) => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl bg-violet/5 px-4 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-xs font-bold text-violet">
                  #{String(item.numericId ?? i + 1).padStart(3, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                  <p className="text-xs text-ink/50">{item.contentType ? contentTypeLabels[item.contentType] : item.format}</p>
                </div>
                <ScoreBadge score={item.compositeScore ?? 0} />
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Upcoming schedules + Script pipeline */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg tracking-tight">Proximos agendamentos</h3>
            <button type="button" onClick={() => setActiveView("calendar")} className="text-xs text-violet hover:underline">Calendario</button>
          </div>
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink/40">Nenhum agendamento futuro.</p>
          ) : (
            <div className="grid gap-2">
              {upcoming.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl bg-violet/5 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {s.contentType && (
                        <span className={classNames("rounded-full px-1.5 py-0.5 text-[9px] font-bold", contentTypeColors[s.contentType])}>{contentTypeLabels[s.contentType]}</span>
                      )}
                      <p className="truncate text-sm font-medium text-ink">{s.title}</p>
                    </div>
                    <p className="text-xs text-ink/45">{formatNetworkList(s.networks)}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-violet">{formatDate(s.scheduledFor)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg tracking-tight">Pipeline de roteiros</h3>
            <button type="button" onClick={() => setActiveView("scripts")} className="text-xs text-violet hover:underline">Ver todos</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-2xl font-bold text-ink/70">{scriptsDraft}</p>
              <p className="mt-1 text-[10px] font-medium text-ink/40">Rascunhos</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-2xl font-bold text-amber-700">{scriptsReady}</p>
              <p className="mt-1 text-[10px] font-medium text-amber-600/60">Pronto p/ gravar</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-2xl font-bold text-emerald-700">{scriptsRecorded}</p>
              <p className="mt-1 text-[10px] font-medium text-emerald-600/60">Gravados</p>
            </div>
          </div>
          {data.scripts.length === 0 && (
            <p className="mt-4 text-center text-xs text-ink/40">Nenhum roteiro criado ainda.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function BigNumber({ label, value, suffix, icon, color }: { label: string; value: string | number; suffix?: string; icon: string; color?: string }) {
  const colorClass = color === "emerald" ? "text-emerald-600" : color === "amber" ? "text-amber-600" : color === "rose" ? "text-rose-500" : "text-violet";
  return (
    <div className="rounded-[1.75rem] border border-violet/10 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-ink/40">{label}</p>
      <p className={classNames("mt-2 font-display text-3xl tracking-tighter", colorClass)}>
        {value}{suffix && <span className="text-lg text-ink/30">{suffix}</span>}
      </p>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const bg = score >= 70 ? "bg-emerald-100 text-emerald-700" : score >= 40 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600";
  return <span className={classNames("rounded-full px-2.5 py-1 text-xs font-bold", bg)}>{score}</span>;
}

// ═══════════════════════════════════════════════════════════════════════
// Calendar View — Notion-style monthly calendar
// ═══════════════════════════════════════════════════════════════════════

function CalendarView({
  schedules,
  mediaLibrary,
  setActiveView,
}: {
  schedules: ScheduleItem[];
  mediaLibrary: MediaItem[];
  setActiveView: (v: ViewKey) => void;
}) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build grid: 6 rows × 7 cols
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Group schedules by day
  const schedulesByDay: Record<number, ScheduleItem[]> = {};
  for (const schedule of schedules) {
    const d = new Date(schedule.scheduledFor);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      (schedulesByDay[day] ??= []).push(schedule);
    }
  }

  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const monthNames = ["Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  return (
    <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
      {/* Month nav */}
      <div className="mb-5 flex items-center justify-between">
        <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))} className="rounded-full bg-violet/8 px-3 py-1.5 text-sm font-medium text-violet hover:bg-violet/15">← Anterior</button>
        <h3 className="font-display text-xl tracking-tight">{monthNames[month]} {year}</h3>
        <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} className="rounded-full bg-violet/8 px-3 py-1.5 text-sm font-medium text-violet hover:bg-violet/15">Proximo →</button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-ink/40">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => (
          <div
            key={i}
            className={classNames(
              "min-h-[5.5rem] rounded-lg border p-1.5 text-xs transition",
              day ? "border-violet/8 bg-white hover:bg-violet/3" : "border-transparent",
              day && isToday(day) ? "ring-2 ring-violet/30" : "",
            )}
          >
            {day && (
              <>
                <span className={classNames("mb-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold", isToday(day) ? "bg-violet text-white" : "text-ink/50")}>{day}</span>
                <div className="grid gap-0.5">
                  {(schedulesByDay[day] ?? []).slice(0, 3).map((schedule) => {
                    const media = schedule.mediaId ? mediaLibrary.find((m) => m.id === schedule.mediaId) : null;
                    const ct = schedule.contentType ?? media?.contentType;
                    const colorCls = ct ? contentTypeColors[ct] : "bg-violet/20 text-violet";
                    return (
                      <div key={schedule.id} className={classNames("truncate rounded px-1 py-0.5 text-[9px] font-medium leading-tight", colorCls)} title={schedule.title}>
                        {new Date(schedule.scheduledFor).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} {schedule.title}
                      </div>
                    );
                  })}
                  {(schedulesByDay[day]?.length ?? 0) > 3 && (
                    <span className="text-[9px] text-ink/40">+{(schedulesByDay[day]?.length ?? 0) - 3} mais</span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-3 text-[10px] text-ink/50">
        {(Object.entries(contentTypeLabels) as [ContentType, string][]).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={classNames("inline-block size-2 rounded-full", contentTypeColors[key])} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Insights Local View — Analytics from local library data
// ═══════════════════════════════════════════════════════════════════════

function InsightsLocalView({ data }: { data: PersistedState }) {
  const organicMedia = data.mediaLibrary.filter((m) => m.contentType !== "ad" && !m.isAd && !m.isViral && m.status !== "archived");
  const adMedia = data.mediaLibrary.filter((m) => m.contentType === "ad" || m.isAd);
  const viralMedia = data.mediaLibrary.filter((m) => m.isViral && m.contentType !== "ad");

  const organicScore = organicMedia.length
    ? Math.round(organicMedia.reduce((sum, m) => sum + (m.compositeScore ?? 0), 0) / organicMedia.length)
    : 0;
  const adScore = adMedia.length
    ? Math.round(adMedia.reduce((sum, m) => sum + (m.compositeScore ?? 0), 0) / adMedia.length)
    : 0;

  const totalViews = data.mediaLibrary.reduce((sum, m) => {
    return sum + Object.values(m.stats).reduce((s, n) => s + n.views, 0);
  }, 0);

  // Per-network aggregate
  const networkAgg = (Object.keys(networkLabels) as NetworkKey[]).map((net) => {
    const items = organicMedia.filter((m) => m.stats[net].views > 0);
    const avgScore = items.length ? Math.round(items.reduce((s, m) => s + m.stats[net].score, 0) / items.length) : 0;
    const totalNetViews = items.reduce((s, m) => s + m.stats[net].views, 0);
    const avgEng = items.length ? +(items.reduce((s, m) => s + m.stats[net].engagement, 0) / items.length).toFixed(1) : 0;
    return { net, items: items.length, avgScore, totalNetViews, avgEng };
  });

  // Score distribution for bar chart
  const scoreRanges = [
    { label: "0-20", min: 0, max: 20, color: "bg-rose-400" },
    { label: "21-40", min: 21, max: 40, color: "bg-rose-300" },
    { label: "41-60", min: 41, max: 60, color: "bg-amber-400" },
    { label: "61-80", min: 61, max: 80, color: "bg-emerald-400" },
    { label: "81-100", min: 81, max: 100, color: "bg-emerald-500" },
  ];
  const scoreDist = scoreRanges.map((range) => ({
    ...range,
    count: organicMedia.filter((m) => (m.compositeScore ?? 0) >= range.min && (m.compositeScore ?? 0) <= range.max).length,
  }));
  const maxDist = Math.max(...scoreDist.map((d) => d.count), 1);

  // Content type breakdown
  const ctBreakdown = (Object.entries(contentTypeLabels) as [ContentType, string][]).map(([ct, label]) => ({
    ct,
    label,
    count: data.mediaLibrary.filter((m) => m.contentType === ct).length,
  }));
  const maxCt = Math.max(...ctBreakdown.map((d) => d.count), 1);

  return (
    <>
      {/* Score overview cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[1.25rem] border border-violet/10 bg-white p-4">
          <p className="text-xs font-medium text-ink/45">Score organico medio</p>
          <p className={classNames("mt-1 text-2xl font-bold", organicScore >= 70 ? "text-emerald-600" : organicScore >= 40 ? "text-amber-600" : "text-rose-500")}>{organicScore}</p>
          <p className="mt-0.5 text-[10px] text-ink/35">{organicMedia.length} midias organicas</p>
        </div>
        <div className="rounded-[1.25rem] border border-violet/10 bg-white p-4">
          <p className="text-xs font-medium text-ink/45">Score anuncios medio</p>
          <p className="mt-1 text-2xl font-bold text-rose-500">{adScore || "—"}</p>
          <p className="mt-0.5 text-[10px] text-ink/35">{adMedia.length} anuncios</p>
        </div>
        <div className="rounded-[1.25rem] border border-violet/10 bg-white p-4">
          <p className="text-xs font-medium text-ink/45">Total de views</p>
          <p className="mt-1 text-2xl font-bold text-violet">{totalViews >= 1000 ? `${(totalViews / 1000).toFixed(1)}k` : totalViews}</p>
          <p className="mt-0.5 text-[10px] text-ink/35">Todas as redes</p>
        </div>
        <div className="rounded-[1.25rem] border border-violet/10 bg-white p-4">
          <p className="text-xs font-medium text-ink/45">Virais detectados</p>
          <p className="mt-1 text-2xl font-bold text-violet">{viralMedia.length}</p>
          <p className="mt-0.5 text-[10px] text-ink/35">Separados do score organico</p>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Score distribution chart */}
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5">
          <h3 className="mb-4 font-display text-lg">Distribuicao de scores</h3>
          <div className="flex items-end gap-2" style={{ height: 120 }}>
            {scoreDist.map((d) => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-ink/50">{d.count}</span>
                <div
                  className={classNames("w-full rounded-t-md transition-all", d.color)}
                  style={{ height: `${(d.count / maxDist) * 100}%`, minHeight: d.count > 0 ? 8 : 2 }}
                />
                <span className="text-[9px] text-ink/40">{d.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Content type breakdown */}
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5">
          <h3 className="mb-4 font-display text-lg">Por tipo de conteudo</h3>
          <div className="grid gap-3">
            {ctBreakdown.map((d) => (
              <div key={d.ct} className="flex items-center gap-3">
                <span className={classNames("w-16 rounded-full px-2 py-0.5 text-center text-[10px] font-bold", contentTypeColors[d.ct])}>{d.label}</span>
                <div className="flex-1">
                  <div className="h-5 overflow-hidden rounded-full bg-violet/6">
                    <div
                      className={classNames("h-full rounded-full transition-all", contentTypeColors[d.ct])}
                      style={{ width: `${(d.count / maxCt) * 100}%`, minWidth: d.count > 0 ? 16 : 0 }}
                    />
                  </div>
                </div>
                <span className="w-8 text-right text-xs font-bold text-ink/50">{d.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Per-network performance */}
      <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5">
        <h3 className="mb-4 font-display text-lg">Performance por rede (organico)</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {networkAgg.map((row) => (
            <div key={row.net} className="rounded-xl border border-violet/8 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">{networkLabels[row.net]}</span>
                <span className={classNames(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                  row.avgScore >= 70 ? "bg-emerald-100 text-emerald-700" : row.avgScore >= 40 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-600",
                )}>
                  {row.avgScore}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 text-[10px] text-ink/50">
                <span>{row.items} midia(s)</span>
                <span>{row.totalNetViews >= 1000 ? `${(row.totalNetViews / 1000).toFixed(1)}k` : row.totalNetViews} views</span>
                <span>{row.avgEng}% eng.</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Scripts View — Roteiros & fila de gravação
// ═══════════════════════════════════════════════════════════════════════

function ScriptsView({ data, persist }: { data: PersistedState; persist: (state: PersistedState, msg?: string) => void }) {
  const [showForm, setShowForm] = useState(false);

  function handleCreateScript(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const contentType = String(formData.get("contentType") ?? "reel") as ContentType;
    if (!title) return;

    const nextId = data.nextScriptNumericId ?? 1;
    const script: Script = {
      id: randomId("script"),
      numericId: nextId,
      title,
      body,
      contentType,
      status: "draft",
      mediaId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persist({ ...data, scripts: [script, ...data.scripts], nextScriptNumericId: nextId + 1 }, "Roteiro criado.");
    setShowForm(false);
  }

  function updateScriptStatus(scriptId: string, status: ScriptStatus) {
    persist({
      ...data,
      scripts: data.scripts.map((s) => (s.id === scriptId ? { ...s, status, updatedAt: new Date().toISOString() } : s)),
    });
  }

  const statusLabels: Record<ScriptStatus, string> = { draft: "Rascunho", ready: "Pronto p/ gravar", recorded: "Gravado", archived: "Arquivado" };
  const statusColors: Record<ScriptStatus, string> = { draft: "bg-gray-100 text-gray-600", ready: "bg-amber-100 text-amber-700", recorded: "bg-emerald-100 text-emerald-700", archived: "bg-ink/10 text-ink/40" };

  return (
    <section className="grid gap-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setShowForm(!showForm)} className="rounded-full bg-violet px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet/15 transition hover:bg-violet/85">
          {showForm ? "Cancelar" : "+ Novo roteiro"}
        </button>
      </div>

      {showForm && (
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
          <h3 className="mb-4 font-display text-lg">Novo roteiro</h3>
          <FormGrid action={handleCreateScript}>
            <Field label="Titulo" name="title" placeholder="Ex: Review do produto X" />
            <SelectField label="Tipo de conteudo" name="contentType" options={[
              { label: "Reels", value: "reel" },
              { label: "Story", value: "story" },
              { label: "Anuncio", value: "ad" },
              { label: "Organico", value: "organic" },
            ]} />
            <label className="grid gap-2 text-sm font-medium">
              <span className="text-ink/75">Roteiro</span>
              <textarea name="body" rows={6} placeholder="Escreva o roteiro aqui..." className="rounded-2xl border border-violet/12 bg-white px-4 py-3 text-sm outline-none transition focus:border-violet" />
            </label>
            <PrimaryButton label="Salvar roteiro" />
          </FormGrid>
        </section>
      )}

      {/* Script list */}
      <div className="grid gap-3">
        {data.scripts.length === 0 && !showForm && (
          <p className="rounded-2xl border border-dashed border-violet/15 px-6 py-10 text-center text-sm text-ink/40">Nenhum roteiro ainda. Crie o primeiro!</p>
        )}
        {data.scripts.map((script) => (
          <div key={script.id} className="rounded-[1.25rem] border border-violet/10 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-violet/10 px-2 py-1 text-xs font-bold text-violet">#{String(script.numericId ?? 0).padStart(3, "0")}</span>
                <span className={classNames("rounded-full px-2 py-0.5 text-[10px] font-bold", contentTypeColors[script.contentType])}>{contentTypeLabels[script.contentType]}</span>
              </div>
              <span className={classNames("rounded-full px-2.5 py-1 text-[10px] font-bold", statusColors[script.status])}>{statusLabels[script.status]}</span>
            </div>
            <h4 className="mt-2 font-medium text-ink">{script.title}</h4>
            {script.body && <p className="mt-1 line-clamp-2 text-sm text-ink/55">{script.body}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {script.status === "draft" && <button type="button" onClick={() => updateScriptStatus(script.id, "ready")} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200">Marcar pronto</button>}
              {script.status === "ready" && <button type="button" onClick={() => updateScriptStatus(script.id, "recorded")} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200">Marcar gravado</button>}
              {script.status !== "archived" && <button type="button" onClick={() => updateScriptStatus(script.id, "archived")} className="rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink/40 hover:bg-ink/10">Arquivar</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Competitors View
// ═══════════════════════════════════════════════════════════════════════

function CompetitorsView({ data, persist }: { data: PersistedState; persist: (state: PersistedState, msg?: string) => void }) {
  const [showForm, setShowForm] = useState(false);

  function handleAddCompetitor(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const handle = String(formData.get("handle") ?? "").trim();
    const platform = String(formData.get("platform") ?? "instagram") as NetworkKey;
    if (!name || !handle) return;

    const competitor: Competitor = { id: randomId("comp"), name, handle, platform, addedAt: new Date().toISOString() };
    persist({ ...data, competitors: [competitor, ...data.competitors] }, "Concorrente adicionado.");
    setShowForm(false);
  }

  function removeCompetitor(id: string) {
    persist({ ...data, competitors: data.competitors.filter((c) => c.id !== id) });
  }

  return (
    <section className="grid gap-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setShowForm(!showForm)} className="rounded-full bg-violet px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet/15 transition hover:bg-violet/85">
          {showForm ? "Cancelar" : "+ Adicionar concorrente"}
        </button>
      </div>

      {showForm && (
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
          <h3 className="mb-4 font-display text-lg">Novo concorrente</h3>
          <FormGrid action={handleAddCompetitor}>
            <Field label="Nome" name="name" placeholder="Ex: Fulano" />
            <Field label="Arroba / Handle" name="handle" placeholder="@fulano" />
            <SelectField label="Plataforma" name="platform" options={[
              { label: "Instagram", value: "instagram" },
              { label: "TikTok", value: "tiktok" },
              { label: "YouTube", value: "youtube" },
              { label: "Facebook", value: "facebook" },
            ]} />
            <PrimaryButton label="Adicionar" />
          </FormGrid>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {data.competitors.length === 0 && !showForm && (
          <p className="col-span-full rounded-2xl border border-dashed border-violet/15 px-6 py-10 text-center text-sm text-ink/40">Nenhum concorrente cadastrado ainda.</p>
        )}
        {data.competitors.map((comp) => (
          <div key={comp.id} className="flex items-center justify-between rounded-[1.25rem] border border-violet/10 bg-white p-4">
            <div>
              <p className="font-medium text-ink">{comp.name}</p>
              <p className="text-sm text-ink/50">{comp.handle} · {networkLabels[comp.platform]}</p>
            </div>
            <button type="button" onClick={() => removeCompetitor(comp.id)} className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-500 hover:bg-rose-100">Remover</button>
          </div>
        ))}
      </div>

      {data.competitors.length > 0 && (
        <section className="rounded-[1.75rem] border border-violet/10 bg-white p-5 md:p-6">
          <h3 className="mb-3 font-display text-lg">Analise comparativa</h3>
          <p className="text-sm text-ink/50">A analise automatica por IA sera ativada em breve. Cadastre os concorrentes e o sistema coletara dados diarios para comparacao.</p>
        </section>
      )}
    </section>
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

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="text-ink/75">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isNaN(next) ? 0 : next);
        }}
        className="rounded-2xl border border-violet/12 bg-violet/5 px-4 py-3 outline-none transition focus:border-violet focus:bg-white"
      />
      {hint ? <span className="text-xs font-normal text-ink/50">{hint}</span> : null}
    </label>
  );
}

function SlotKindBadge({ kind }: { kind: "new" | "repost" | "empty" }) {
  const map = {
    new: { label: "novo", className: "bg-emerald-100 text-emerald-700" },
    repost: { label: "repost", className: "bg-sky-100 text-sky-700" },
    empty: { label: "vazio", className: "bg-amber-100 text-amber-700" },
  } as const;
  const meta = map[kind];
  return <span className={classNames("rounded-full px-2 py-1 text-[10px] uppercase tracking-wide", meta.className)}>{meta.label}</span>;
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
