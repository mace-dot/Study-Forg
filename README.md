# StudyForge

Upload course materials, generate a source-linked review, and practice the problem structures your course actually uses. Built with Next.js, React, TypeScript, a server-side OpenAI adapter, and optional Supabase persistence.

## Run locally

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. **No credentials are required for the labeled finance and economics sample courses.** Local files and progress are saved under `.studyforge/` and isolated by a signed HttpOnly workspace cookie. Do not erase that folder or clear the cookie if you want to keep local progress. This is a personal local workspace, not multi-user authentication.

To analyze your own uploaded materials, set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env.local`. Choose a model available to your API project that supports Responses structured outputs; image interpretation also requires vision support. The app never exposes the key to the browser. API use is separately billed by your provider.

## What works

- Courses, optional exam dates and topic notes.
- Multiple uploads with material labels, per-file retries, cached identical extraction, deletion, and pasted notes.
- PDF page text, PPTX slide text and speaker notes, DOCX paragraphs, TXT paragraphs, and AI-interpreted PNG/JPG/WebP images.
- Source viewer showing exact page/slide/paragraph references and original-file preview or download.
- Persisted generation jobs, chunk-by-chunk progress and partial reviews, resume without regenerating completed sections.
- Concept reviews with intuition, formulas, assumptions, worked examples, mistakes, and source links.
- Quick review print/save-to-PDF and observed-versus-suggested exam pattern maps with deduplicated source questions.
- Server-calculated short-sale maintenance price, additional collateral, full-year straight-line depreciation, and two-asset portfolio standard deviation questions.
- Source-based conceptual multiple-choice and written/journal/graph reflection questions.
- Guided practice and timed mock exams. Answer keys stay server-side until grading/submission.
- Saved attempts, graded accuracy, questionable-grading flags, and topic review recommendations.
- Desktop/mobile layouts and keyboard-accessible controls/dialogs.

## Authenticated cloud setup

Use a **dedicated StudyForge Supabase project**, not an existing unrelated application's database. This repository includes a migration but does not automatically create a paid project or apply it to another app.

1. Apply `supabase/migrations/20261001161327_studyforge_initial.sql` to the dedicated project. It creates owner-scoped records, private file storage, and service-only generation locks.
2. Configure email/password authentication and the correct site/redirect URLs. If email confirmation is enabled, the app explains that users must confirm their email before signing in.
3. Set all four variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (server only; a legacy service-role key is also accepted by the SDK)
   - `APP_SECRET` (random server-side secret)
4. Set `OPENAI_API_KEY` and `OPENAI_MODEL` for real analysis.
5. Import `mace-dot/Study-Forg` into Vercel as a Next.js project and set these environment variables there before deploying.

Cloud mode verifies the supplied user token with Supabase Auth on every API request. Ownership is checked server-side; RLS isolates readable records. Practice-session records contain answer keys and cannot be read directly through the client Data API. Original files are stored privately and served only after authorization. No service key belongs in a `NEXT_PUBLIC_` variable.

## Background processing

With the web app alone, an open browser advances persisted generation one chunk at a time. You can refresh or close the page and resume later.

For processing that continues after the browser closes, run `npm run worker` in a separate long-running Node process using the same environment. Local workers also need access to the same persistent `STUDYFORGE_DATA_DIR`; cloud workers use Supabase. Atomic locks coordinate browser and worker processing. This worker is **not** automatically hosted by a Vercel web deployment; it needs its own process host. Failed AI steps require an explicit user retry to avoid uncontrolled repeated charges.

## Checks

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests cover finance review-to-practice, reading-heavy self-checks and mobile overflow, uploads, source references, missing-AI errors, and persistence. Core tests cover financial equations, extraction, chunking, duplicate evidence, owner isolation, answer-key secrecy, idempotent job completion, and concurrent leases.

See [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) and [docs/TESTING.md](docs/TESTING.md) for scope and verification limits.
