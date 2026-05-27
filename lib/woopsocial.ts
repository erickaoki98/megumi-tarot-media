import "server-only";

import { NetworkKey } from "@/types/app";

// ---------------------------------------------------------------------------
// Cliente WoopSocial (https://docs.woopsocial.com).
//
// Base: https://api.woopsocial.com/v1 — autenticacao via Bearer token.
// Um unico WOOPSOCIAL_API_KEY (+ projeto) cuida do OAuth e da entrega por rede.
// ---------------------------------------------------------------------------

const API_BASE = process.env.WOOPSOCIAL_API_BASE?.replace(/\/$/, "") || "https://api.woopsocial.com/v1";

export type WoopPlatform = "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK";

export const networkToPlatform: Record<NetworkKey, WoopPlatform> = {
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  youtube: "YOUTUBE",
  tiktok: "TIKTOK",
};

export const platformToNetwork: Partial<Record<string, NetworkKey>> = {
  INSTAGRAM: "instagram",
  FACEBOOK: "facebook",
  YOUTUBE: "youtube",
  TIKTOK: "tiktok",
};

function getApiKey(): string | null {
  return process.env.WOOPSOCIAL_API_KEY?.trim() || null;
}

function getConfiguredProjectId(): string | null {
  return process.env.WOOPSOCIAL_PROJECT_ID?.trim() || null;
}

export function isWoopConfigured(): boolean {
  return Boolean(getApiKey());
}

export class WoopSocialError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "WoopSocialError";
  }
}

type RequestOptions = RequestInit & { rawBody?: BodyInit };

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new WoopSocialError("WOOPSOCIAL_API_KEY nao configurada no servidor.", 500);
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `Erro ${response.status} na API WoopSocial.`;
    throw new WoopSocialError(message, response.status);
  }

  return parsed as T;
}

// Respostas da API podem vir como array puro ou embrulhadas; normalizamos aqui.
function asArray<T>(value: unknown, ...keys: string[]): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (value && typeof value === "object") {
    for (const key of keys) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner)) {
        return inner as T[];
      }
    }
  }
  return [];
}

function pickId(value: unknown, ...keys: string[]): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const key of keys) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "string" && v) {
      return v;
    }
  }
  return null;
}

export type WoopProject = { id: string; name: string | null };

export async function listProjects(): Promise<WoopProject[]> {
  const data = await request<unknown>("/projects");
  return asArray<Record<string, unknown>>(data, "projects", "data").map((p) => ({
    id: String(p.id ?? ""),
    name: typeof p.name === "string" ? p.name : null,
  }));
}

let cachedProjectId: string | null = null;

/** Resolve o projeto: usa WOOPSOCIAL_PROJECT_ID ou o primeiro projeto da conta. */
export async function resolveProjectId(): Promise<string | null> {
  const configured = getConfiguredProjectId();
  if (configured) {
    return configured;
  }
  if (cachedProjectId) {
    return cachedProjectId;
  }
  const projects = await listProjects();
  cachedProjectId = projects[0]?.id ?? null;
  return cachedProjectId;
}

export type WoopSocialAccount = {
  id: string;
  platform: string;
  username: string | null;
  status: string | null;
};

export async function listSocialAccounts(projectId?: string): Promise<WoopSocialAccount[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const data = await request<unknown>(`/social-accounts${query}`);
  return asArray<Record<string, unknown>>(data, "socialAccounts", "data").map((a) => ({
    id: String(a.id ?? ""),
    platform: String(a.platform ?? ""),
    username:
      (typeof a.username === "string" && a.username) ||
      (typeof a.displayName === "string" && a.displayName) ||
      (typeof a.handle === "string" && a.handle) ||
      null,
    status: typeof a.status === "string" ? a.status : null,
  }));
}

