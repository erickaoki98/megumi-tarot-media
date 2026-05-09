import { MediaItem, NetworkKey } from "@/types/app";
import { networkLabels } from "./constants";

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function formatNetworkList(networks: NetworkKey[]) {
  return networks.map((network) => networkLabels[network]).join(", ");
}

export function calculateScoreSummary(items: MediaItem[]) {
  const scores = items.flatMap((item) =>
    Object.values(item.stats)
      .map((stat) => stat.score)
      .filter((score) => score > 0),
  );

  if (!scores.length) {
    return 0;
  }

  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function getMediaHealth(item: MediaItem) {
  const scores = Object.values(item.stats)
    .map((stat) => stat.score)
    .filter((score) => score > 0);

  const average = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;
  const weakest = scores.length ? Math.min(...scores) : 0;
  const underperforming = weakest > 0 && weakest < 35;

  return { average, weakest, underperforming };
}

export function classNames(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}
