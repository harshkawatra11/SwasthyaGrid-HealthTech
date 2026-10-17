# Handoff

If you're picking this up fresh, read in this order:
1. `docs/00-vision.md` — what we're building and why
2. `memory/decision-log.md` — locked decisions, don't relitigate these
3. `memory/next-tasks.md` — what's queued
4. `docs/01-architecture.md` through `docs/07-recommendation-engine.md` — technical contracts before touching code
5. `docs/08-design-system.md` — non-negotiable: no blue-purple, editorial beige palette

## Key constraints to respect
- AI never auto-executes; recommendations always start `pending` (see `docs/07-recommendation-engine.md`).
- Gemini (`gemini-2.5-flash`) explains, never predicts numbers.
- No spending beyond GCP credits + Gemini free/AI-Studio tier — flag anything else before proceeding.
- GitHub: main app `harshkawatra11/SwasthyaGrid-gdg-buildwithai`, CI/CD green. CRM: `harshkawatra11/SwasthyaGrid-CRM`, separate repo, no CI configured.
- Live sites: **https://swasthyagrid.vercel.app** (Vercel project `swasthyagrid`, team `gursimrannkaurr04` — a teammate's account, not `harsh-s-vercel-team` as earlier notes said; it moved at some point) and **https://swasthyagrid-crm.vercel.app** (Vercel project `swasthyagrid-crm`, same team). Neither has GitHub auto-deploy connected for the CRM (cross-account permissions); redeploy both via `vercel deploy --prod` from their respective folders.
- Never extract or use stored CLI/tool auth tokens, service account keys, or session cookies directly to bypass a missing CLI/MCP feature or to debug — use hashes/lengths/status codes instead of printing secret values, and find a config-file-based workaround (e.g. the root `vercel.json` for the monorepo Root Directory issue) or ask the user to do the one dashboard click.
- Service account keys live only in `ai-healthcare-crm/.secrets-tmp/` (gitignored) — never move them, never print their contents.

## State as of end of Session 5 (current)
Two live, linked apps:
- **SwasthyaGrid AI** — frontend on Vercel, backend on Cloud Run, now reading **live Firestore** (20s TTL, JSON-seed fallback preserved) instead of only the static seed.
- **SwasthyaGrid Intake** (`ai-healthcare-crm/`) — a separate CRM app/repo/Vercel deploy where PHC/CHC staff log in and edit their facility's data, writing to the *same* Firestore project (`swasthyagrid-ai-54886`). Verified in production: an edit in the CRM shows up in SwasthyaGrid AI's API within the TTL window with a correctly recomputed risk level.

Demo login credentials (Firestore `crm_users`, not committed anywhere): `phc-rural-14`, `phc-sector-12`, `chc-east` (facility role), `district-admin` (admin role) — shared password `Swasthya@2026`, printed by `node ai-healthcare-crm/scripts/seed-users.mjs`.

## What's still pending
See `memory/next-tasks.md` for the full backlog — nothing blocking for the demo. Two rough edges: the CRM's Vercel deploy isn't git-connected (manual `vercel deploy --prod` needed for future changes), and the CRM's doctor attendance toggle doesn't yet feed the backend's attendance-risk computation (that stays static from the seed).

## GCP project reference
Project `swasthyagrid-ai-54886`, region `asia-south1`, billing account `010FBB-4DDDDA-4656C5`. Firestore is now load-bearing for **both** apps — tearing down the project (`gcloud projects delete swasthyagrid-ai-54886`) takes down the CRM's data too, not just the backend.


## 2026-10-17 — Sarvam voice capture and playback
Sarvam credentials and upstream STT/chat/TTS work. Fixed microphone recorder rendering via a silent destination sink (3ddf526), unlocked playback during the initiating user gesture, and selected CSS orb on software WebGL renderers to prevent capture starvation (b0b71f6). No keys changed. Vercel production deployment and GitHub frontend/backend CI succeeded. 48 focused tests and TypeScript checks passed. Live strict-autoplay Chromium test with synthetic microphone speech: 219 outgoing audio frames, correct transcript “Which district needs attention first?”, 53 received/scheduled reply chunks, nonzero output peak 0.9966, both audio contexts running, no voice errors. Browser output verified programmatically; physical speaker settings remain device-specific. See docs/voice-microphone-capture-fix.md.
