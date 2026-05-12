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

## Notes

- New users can only be created by admins in the `Usuarios` section.
- Media performance stats are currently simulated on the client to support the repost/removal workflow.
- The UI structure is ready for future API integrations with social platforms and analytics providers.
