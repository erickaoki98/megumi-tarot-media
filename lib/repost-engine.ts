import { MediaItem, NetworkKey } from "@/types/app";

// ---------------------------------------------------------------------------
// Motor de repostagem do Megumi Tarot.
//
// O fluxo do operador e: 1 a 2 videos NOVOS por dia + preencher o restante do
// dia, de 2 em 2 horas, com reposts dos melhores conteudos. Este modulo analisa
// o desempenho passado de cada midia e devolve, de forma transparente (com os
// "porques"), quais conteudos devem ser reaproveitados e como montar a grade do
// dia. Tudo e deterministico: a mesma biblioteca gera sempre o mesmo plano.
// ---------------------------------------------------------------------------

/** Janela em que o publico de tarot costuma engajar mais (noite). */
export const PRIME_HOURS = [18, 19, 20, 21] as const;

export type PlanOptions = {
  /** Primeiro horario do dia (0-23). */
  startHour: number;
  /** Ultimo horario do dia (0-23). */
  endHour: number;
  /** Espacamento entre posts, em horas. */
  intervalHours: number;
  /** Dias minimos antes de repostar a mesma midia. */
  minDaysBetweenReposts: number;
  /** Score minimo (0-100) para uma midia ser candidata a repost. */
  minRepostScore: number;
  /** Limite de vezes que uma mesma midia pode ser repostada. */
  maxRepostsPerItem: number;
};

export const defaultPlanOptions: PlanOptions = {
  startHour: 9,
  endHour: 21,
  intervalHours: 2,
  minDaysBetweenReposts: 5,
  minRepostScore: 55,
  maxRepostsPerItem: 4,
};

export type MediaPerformance = {
  hasData: boolean;
  totalViews: number;
  avgEngagement: number;
  avgScore: number;
  bestNetwork: NetworkKey | null;
};

export function getMediaPerformance(item: MediaItem): MediaPerformance {
  const networks = Object.keys(item.stats) as NetworkKey[];
  const active = networks.filter((network) => item.stats[network].views > 0);

  if (!active.length) {
    return { hasData: false, totalViews: 0, avgEngagement: 0, avgScore: 0, bestNetwork: null };
  }

  const totalViews = active.reduce((sum, network) => sum + item.stats[network].views, 0);
  const avgEngagement =
    active.reduce((sum, network) => sum + item.stats[network].engagement, 0) / active.length;
  const avgScore = active.reduce((sum, network) => sum + item.stats[network].score, 0) / active.length;
  const bestNetwork = active.reduce((best, network) =>
    item.stats[network].score > item.stats[best].score ? network : best,
  );

  return {
    hasData: true,
    totalViews,
    avgEngagement: Number(avgEngagement.toFixed(1)),
    avgScore: Math.round(avgScore),
    bestNetwork,
  };
}

function daysBetween(fromIso: string | null | undefined, to: Date): number | null {
  if (!fromIso) {
    return null;
  }
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) {
    return null;
  }
  return Math.floor((to.getTime() - from) / (1000 * 60 * 60 * 24));
}

