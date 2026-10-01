# Testing

Run `npm ci` first. Tests are intended to use an unconfigured local sample environment; they never need an AI key or production database.

## Core tests

`npm test` verifies calculation identities, rounding tolerance, text chunk preservation, duplicate source evidence, PPTX/PDF extraction, invalid-file rejection, owner isolation, persisted sample generation, completion retries, hidden answer keys, and lease contention.

## Browser tests

`npm run test:e2e` starts Next.js locally (or uses an existing server), loads real UI controls, and exercises finance sample review/grading/persistence, reading sample self-check/mobile layout, and upload/source preview/missing-configuration errors.

Install Chromium first with `npx playwright install chromium`. If your environment supplies a browser executable instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its absolute path. No special browser package is needed for normal local development.

## Cloud acceptance before production

Apply the migration to the dedicated project and test with two separate accounts:

1. Upload a material with account A and confirm account B cannot retrieve its record or original file.
2. Confirm authenticated client queries cannot select practice-session answer keys or write application records directly.
3. Generate from an actual lecture with AI and verify citations, extracted formulas and diagram warnings against the original.
4. Submit a mock exam and verify answers are absent before submission and present afterward.
5. Run the separate worker, close the browser, and verify queued sections complete without duplicate model requests.
6. Delete a course and confirm its records and private originals are gone.
7. Run Supabase security advisors and inspect deployment build/runtime logs.

Cloud checks remain unverified until dedicated project credentials are available. The app does not substitute sample results for a failed AI call.

## Initial local verification

October 1, 2026: 10 core tests passed; 4 browser/API end-to-end tests passed; TypeScript and the optimized production build passed. Desktop review and mobile practice screenshots were visually inspected. Real AI calls, authenticated Supabase persistence, and a production Vercel deployment remain unverified because dedicated credentials were not configured.
