import "server-only";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function env(name: string): string | null {
  return process.env[name]?.trim() || null;
}

export function getR2Config() {
  return {
    accountId: env("R2_ACCOUNT_ID"),
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    bucket: env("R2_BUCKET"),
    publicBaseUrl: env("R2_PUBLIC_BASE_URL"),
  };
}

export function isR2Configured(): boolean {
  const config = getR2Config();
  return Boolean(
    config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket && config.publicBaseUrl,
  );
}

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  const config = getR2Config();
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("Cloudflare R2 nao configurado (defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).");
  }

  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return cachedClient;
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "arquivo";
}

export type R2UploadResult = {
  url: string;
  key: string;
  contentType: string;
};

export async function putMedia(file: File): Promise<R2UploadResult> {
  const config = getR2Config();
  if (!config.bucket || !config.publicBaseUrl) {
    throw new Error("Cloudflare R2 nao configurado (defina R2_BUCKET e R2_PUBLIC_BASE_URL).");
  }

  const client = getClient();
  const contentType = file.type || "application/octet-stream";
  const key = `media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeFileName(file.name || "arquivo")}`;
  const body = Buffer.from(await file.arrayBuffer());

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  const base = config.publicBaseUrl.replace(/\/$/, "");
  return { url: `${base}/${key}`, key, contentType };
}
