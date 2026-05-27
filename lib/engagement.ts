import { WoopSocialAccountPost } from "@/lib/woopsocial";
import { NetworkKey } from "@/types/app";

// ---------------------------------------------------------------------------
// Pontuacao de engajamento.
//
// Le os posts puxados da WoopSocial e calcula, por post, uma nota de
// engajamento (0-100) combinando interacoes (curtidas, comentarios,
// compartilhamentos, salvamentos) ponderadas pelo alcance. Tudo defensivo:
// metricas podem chegar em campos/aninhamentos diferentes por plataforma, por
// isso varremos os nomes mais comuns e seguimos com o que estiver disponivel.
// ---------------------------------------------------------------------------

export type PostMetrics = {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  impressions: number;
  reach: number;
  clicks: number;
};

const METRIC_ALIASES: Record<keyof PostMetrics, string[]> = {
  likes: ["likes", "likeCount", "likes_count", "favorites", "reactions", "reactionCount"],
  comments: ["comments", "commentCount", "comments_count", "replies"],
  shares: ["shares", "shareCount", "shares_count", "retweets", "reposts"],
  saves: ["saves", "saveCount", "saved", "bookmarks"],
  views: ["views", "viewCount", "videoViews", "plays", "playCount"],
  impressions: ["impressions", "impressionCount"],
  reach: ["reach", "reachCount", "uniqueImpressions"],
  clicks: ["clicks", "clickCount", "linkClicks"],
};

const METRIC_CONTAINERS = ["metrics", "insights", "analytics", "statistics", "stats", "engagement", "metricsData"];

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[, ]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Procura uma metrica varrendo o objeto-raiz e os possiveis containers aninhados. */
function readMetric(post: WoopSocialAccountPost, aliases: string[]): number {
  const sources: Record<string, unknown>[] = [post];
  for (const container of METRIC_CONTAINERS) {
    const nested = post[container];
    if (nested && typeof nested === "object") {
      sources.push(nested as Record<string, unknown>);
    }
  }

  for (const source of sources) {
    for (const alias of aliases) {
      if (alias in source && source[alias] != null) {
        return toNumber(source[alias]);
      }
    }
  }
  return 0;
}

export function extractMetrics(post: WoopSocialAccountPost): PostMetrics {
  return {
    likes: readMetric(post, METRIC_ALIASES.likes),
    comments: readMetric(post, METRIC_ALIASES.comments),
    shares: readMetric(post, METRIC_ALIASES.shares),
    saves: readMetric(post, METRIC_ALIASES.saves),
    views: readMetric(post, METRIC_ALIASES.views),
    impressions: readMetric(post, METRIC_ALIASES.impressions),
    reach: readMetric(post, METRIC_ALIASES.reach),
    clicks: readMetric(post, METRIC_ALIASES.clicks),
  };
}

