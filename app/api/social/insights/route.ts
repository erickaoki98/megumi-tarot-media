import { NextResponse } from "next/server";

import {
  getWoopStatus,
  isWoopConfigured,
  listSocialAccountPosts,
  platformToNetwork,
  WoopSocialError,
} from "@/lib/woopsocial";
import { buildEngagementDashboard, scorePost, ScoredPost } from "@/lib/engagement";
import { NetworkKey } from "@/types/app";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isWoopConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Integracao WoopSocial nao configurada (defina WOOPSOCIAL_API_KEY)." },
      { status: 400 },
    );
  }

  try {
    const status = await getWoopStatus();
    if (status.error) {
      return NextResponse.json({ ok: false, error: status.error }, { status: 502 });
    }

    const connected = (Object.keys(status.accounts) as NetworkKey[])
      .map((network) => ({ network, account: status.accounts[network] }))
      .filter((entry) => entry.account.connected && entry.account.socialAccountId);

    if (!connected.length) {
      return NextResponse.json({
        ok: true,
        dashboard: buildEngagementDashboard([]),
        connectedAccounts: 0,
      });
    }

    const scored: ScoredPost[] = [];
    for (const { network, account } of connected) {
      const posts = await listSocialAccountPosts(account.socialAccountId as string, 50);
      for (const post of posts) {
        const postNetwork =
          (typeof post.platform === "string" && platformToNetwork[post.platform.toUpperCase()]) || network;
        scored.push(scorePost(post, postNetwork ?? null));
      }
    }

    return NextResponse.json({
      ok: true,
      dashboard: buildEngagementDashboard(scored),
      connectedAccounts: connected.length,
    });
  } catch (error) {
    const httpStatus = error instanceof WoopSocialError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Falha ao puxar os dados de engajamento.";
    return NextResponse.json({ ok: false, error: message }, { status: httpStatus });
  }
}
