import "server-only";

import { NetworkKey, SecureConnectionSummary } from "@/types/app";

type EnvFieldDefinition = {
  name: string;
  label: string;
  envName: string;
  required: boolean;
  help: string;
};

const envDefinitions: Record<NetworkKey, EnvFieldDefinition[]> = {
  instagram: [
    { name: "clientId", label: "Meta App ID", envName: "SOCIAL_INSTAGRAM_APP_ID", required: true, help: "App ID da Meta usado no OAuth e publicacao." },
    { name: "clientSecret", label: "Meta App Secret", envName: "SOCIAL_INSTAGRAM_APP_SECRET", required: true, help: "Secret do app da Meta. Nunca deve ficar no browser." },
    { name: "accessToken", label: "Long-Lived Access Token", envName: "SOCIAL_INSTAGRAM_ACCESS_TOKEN", required: true, help: "Token longo do usuario autorizado para publicar." },
    { name: "accountId", label: "Instagram Professional Account ID", envName: "SOCIAL_INSTAGRAM_ACCOUNT_ID", required: true, help: "ID da conta profissional do Instagram." },
    { name: "pageId", label: "Facebook Page ID", envName: "SOCIAL_INSTAGRAM_PAGE_ID", required: true, help: "ID da pagina vinculada a conta profissional." },
    { name: "redirectUri", label: "Redirect URI", envName: "SOCIAL_INSTAGRAM_REDIRECT_URI", required: true, help: "URI de retorno cadastrada no app da Meta." },
  ],
  facebook: [
    { name: "clientId", label: "Meta App ID", envName: "SOCIAL_FACEBOOK_APP_ID", required: true, help: "App ID do app com Facebook Login e acesso a Pages." },
    { name: "clientSecret", label: "Meta App Secret", envName: "SOCIAL_FACEBOOK_APP_SECRET", required: true, help: "Secret do app da Meta. Deve ficar no servidor." },
    { name: "accessToken", label: "Page Access Token", envName: "SOCIAL_FACEBOOK_PAGE_ACCESS_TOKEN", required: true, help: "Token da pagina que sera usada para publicar." },
    { name: "pageId", label: "Facebook Page ID", envName: "SOCIAL_FACEBOOK_PAGE_ID", required: true, help: "ID da pagina de destino." },
    { name: "redirectUri", label: "Redirect URI", envName: "SOCIAL_FACEBOOK_REDIRECT_URI", required: true, help: "URI de retorno do OAuth da Meta." },
  ],
  youtube: [
    { name: "clientId", label: "OAuth Client ID", envName: "SOCIAL_YOUTUBE_CLIENT_ID", required: true, help: "Client ID do Google Cloud para OAuth." },
    { name: "clientSecret", label: "OAuth Client Secret", envName: "SOCIAL_YOUTUBE_CLIENT_SECRET", required: true, help: "Secret do cliente OAuth do Google." },
    { name: "refreshToken", label: "Refresh Token", envName: "SOCIAL_YOUTUBE_REFRESH_TOKEN", required: true, help: "Refresh token usado para renovar access token." },
    { name: "accountId", label: "YouTube Channel ID", envName: "SOCIAL_YOUTUBE_CHANNEL_ID", required: true, help: "ID do canal onde os Shorts serao publicados." },
    { name: "redirectUri", label: "Redirect URI", envName: "SOCIAL_YOUTUBE_REDIRECT_URI", required: true, help: "URI de callback autorizada no Google Cloud." },
  ],
  tiktok: [
    { name: "clientId", label: "Client Key", envName: "SOCIAL_TIKTOK_CLIENT_KEY", required: true, help: "Client Key do app no TikTok for Developers." },
    { name: "clientSecret", label: "Client Secret", envName: "SOCIAL_TIKTOK_CLIENT_SECRET", required: true, help: "Client Secret do app do TikTok." },
    { name: "accessToken", label: "Access Token", envName: "SOCIAL_TIKTOK_ACCESS_TOKEN", required: true, help: "Access token do criador autenticado." },
    { name: "refreshToken", label: "Refresh Token", envName: "SOCIAL_TIKTOK_REFRESH_TOKEN", required: true, help: "Refresh token do criador autenticado." },
    { name: "accountId", label: "Open ID", envName: "SOCIAL_TIKTOK_OPEN_ID", required: true, help: "open_id retornado pelo OAuth do TikTok." },
    { name: "redirectUri", label: "Redirect URI", envName: "SOCIAL_TIKTOK_REDIRECT_URI", required: true, help: "URI de callback autorizada no app do TikTok." },
  ],
};

function maskValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  if (value.length <= 8) {
    return "••••••••";
  }

  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function getSecureConnectionSummaries(): SecureConnectionSummary[] {
  return (Object.keys(envDefinitions) as NetworkKey[]).map((network) => {
    const fields = envDefinitions[network].map((field) => {
      const rawValue = process.env[field.envName];
      return {
        name: field.name,
        label: field.label,
        envName: field.envName,
        required: field.required,
        configured: Boolean(rawValue),
        maskedValue: maskValue(rawValue),
        help: field.help,
      };
    });

    return {
      network,
      ready: fields.every((field) => (field.required ? field.configured : true)),
      fields,
    };
  });
}
