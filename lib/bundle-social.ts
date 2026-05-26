import "server-only";

import { NetworkKey } from "@/types/app";

const API_BASE = process.env.BUNDLE_SOCIAL_API_BASE?.replace(/\/$/, "") || "https://api.bundle.social/api/v1";

export type BundleSocialAccountType = "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK";

export const networkToBundleType: Record<NetworkKey, BundleSocialAccountType> = {
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  youtube: "YOUTUBE",
  tiktok: "TIKTOK",
};

function getApiKey(): string | null {
  return process.env.BUNDLE_SOCIAL_API_KEY?.trim() || null;
}

function getTeamId(): string | null {
  return process.env.BUNDLE_SOCIAL_TEAM_ID?.trim() || null;
}

export function getBundleConfig() {
  return {
    hasApiKey: Boolean(getApiKey()),
    hasTeamId: Boolean(getTeamId()),
    teamId: getTeamId(),
  };
}

export function isBundleConfigured(): boolean {
  return Boolean(getApiKey() && getTeamId());
}

class BundleSocialError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "BundleSocialError";
  }
}

async function request<T>(path: string, init: RequestInit & { rawBody?: BodyInit } = {}): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new BundleSocialError("BUNDLE_SOCIAL_API_KEY nao configurada no servidor.", 500);
  }

  const headers = new Headers(init.headers);
  headers.set("x-api-key", apiKey);

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
    const parsedMessage =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : null;
    throw new BundleSocialError(parsedMessage || `Erro ${response.status} na API bundle.social.`, response.status);
  }

  return parsed as T;
}

type BundleUpload = { id: string; mime?: string | null; mimeType?: string | null };

export async function uploadMedia(file: File): Promise<BundleUpload> {
  const teamId = getTeamId();
  if (!teamId) {
    throw new BundleSocialError("BUNDLE_SOCIAL_TEAM_ID nao configurado no servidor.", 500);
  }

  const form = new FormData();
  form.set("teamId", teamId);
  form.set("file", file);

  return request<BundleUpload>("/upload/", { method: "POST", body: form });
}

export async function uploadFromUrl(url: string): Promise<BundleUpload> {
  const teamId = getTeamId();
  if (!teamId) {
    throw new BundleSocialError("BUNDLE_SOCIAL_TEAM_ID nao configurado no servidor.", 500);
  }

  return request<BundleUpload>("/upload/from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId, url }),
  });
}

type BuildDataParams = {
  caption: string;
  uploadIds: string[];
  isImage: boolean;
};

function buildPlatformData(networks: NetworkKey[], { caption, uploadIds, isImage }: BuildDataParams) {
  const data: Record<string, unknown> = {};

  for (const network of networks) {
    const type = networkToBundleType[network];
    switch (type) {
      case "INSTAGRAM":
        data.INSTAGRAM = { type: isImage ? "POST" : "REEL", text: caption, uploadIds };
        break;
      case "FACEBOOK":
        data.FACEBOOK = { type: isImage ? "POST" : "REEL", text: caption, uploadIds };
        break;
      case "YOUTUBE":
        data.YOUTUBE = { type: "SHORT", text: caption, description: caption, uploadIds, privacy: "PUBLIC" };
        break;
      case "TIKTOK":
        data.TIKTOK = { type: isImage ? "IMAGE" : "VIDEO", text: caption, uploadIds, privacy: "PUBLIC_TO_EVERYONE" };
        break;
    }
  }

  return data;
}

export type CreatePostParams = {
  title: string;
  caption: string;
  scheduledFor: string;
  networks: NetworkKey[];
  uploadIds: string[];
  isImage: boolean;
  schedule: boolean;
};

export type BundlePost = { id: string; status?: string; postDate?: string };

export async function createPost(params: CreatePostParams): Promise<BundlePost> {
  const teamId = getTeamId();
  if (!teamId) {
    throw new BundleSocialError("BUNDLE_SOCIAL_TEAM_ID nao configurado no servidor.", 500);
  }

  const postDate = params.scheduledFor ? new Date(params.scheduledFor).toISOString() : new Date().toISOString();

  const body = {
    teamId,
    title: params.title || "Post",
    postDate,
    status: params.schedule ? "SCHEDULED" : "DRAFT",
    socialAccountTypes: params.networks.map((network) => networkToBundleType[network]),
    data: buildPlatformData(params.networks, {
      caption: params.caption,
      uploadIds: params.uploadIds,
      isImage: params.isImage,
    }),
  };

  return request<BundlePost>("/post/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type BundleStatus = {
  configured: boolean;
  hasApiKey: boolean;
  hasTeamId: boolean;
  accounts: Record<NetworkKey, { connected: boolean; username: string | null }>;
  error: string | null;
};

export async function getBundleStatus(): Promise<BundleStatus> {
  const config = getBundleConfig();
  const accounts: BundleStatus["accounts"] = {
    instagram: { connected: false, username: null },
    facebook: { connected: false, username: null },
    youtube: { connected: false, username: null },
    tiktok: { connected: false, username: null },
  };

  if (!config.hasApiKey || !config.hasTeamId) {
    return { configured: false, ...config, accounts, error: null };
  }

  try {
    await Promise.all(
      (Object.keys(networkToBundleType) as NetworkKey[]).map(async (network) => {
        const type = networkToBundleType[network];
        try {
          const account = await request<{ id?: string; username?: string | null } | null>(
            `/social-account/by-type?type=${type}&teamId=${encodeURIComponent(config.teamId as string)}`,
          );
          if (account && account.id) {
            accounts[network] = { connected: true, username: account.username ?? null };
          }
        } catch (error) {
          // bundle.social returns 400/404 with "Team does not have a X account"
          // when the account simply isn't connected — treat that as "not connected".
          if (
            error instanceof BundleSocialError &&
            (error.status === 404 || error.status === 400 || /does not have/i.test(error.message))
          ) {
            return;
          }
          throw error;
        }
      }),
    );

    return { configured: true, ...config, accounts, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar bundle.social.";
    return { configured: true, ...config, accounts, error: message };
  }
}

export { BundleSocialError };
