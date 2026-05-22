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

Social platform secrets should not be stored in the browser or in `localStorage`.

Use `.env.example` as the reference and configure the real values in:

- `Vercel -> Project Settings -> Environment Variables`

The UI now reads only masked server-side status for those variables so you can confirm what is configured without exposing the raw secrets.

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

## Notes

- New users can only be created by admins in the `Usuarios` section.
- Media performance stats are currently simulated on the client to support the repost/removal workflow.
- The UI structure is ready for future API integrations with social platforms and analytics providers.
