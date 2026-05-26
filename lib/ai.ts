import "server-only";

const OPENAI_BASE = process.env.OPENAI_API_BASE?.replace(/\/$/, "") || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export type CaptionRequest = {
  title: string;
  theme: string;
  baseCaption: string;
  network: string;
};

const TAROT_HOOKS = [
  "As cartas trouxeram um recado pra voce hoje",
  "Respira fundo: a leitura de hoje pede atencao",
  "O baralho nao mente — veja o que veio pra voce",
  "Energia da semana lida nas cartas",
  "Sincronicidade: era isso que voce precisava ver agora",
];

/** Variacao local (sem IA) — embaralha ganchos para o repost nao ficar identico. */
function localCaptionVariation(req: CaptionRequest): string {
  const hook = TAROT_HOOKS[Math.floor(Math.random() * TAROT_HOOKS.length)];
  const themePart = req.theme ? ` ${req.theme}.` : "";
  const base = req.baseCaption ? ` ${req.baseCaption}` : "";
  return `${hook}.${themePart}${base} Salva e compartilha com quem precisa. #tarot #megumitarot`.trim();
}

/**
 * Gera uma legenda de tarot fresca para um repost. Usa a OpenAI quando a chave
 * estiver configurada; caso contrario, devolve uma variacao local deterministica
 * para que o repost nao saia identico ao original.
 */
export async function generateTarotCaption(
  req: CaptionRequest,
): Promise<{ caption: string; ai: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { caption: localCaptionVariation(req), ai: false };
  }

  const prompt = [
    "Voce e o social media do canal de tarot 'Megumi Tarot'.",
    "Escreva UMA legenda nova em portugues do Brasil para reaproveitar este conteudo,",
    "sem repetir a legenda original literalmente. Tom acolhedor e mistico, com um gancho forte na primeira linha.",
    "Inclua 3 a 5 hashtags relevantes de tarot/espiritualidade. Maximo 280 caracteres.",
    `Rede: ${req.network}.`,
    req.title ? `Titulo do video: ${req.title}.` : "",
    req.theme ? `Tema/arcano: ${req.theme}.` : "",
    req.baseCaption ? `Legenda original (apenas referencia): ${req.baseCaption}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.9,
        messages: [
          { role: "system", content: "Voce cria legendas curtas e envolventes para redes sociais de tarot." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      return { caption: localCaptionVariation(req), ai: false };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const caption = data.choices?.[0]?.message?.content?.trim();
    if (!caption) {
      return { caption: localCaptionVariation(req), ai: false };
    }
    return { caption, ai: true };
  } catch {
    return { caption: localCaptionVariation(req), ai: false };
  }
}
