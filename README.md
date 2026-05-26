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
the reference. Publishing needs only the bundle.social and Cloudflare R2 variables below.

## Publishing via bundle.social

Real publishing/scheduling is powered by [bundle.social](https://bundle.social), which handles each platform's OAuth and delivery. You only need two server-side variables:

```
BUNDLE_SOCIAL_API_KEY=pk_...     # from your bundle.social organization
BUNDLE_SOCIAL_TEAM_ID=...        # from GET https://api.bundle.social/api/v1/team/
```

Flow:

1. Connect your Instagram/Facebook/YouTube/TikTok accounts inside bundle.social.
2. Set the two env vars above in Vercel and redeploy.
3. The `Config` tab shows whether the key/team are set and which accounts are connected.
4. In `Agendamentos`, attach a media file and pick `Agendar no bundle.social` (or `Salvar como rascunho`) when creating a schedule. The app uploads the file (`POST /upload`) and creates the post (`POST /post`) for the selected networks.

Endpoints used (header `x-api-key`):

- `POST /api/v1/upload/` — multipart upload, returns `{ id }`.
- `POST /api/v1/upload/from-url` — register media already hosted on R2, returns `{ id }`.
- `POST /api/v1/post/` — `{ teamId, title, postDate, status, socialAccountTypes, data }`.
- `GET /api/v1/social-account/by-type` — connection status per network.

Server code lives in `lib/bundle-social.ts`; routes in `app/api/social/{status,publish}`.

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
on the media item -> publishing sends that URL to bundle.social via `/upload/from-url`.
The bucket must be publicly readable (or served through a public custom domain) so
bundle.social can fetch the media. Use the `Publicar no bundle.social` button on any
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
