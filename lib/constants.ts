import { NetworkKey, PersistedState } from "@/types/app";

export const STORAGE_KEY = "pulsepost-admin-state-v2";

export const networkLabels: Record<NetworkKey, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube Shorts",
  tiktok: "TikTok",
};

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
      title: "Colecao de outono em movimento",
      type: "video",
      format: "Reel / Short",
      duration: "00:24",
      status: "active",
      category: "Moda",
      fileName: "colecao-outono.mp4",
      createdAt: "2026-05-06T14:30:00.000Z",
      stats: {
        instagram: { views: 18200, engagement: 7.9, score: 82 },
        facebook: { views: 5400, engagement: 4.6, score: 61 },
        youtube: { views: 9300, engagement: 6.1, score: 74 },
        tiktok: { views: 21400, engagement: 8.8, score: 90 },
      },
    },
    {
      id: "media-backstage-cut",
      title: "Bastidores da gravacao",
      type: "video",
      format: "TikTok / Reel",
      duration: "00:18",
      status: "review",
      category: "Bastidores",
      fileName: "bastidores-gravacao.mp4",
      createdAt: "2026-05-04T10:15:00.000Z",
      stats: {
        instagram: { views: 3100, engagement: 2.2, score: 39 },
        facebook: { views: 1400, engagement: 1.4, score: 24 },
        youtube: { views: 2800, engagement: 1.9, score: 31 },
        tiktok: { views: 6200, engagement: 3.1, score: 44 },
      },
    },
    {
      id: "media-campaign-still",
      title: "Campanha still premium",
      type: "image",
      format: "Feed / Stories",
      duration: "Imagem",
      status: "active",
      category: "Campanha",
      fileName: "campanha-premium.jpg",
      createdAt: "2026-05-03T16:00:00.000Z",
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
};