export type RepostAssessment = {
  /** Pontuacao final de repostagem (0-100). Quanto maior, melhor candidato. */
  score: number;
  /** Verdadeiro quando vale a pena repostar agora. */
  recommended: boolean;
  /** Bloqueado por ter sido postado ha pouco tempo. */
  inCooldown: boolean;
  /** Atingiu o limite de reposts configurado. */
  reachedRepostCap: boolean;
  repostCount: number;
  daysSinceLastPost: number | null;
  performance: MediaPerformance;
  /** Explicacoes legiveis para o operador entender a decisao. */
  reasons: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Avalia uma midia como candidata a repost. A pontuacao combina:
 *  - desempenho passado (peso maior — o melhor sinal de que vale repetir);
 *  - engajamento medio e alcance (reforco);
 *  - "descanso" desde o ultimo post (conteudo parado rende mais ao voltar);
 *  - penalidade de fadiga (cada repost reduz o potencial de novidade).
 */
export function assessRepost(
  item: MediaItem,
  options: PlanOptions = defaultPlanOptions,
  now: Date = new Date(),
): RepostAssessment {
  const performance = getMediaPerformance(item);
  const repostCount = item.repostCount ?? 0;
  const daysSinceLastPost = daysBetween(item.lastPostedAt, now);
  const reasons: string[] = [];

  if (!performance.hasData) {
    reasons.push("Ainda sem estatisticas — atualize os numeros para avaliar o repost.");
    return {
      score: 0,
      recommended: false,
      inCooldown: false,
      reachedRepostCap: false,
      repostCount,
      daysSinceLastPost,
      performance,
      reasons,
    };
  }

  const engagementNorm = clamp(performance.avgEngagement * 10);
  const reachNorm = clamp((Math.log10(performance.totalViews + 1) / 5) * 100);
  const freshness =
    daysSinceLastPost === null ? 60 : clamp((daysSinceLastPost / options.minDaysBetweenReposts) * 60, 0, 60);
  const fatiguePenalty = repostCount * 9;

  const score = Math.round(
    clamp(
      performance.avgScore * 0.55 +
        engagementNorm * 0.2 +
        reachNorm * 0.15 +
        freshness * 0.1 -
        fatiguePenalty,
    ),
  );

  const inCooldown = daysSinceLastPost !== null && daysSinceLastPost < options.minDaysBetweenReposts;
  const reachedRepostCap = repostCount >= options.maxRepostsPerItem;
  const recommended = score >= options.minRepostScore && !inCooldown && !reachedRepostCap;

  reasons.push(
    `Desempenho medio ${performance.avgScore}/100${performance.bestNetwork ? ` (melhor no ${performance.bestNetwork})` : ""}.`,
  );
  reasons.push(`${performance.totalViews.toLocaleString("pt-BR")} views e ${performance.avgEngagement}% de engajamento.`);

  if (daysSinceLastPost === null) {
    reasons.push("Nunca foi repostado — bom candidato a reaproveitar.");
  } else if (inCooldown) {
    reasons.push(`No ar ha apenas ${daysSinceLastPost} dia(s); aguarde o descanso de ${options.minDaysBetweenReposts} dias.`);
  } else {
    reasons.push(`Descansando ha ${daysSinceLastPost} dias — pronto para voltar.`);
  }

  if (reachedRepostCap) {
    reasons.push(`Ja repostado ${repostCount}x (limite ${options.maxRepostsPerItem}); arquive ou aposente.`);
  } else if (repostCount > 0) {
    reasons.push(`Repostado ${repostCount}x ate agora.`);
  }

  return {
    score,
    recommended,
    inCooldown,
    reachedRepostCap,
    repostCount,
    daysSinceLastPost,
    performance,
    reasons,
  };
}

export type RankedCandidate = {
  item: MediaItem;
  assessment: RepostAssessment;
};

/** Ranqueia a biblioteca por potencial de repost, do melhor para o pior. */
export function rankRepostCandidates(
  library: MediaItem[],
  options: PlanOptions = defaultPlanOptions,
  now: Date = new Date(),
): RankedCandidate[] {
  return library
    .filter((item) => item.status !== "archived")
    .map((item) => ({ item, assessment: assessRepost(item, options, now) }))
    .sort((a, b) => b.assessment.score - a.assessment.score);
}

export type PlanSlotKind = "new" | "repost" | "empty";

export type PlanSlot = {
  /** ISO local (sem timezone) compativel com input datetime-local. */
  time: string;
  hour: number;
  prime: boolean;
  kind: PlanSlotKind;
  mediaId: string | null;
  mediaTitle: string | null;
  score: number | null;
  reason: string;
};

export type DailyPlan = {
  date: string;
  slots: PlanSlot[];
  summary: { total: number; news: number; reposts: number; empty: number };
};

function toLocalIso(date: string, hour: number): string {
  const hh = String(hour).padStart(2, "0");
  return `${date}T${hh}:00`;
}

function buildSlotTimes(date: string, options: PlanOptions): { time: string; hour: number; prime: boolean }[] {
  const times: { time: string; hour: number; prime: boolean }[] = [];
  const step = Math.max(1, Math.round(options.intervalHours));
  for (let hour = options.startHour; hour <= options.endHour; hour += step) {
    times.push({ time: toLocalIso(date, hour), hour, prime: (PRIME_HOURS as readonly number[]).includes(hour) });
  }
  return times;
}

/** Distribui N novos posts pelos indices de slots, dando preferencia ao prime time. */
function pickNewSlotIndices(totalSlots: number, newCount: number, primeFlags: boolean[]): Set<number> {
  const chosen = new Set<number>();
  if (newCount <= 0 || totalSlots === 0) {
    return chosen;
  }

  // O primeiro novo abre o dia; os demais vao para os melhores horarios (prime).
  chosen.add(0);
  const remaining = newCount - 1;
  if (remaining > 0) {
    const primeIndices = primeFlags
      .map((isPrime, index) => ({ isPrime, index }))
      .filter(({ isPrime, index }) => isPrime && index !== 0)
      .map(({ index }) => index);

    // Espaca os escolhidos dentro do prime time disponivel.
    const pool = primeIndices.length ? primeIndices : Array.from({ length: totalSlots }, (_, i) => i).filter((i) => i !== 0);
    for (let n = 0; n < remaining && pool.length; n += 1) {
      const pick = pool[Math.floor((n + 1) * (pool.length / (remaining + 1)))] ?? pool[pool.length - 1];
      chosen.add(pick);
    }
  }

  return chosen;
}

/**
 * Monta a grade do dia: encaixa os videos novos e preenche os demais horarios
 * com os melhores reposts, evitando repetir a mesma categoria/tema em sequencia.
 */
export function buildDailyPlan(params: {
  date: string;
  library: MediaItem[];
  newMediaIds: string[];
  options?: PlanOptions;
  now?: Date;
}): DailyPlan {
  const options = params.options ?? defaultPlanOptions;
  const now = params.now ?? new Date();
  const slotTimes = buildSlotTimes(params.date, options);
  const byId = new Map(params.library.map((item) => [item.id, item]));

  const newMediaIds = params.newMediaIds.filter((id) => byId.has(id));
  const newSlotIndices = pickNewSlotIndices(
    slotTimes.length,
    Math.min(newMediaIds.length, slotTimes.length),
    slotTimes.map((slot) => slot.prime),
  );

  const candidates = rankRepostCandidates(params.library, options, now).filter(
    (candidate) => candidate.assessment.recommended && !newMediaIds.includes(candidate.item.id),
  );

  const slots: PlanSlot[] = [];
  let newCursor = 0;
  const used = new Set<string>();
  let previousCategory: string | null = null;

  slotTimes.forEach((slotTime, index) => {
    const base = { time: slotTime.time, hour: slotTime.hour, prime: slotTime.prime };

    if (newSlotIndices.has(index) && newCursor < newMediaIds.length) {
      const media = byId.get(newMediaIds[newCursor]);
      newCursor += 1;
      if (media) {
        used.add(media.id);
        previousCategory = media.category;
        slots.push({
          ...base,
          kind: "new",
          mediaId: media.id,
          mediaTitle: media.title,
          score: null,
          reason: slotTime.prime
            ? "Video novo no horario nobre para maximizar o primeiro alcance."
            : "Video novo do dia — abre a programacao.",
        });
        return;
      }
    }

    // Escolhe o melhor repost ainda nao usado, preferindo categoria diferente da anterior.
    const available = candidates.filter((candidate) => !used.has(candidate.item.id));
    const diverse = available.find((candidate) => candidate.item.category !== previousCategory);
    const chosen = diverse ?? available[0];

    if (chosen) {
      used.add(chosen.item.id);
      previousCategory = chosen.item.category;
      const sameThemeNote =
        diverse === undefined && available.length > 0 ? " (sem alternativa de tema diferente disponivel)" : "";
      slots.push({
        ...base,
        kind: "repost",
        mediaId: chosen.item.id,
        mediaTitle: chosen.item.title,
        score: chosen.assessment.score,
        reason: `Repost (score ${chosen.assessment.score}/100): ${chosen.assessment.reasons[0]}${sameThemeNote}`,
      });
      return;
    }

    slots.push({
      ...base,
      kind: "empty",
      mediaId: null,
      mediaTitle: null,
      score: null,
      reason: "Sem candidato de repost qualificado — grave um novo conteudo ou ajuste os criterios.",
    });
  });

  const summary = slots.reduce(
    (acc, slot) => {
      acc.total += 1;
      if (slot.kind === "new") acc.news += 1;
      else if (slot.kind === "repost") acc.reposts += 1;
      else acc.empty += 1;
      return acc;
    },
    { total: 0, news: 0, reposts: 0, empty: 0 },
  );

  return { date: params.date, slots, summary };
}