export async function createOAuthAuthorization(params: {
  platform: WoopPlatform;
  projectId: string;
  redirectUrl?: string;
}): Promise<{ url: string }> {
  const body: Record<string, unknown> = {
    platform: params.platform,
    projectId: params.projectId,
  };
  if (params.redirectUrl) {
    body.redirectUrl = params.redirectUrl;
  }
  const data = await request<Record<string, unknown>>("/social-accounts/oauth-authorization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const url = typeof data.url === "string" ? data.url : null;
  if (!url) {
    throw new WoopSocialError("WoopSocial nao retornou a URL de autorizacao.", 502);
  }
  return { url };
}

export async function uploadMediaBlob(blob: Blob, projectId: string): Promise<{ id: string }> {
  const data = await request<unknown>(`/media?projectId=${encodeURIComponent(projectId)}`, {
    method: "POST",
    headers: blob.type ? { "Content-Type": blob.type } : undefined,
    body: blob,
  });
  const id =
    pickId(data, "id", "mediaId") ??
    pickId((data as Record<string, unknown>)?.media, "id", "mediaId");
  if (!id) {
    throw new WoopSocialError("WoopSocial nao retornou o id da midia enviada.", 502);
  }
  return { id };
}

type SocialAccountTarget = {
  socialAccountId: string;
  platform: WoopPlatform;
  isImage: boolean;
  title: string;
  format?: string;
};

function buildSocialAccountInput({ socialAccountId, platform, isImage, title, format }: SocialAccountTarget): Record<string, unknown> {
  const base: Record<string, unknown> = { platform, socialAccountId };
  const isStory = format?.toLowerCase() === "story";
  switch (platform) {
    case "INSTAGRAM":
      return { ...base, postType: isStory ? "STORY" : isImage ? "POST" : "REEL" };
    case "FACEBOOK":
      return { ...base, postType: isStory ? "STORY" : isImage ? "POST" : "REEL" };
    case "YOUTUBE":
      return { ...base, title: title || "Post", privacy: "public" };
    case "TIKTOK":
      return { ...base, privacyLevel: "PUBLIC_TO_EVERYONE" };
    default:
      return base;
  }
}

export type CreatePostParams = {
  title: string;
  caption: string;
  scheduledFor: string;
  mediaId: string | null;
  isImage: boolean;
  schedule: boolean;
  format?: string;
  accounts: { socialAccountId: string; platform: WoopPlatform }[];
};

export type WoopPost = { id: string; status: string };

function buildSchedule(params: { schedule: boolean; scheduledFor: string }) {
  if (!params.schedule) {
    return { type: "DRAFT" as const };
  }
  if (params.scheduledFor) {
    const date = new Date(params.scheduledFor);
    if (!Number.isNaN(date.getTime()) && date.getTime() > Date.now()) {
      return { type: "SCHEDULE_FOR_LATER" as const, scheduledFor: date.toISOString() };
    }
  }
  return { type: "PUBLISH_NOW" as const };
}

export async function createPost(params: CreatePostParams): Promise<WoopPost> {
  const media = params.mediaId ? [{ type: "MEDIA_LIBRARY", mediaId: params.mediaId }] : [];
  const body = {
    content: [{ text: params.caption, media }],
    schedule: buildSchedule(params),
    socialAccounts: params.accounts.map((account) =>
      buildSocialAccountInput({
        socialAccountId: account.socialAccountId,
        platform: account.platform,
        isImage: params.isImage,
        title: params.title,
        format: params.format,
      }),
    ),
  };

  const data = await request<Record<string, unknown>>("/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    id: pickId(data, "id", "postId") ?? "",
    status: typeof data.status === "string" ? data.status : params.schedule ? "SCHEDULED" : "DRAFT",
  };
}

export type WoopSocialAccountPost = Record<string, unknown>;

export async function listSocialAccountPosts(
  socialAccountId: string,
  limit = 50,
): Promise<WoopSocialAccountPost[]> {
  const collected: WoopSocialAccountPost[] = [];
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams();
    if (cursor) {
      query.set("cursor", cursor);
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const data: Record<string, unknown> = await request<Record<string, unknown>>(
      `/social-accounts/${encodeURIComponent(socialAccountId)}/posts${suffix}`,
    );
    const page = asArray<WoopSocialAccountPost>(data, "socialAccountPosts", "data", "posts");
    collected.push(...page);
    const next = data.nextCursor;
    cursor = typeof next === "string" && next ? next : null;
  } while (cursor && collected.length < limit);

  return collected.slice(0, limit);
}

export type WoopStatus = {
  configured: boolean;
  projectId: string | null;
  projectName: string | null;
  accounts: Record<NetworkKey, { connected: boolean; username: string | null; socialAccountId: string | null }>;
  error: string | null;
};

function emptyAccounts(): WoopStatus["accounts"] {
  return {
    instagram: { connected: false, username: null, socialAccountId: null },
    facebook: { connected: false, username: null, socialAccountId: null },
    youtube: { connected: false, username: null, socialAccountId: null },
    tiktok: { connected: false, username: null, socialAccountId: null },
  };
}

export async function getWoopStatus(): Promise<WoopStatus> {
  const accounts = emptyAccounts();

  if (!isWoopConfigured()) {
    return { configured: false, projectId: null, projectName: null, accounts, error: null };
  }

  try {
    const projects = await listProjects();
    const configuredProjectId = getConfiguredProjectId();
    const project = configuredProjectId
      ? projects.find((p) => p.id === configuredProjectId) ?? { id: configuredProjectId, name: null }
      : projects[0] ?? null;

    if (!project) {
      return { configured: true, projectId: null, projectName: null, accounts, error: "Nenhum projeto encontrado na conta WoopSocial." };
    }

    const social = await listSocialAccounts(project.id);
    for (const account of social) {
      const network = platformToNetwork[account.platform.toUpperCase()];
      if (network) {
        accounts[network] = { connected: true, username: account.username, socialAccountId: account.id };
      }
    }

    return { configured: true, projectId: project.id, projectName: project.name, accounts, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar a WoopSocial.";
    return { configured: true, projectId: null, projectName: null, accounts, error: message };
  }
}
