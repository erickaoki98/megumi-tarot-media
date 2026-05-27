# PulsePost Admin

Next.js webapp for scheduling social media content across Instagram, Facebook, YouTube Shorts, and TikTok with a built-in media library, reposting rules, and admin-managed user access.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Local state persistence with `localStorage`

## Default login

- Email: `erickaoki@icloud.com`
- Password: `larissa3105`

## Scripts

```bash
npm install
npm run dev
npm run build
npm start
```

## Vercel

This project is ready for Vercel deployment as a standard Next.js app.

Recommended production settings:

- Framework Preset: `Next.js`
- Build Command: `npm run build`
- Output Directory: leave empty
- Install Command: `npm install`

## Secure API secrets

Secrets live only in server-side environment variables (`Vercel -> Project Settings ->
Environment Variables`), never in the browser or `localStorage`. Use `.env.example` as
the reference. Publishing needs only the WoopSocial and Cloudflare R2 variables below.

## Publishing via WoopSocial

Real publishing/scheduling is powered by [WoopSocial](https://woopsocial.com), which handles each platform's OAuth and delivery. You only need a server-side API key:

```
WOOPSOCIAL_API_KEY=...        # from your WoopSocial dashboard (Bearer token)
WOOPSOCIAL_PROJECT_ID=...     # optional; defaults to the first project in the account
```

Flow:

1. Set `WOOPSOCIAL_API_KEY` in Vercel and redeploy.
2. In the `Config` tab, click `Conectar` on each network — the app opens the WoopSocial OAuth authorization in a new tab. Authorize and click `Atualizar status`.
3. In `Agendamentos`, attach a media file and pick `Agendar/publicar na WoopSocial` (or `Salvar como rascunho`). The app uploads the media (`POST /media`) and creates the post (`POST /posts`) for the connected networks.
4. In `Engajamento`, click `Atualizar dados dos posts` to pull each connected account's posts and compute an engagement score per post and per network.

Base URL `https://api.woopsocial.com/v1` (header `Authorization: Bearer <key>`). Endpoints used:

- `GET /projects` — resolve the project.
- `GET /social-accounts?projectId=` — connection status per network.
- `POST /social-accounts/oauth-authorization` — `{ platform, projectId, redirectUrl }` returns `{ url }`.
- `POST /media?projectId=` — upload the media blob, returns `{ id }`.
- `POST /posts` — `{ content, schedule, socialAccounts }`.
- `GET /social-accounts/{id}/posts` — posts per account (used for the engagement dashboard).

Server code lives in `lib/woopsocial.ts` and `lib/engagement.ts`; routes in `app/api/social/{status,publish,connect,insights}`.

## Pontuacao de engajamento (aba Engajamento)

A aba `Engajamento` puxa os posts das contas conectadas na WoopSocial (`GET /social-accounts/{id}/posts`) e calcula, por post, uma nota de engajamento (0-100) em `lib/engagement.ts`:

- **Interacoes ponderadas**: comentarios, compartilhamentos e salvamentos valem mais que curtidas.
- **Taxa de engajamento** = interacoes ponderadas / alcance (reach, ou impressions/views como fallback).
- **Nota (0-100)** = taxa de engajamento (peso maior) + alcance em escala logaritmica.

A leitura das metricas e defensiva: varremos os nomes mais comuns por plataforma (`likes`, `commentCount`, `reach`, etc.) e containers aninhados (`metrics`, `insights`, `analytics`). Quando a WoopSocial ainda nao expoe metricas para a conta, o dashboard mostra os posts puxados e avisa que as notas aparecerao assim que as metricas estiverem disponiveis.

## Media storage (Cloudflare R2)

Uploaded media is stored in Cloudflare R2 (S3-compatible) so files persist and any
schedule can be published later. Configure these server-side variables:

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
R2_PUBLIC_BASE_URL=https://media.example.com   # public bucket / custom domain, no trailing slash
```

Flow: file -> `POST /api/media/upload` (`lib/r2.ts`) -> stored in R2, public URL saved
on the media item -> publishing fetches that URL server-side and uploads it to WoopSocial
via `POST /media`. The bucket must be publicly readable (or served through a public custom
domain) so the server can fetch the media. Use the `Publicar na WoopSocial` button on any
queued schedule whose media has an R2 URL.

## Plano do dia (algoritmo de repostagem)

A aba `Plano do dia` monta a grade diaria seguindo o fluxo da operacao: 1-2 videos
novos por dia + preenchimento dos demais horarios (de 2 em 2 horas, configuravel) com
os melhores reposts.

Como o algoritmo escolhe os reposts (`lib/repost-engine.ts`):

- **Pontuacao de repost (0-100)** por midia, combinando: desempenho passado (peso maior),
  engajamento medio, alcance, "descanso" desde o ultimo post e uma penalidade de fadiga
  por numero de reposts.
- **Cooldown**: nao reposta a mesma midia antes do numero minimo de dias de descanso.
- **Teto de reposts**: cada midia tem um limite de reaproveitamentos.
- **Diversidade de tema**: evita repetir a mesma categoria/tema de tarot em horarios seguidos.
- **Horario nobre**: prioriza os melhores conteudos no fim do dia (18h-21h), quando o
  publico de tarot engaja mais.

Cada horario da grade vem com o **motivo** da escolha. Ao clicar em `Aplicar plano`, os
agendamentos sao criados na fila e o `repostCount` / `lastPostedAt` das midias e atualizado
(fechando o ciclo para os proximos planos).

### Legendas com IA (opcional)

Marque `Gerar legendas novas com IA para os reposts` para criar legendas de tarot frescas
por repost. Configure `OPENAI_API_KEY` (e opcionalmente `OPENAI_MODEL`) nas variaveis de
ambiente. Sem a chave, o app usa uma variacao local automatica. Endpoint: `POST /api/ai/caption`
(`lib/ai.ts`).

## Notes

- New users can only be created by admins in the `Usuarios` section.
- Media performance stats are currently simulated on the client to support the repost/removal workflow.
- The UI structure is ready for future API integrations with social platforms and analytics providers.
