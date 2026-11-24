# BibleBetter

Personal Bible reading, study, prayer and growth app — an installable web app (PWA) for Android and PC.
KJV text built in (public domain); verse links open BibleGateway (ESV by default).

**Status:** Phase 1 (Foundation) — Bible navigator, read-throughs, progress, reflections, two-pane layout,
command palette, quick capture, undo and Trash, backups, sync.

## One-time setup

1. **Supabase database** — Supabase → *SQL Editor* → *New query* → paste all of `supabase/setup.sql` → *Run*.
2. **Supabase sign-in settings** — *Authentication → URL Configuration*: set **Site URL** to
   `https://<your-github-username>.github.io/biblebetter/`.
3. **Connect the app to Supabase** — put your Project URL and publishable key in `src/config.ts`.
4. **GitHub Pages** — repository *Settings → Pages → Build and deployment → Source: GitHub Actions*.
   Every push to `main` rebuilds and publishes the app.
5. Open `https://<your-github-username>.github.io/biblebetter/`, choose **Create your account**, confirm the email.
6. **Lock sign-ups** — Supabase → *Authentication → Sign In / Providers* → turn off **Allow new users to sign up**.
7. Install: Android Chrome menu ⋮ → *Add to Home screen*; PC Chrome/Edge → install icon in the address bar.

## Development

```
npm install
npm run dev      # http://localhost:5173/biblebetter/
npm run check    # type-check
npm run build
```

## How data works

- Everything is stored on the device first (IndexedDB), so the app works offline.
- Changes sync to one Supabase table (`records`) every ~10 seconds while open; the newest change wins.
- Row-level security: only your account can read or write your rows.
- Deleted items go to Trash for 30 days. Weekly snapshots go to private Supabase Storage (last 8 kept).
