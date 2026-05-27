import { ContentType, NetworkKey, PersistedState } from "@/types/app";

export const STORAGE_KEY = "pulsepost-admin-state-v3";
export const SESSION_STORAGE_KEY = "megumi-media-center-session-user-id";

export const networkLabels: Record<NetworkKey, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube Shorts",
  tiktok: "TikTok",
};

export const contentTypeLabels: Record<ContentType, string> = {
  reel: "Reels",
  story: "Story",
  ad: "Anuncio",
  organic: "Organico",
};

export const contentTypeColors: Record<ContentType, string> = {
  reel: "bg-violet text-white",
  story: "bg-amber-500 text-white",
  ad: "bg-rose-500 text-white",
  organic: "bg-emerald-500 text-white",
};

/** Infer contentType from legacy format string. */
export function inferContentType(format: string, isAd?: boolean): ContentType {
  if (isAd) return "ad";
  const lower = format.toLowerCase();
  if (lower.includes("story") || lower.includes("stories")) return "story";
  if (lower.includes("reel") || lower.includes("short")) return "reel";
  return "organic";
}

export const seedState: PersistedState = {
  users: [
    {
      id: "user-admin-ericka",
      name: "Ericka Oki",
      email: "erickaoki@icloud.com",
      password: "larissa3105",
      role: "admin",
      createdAt: "2026-05-09T12:00:00.000Z",
    },
  ],
  mediaLibrary: [
    {
      id: "media-autumn-drop",
      numericId: 1,
      title: "Colecao de outono em movimento",
      type: "video",
      format: "Reel / Short",
      contentType: "reel",
      duration: "00:24",
      status: "active",
      category: "Moda",
      fileName: "colecao-outono.mp4",
      createdAt: "2026-05-06T14:30:00.000Z",
      compositeScore: 77,
      stats: {
        instagram: { views: 18200, engagement: 7.9, score: 82 },
        facebook: { views: 5400, engagement: 4.6, score: 61 },
        youtube: { views: 9300, engagement: 6.1, score: 74 },
        tiktok: { views: 21400, engagement: 8.8, score: 90 },
      },
    },
    {
      id: "media-backstage-cut",
      numericId: 2,
      title: "Bastidores da gravacao",
      type: "video",
      format: "TikTok / Reel",
      contentType: "reel",
      duration: "00:18",
      status: "review",
      category: "Bastidores",
      fileName: "bastidores-gravacao.mp4",
      createdAt: "2026-05-04T10:15:00.000Z",
      compositeScore: 35,
      stats: {
        instagram: { views: 3100, engagement: 2.2, score: 39 },
        facebook: { views: 1400, engagement: 1.4, score: 24 },
        youtube: { views: 2800, engagement: 1.9, score: 31 },
        tiktok: { views: 6200, engagement: 3.1, score: 44 },
      },
    },
    {
      id: "media-campaign-still",
      numericId: 3,
      title: "Campanha still premium",
      type: "image",
      format: "Feed / Stories",
      contentType: "organic",
      duration: "Imagem",
      status: "active",
      category: "Campanha",
      fileName: "campanha-premium.jpg",
      createdAt: "2026-05-03T16:00:00.000Z",
      compositeScore: 36,
      stats: {
        instagram: { views: 9700, engagement: 6.6, score: 76 },
        facebook: { views: 4100, engagement: 5.2, score: 66 },
        youtube: { views: 0, engagement: 0, score: 0 },
        tiktok: { views: 0, engagement: 0, score: 0 },
      },
    },
  ],
  schedules: [
    {
      id: "schedule-sunday-drop",
      title: "Drop de domingo",
      mediaId: "media-autumn-drop",
      networks: ["instagram", "facebook", "youtube", "tiktok"],
      scheduledFor: "2026-05-11T18:30",
      caption: "Novo drop no ar. Versao curta adaptada para cada rede.",
      contentType: "reel",
      status: "scheduled",
      repostRuleId: "rule-weekly-winners",
    },
    {
      id: "schedule-backstage-cut",
      title: "Recorte backstage",
      mediaId: "media-backstage-cut",
      networks: ["instagram", "tiktok"],
      scheduledFor: "2026-05-13T12:00",
      caption: "Bastidores em formato rapido para aquecer a audiencia.",
      contentType: "reel",
      status: "scheduled",
      repostRuleId: null,
    },
  ],
  repostRules: [
    {
      id: "rule-weekly-winners",
      name: "Repostar campeoes semanais",
      minScore: 72,
      intervalDays: 14,
      maxReposts: 3,
      removeBelowScore: 35,
      networks: ["instagram", "youtube", "tiktok"],
      active: true,
    },
    {
      id: "rule-review-weak-creatives",
      name: "Revisar criativos fracos",
      minScore: 50,
      intervalDays: 21,
      maxReposts: 1,
      removeBelowScore: 30,
      networks: ["facebook", "instagram"],
      active: false,
    },
  ],
  audit: [
    {
      id: "audit-seed",
      type: "seed",
      message: "Base inicial criada com usuario admin padrao.",
      createdAt: "2026-05-09T12:00:00.000Z",
    },
  ],
  scripts: [],
  recordingQueue: [],
  captions: [],
  competitors: [],
  competitorSnapshots: [],
  dailySnapshots: [],
  nextMediaNumericId: 4,
  nextScriptNumericId: 1,
};