export function hasMetrics(metrics: PostMetrics): boolean {
  return Object.values(metrics).some((value) => value > 0);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/** Interacoes ponderadas: comentario/salvamento/compartilhamento valem mais que curtida. */
export function weightedInteractions(metrics: PostMetrics): number {
  return (
    metrics.likes +
    metrics.comments * 2 +
    metrics.shares * 3 +
    metrics.saves * 2 +
    metrics.clicks
  );
}

/** Denominador de alcance: prioriza reach, cai para impressions e depois views. */
function audience(metrics: PostMetrics): number {
  return metrics.reach || metrics.impressions || metrics.views || 0;
}

/** Taxa de engajamento (%) = interacoes ponderadas / alcance. */
export function engagementRate(metrics: PostMetrics): number {
  const base = audience(metrics);
  if (base <= 0) {
    return 0;
  }
  return Number(((weightedInteractions(metrics) / base) * 100).toFixed(2));
}

/**
 * Nota de engajamento (0-100). Combina:
 *  - taxa de engajamento (peso maior — qualidade da interacao);
 *  - volume de alcance em escala logaritmica (reforco — conteudo que viraliza).
 */
export function engagementScore(metrics: PostMetrics): number {
  const rate = engagementRate(metrics);
  const base = audience(metrics);
  const interactions = weightedInteractions(metrics);

  // Sem alcance, mas com interacoes: pontua so pelo volume de interacoes.
  if (base <= 0) {
    return Math.round(clamp((Math.log10(interactions + 1) / 4) * 100));
  }

  const rateNorm = clamp(rate * 10); // 10% de engajamento ~ nota cheia nesse eixo
  const reachNorm = clamp((Math.log10(base + 1) / 6) * 100);
  return Math.round(clamp(rateNorm * 0.7 + reachNorm * 0.3));
}

export type ScoredPost = {
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

function firstString(post: WoopSocialAccountPost, keys: string[]): string | null {
  for (const key of keys) {
    const value = post[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
}

function extractCaption(post: WoopSocialAccountPost): string {
  const direct = firstString(post, ["caption", "text", "title", "message"]);
  if (direct) {
    return direct;
  }
  const content = post.content;
  if (Array.isArray(content) && content.length) {
    const item = content[0];
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
      return String((item as Record<string, unknown>).text);
    }
  }
  return "";
}

export function scorePost(post: WoopSocialAccountPost, network: NetworkKey | null): ScoredPost {
  const metrics = extractMetrics(post);
  return {
    id:
      firstString(post, ["socialAccountPostId", "id", "postId"]) ??
      `${network ?? "post"}-${Math.random().toString(16).slice(2)}`,
    network,
    platform: firstString(post, ["platform"]) ?? "",
    caption: extractCaption(post),
    publishedAt: firstString(post, ["publishedAt", "postedAt", "createdAt", "updatedAt"]),
    permalink: firstString(post, ["permalink", "url", "link"]),
    metrics,
    engagementRate: engagementRate(metrics),
    score: engagementScore(metrics),
    hasMetrics: hasMetrics(metrics),
  };
}

export type NetworkEngagement = {
  network: NetworkKey;
  posts: number;
  avgScore: number;
  avgEngagementRate: number;
  totals: PostMetrics;
};

export type EngagementDashboard = {
  totalPosts: number;
  postsWithMetrics: number;
  avgScore: number;
  totals: PostMetrics;
  byNetwork: NetworkEngagement[];
  topPosts: ScoredPost[];
  metricsAvailable: boolean;
};

function zeroMetrics(): PostMetrics {
  return { likes: 0, comments: 0, shares: 0, saves: 0, views: 0, impressions: 0, reach: 0, clicks: 0 };
}

function addMetrics(target: PostMetrics, source: PostMetrics) {
  (Object.keys(target) as (keyof PostMetrics)[]).forEach((key) => {
    target[key] += source[key];
  });
}

export function buildEngagementDashboard(scored: ScoredPost[]): EngagementDashboard {
  const totals = zeroMetrics();
  const networkBuckets = new Map<NetworkKey, { posts: ScoredPost[]; totals: PostMetrics }>();

  for (const post of scored) {
    addMetrics(totals, post.metrics);
    if (post.network) {
      const bucket = networkBuckets.get(post.network) ?? { posts: [], totals: zeroMetrics() };
      bucket.posts.push(post);
      addMetrics(bucket.totals, post.metrics);
      networkBuckets.set(post.network, bucket);
    }
  }

  const postsWithMetrics = scored.filter((post) => post.hasMetrics);
  const avgScore = postsWithMetrics.length
    ? Math.round(postsWithMetrics.reduce((sum, post) => sum + post.score, 0) / postsWithMetrics.length)
    : 0;

  const byNetwork: NetworkEngagement[] = Array.from(networkBuckets.entries()).map(([network, bucket]) => {
    const scored = bucket.posts.filter((post) => post.hasMetrics);
    const avg = scored.length ? Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length) : 0;
    const avgRate = scored.length
      ? Number((scored.reduce((s, p) => s + p.engagementRate, 0) / scored.length).toFixed(2))
      : 0;
    return { network, posts: bucket.posts.length, avgScore: avg, avgEngagementRate: avgRate, totals: bucket.totals };
  });

  const topPosts = [...scored].sort((a, b) => b.score - a.score).slice(0, 10);

  return {
    totalPosts: scored.length,
    postsWithMetrics: postsWithMetrics.length,
    avgScore,
    totals,
    byNetwork,
    topPosts,
    metricsAvailable: postsWithMetrics.length > 0,
  };
}
