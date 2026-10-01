# Current state

Initial implementation, October 1, 2026.

The repository started with only a README. The app now has a working upload-to-review-to-practice pipeline with labeled built-in samples and adapters for real OpenAI generation and authenticated Supabase storage.

## Explicit limits

- There is no StudyForge production deployment or dedicated Supabase project configured by this commit. Do not assume the cloud migration has been applied.
- Real AI calls and cloud database policies require credentials and must be verified against a configured project before production use. Sample output is never represented as analysis of uploaded files.
- Files are capped at 3.5 MB each and 80 PDF pages/PPTX slides. One study pack accepts up to 30 materials and 24 text chunks. Oversized input fails visibly.
- PDF/PPTX/DOCX extraction does not interpret embedded diagrams automatically. Extraction flags detected images/charts and unreadable pages; users can upload screenshots for AI visual interpretation. PDF vector diagram detection is conservative. DOCX tables are linearized into text, and advanced equations may require screenshots. Plain PDF text order may differ from complex column layouts.
- Image interpretation requires a vision-capable configured model. OCR is AI-based and can make transcription mistakes; uncertainty must be checked against the original.
- Numeric practice is code-validated for four explicit template families. Other numerical structures are not automatically supported. AI-generated worked examples should be verified against the source. Conceptual multiple-choice is structurally validated, not independently fact-verified.
- Written, journal-entry, and graph answers are self-check reflections with rubrics/model answers, not automatic grades or claimed mastery. The reading sample is deliberately a limited demonstration rather than unlimited distinct questions.
- Topic notes help contextualize generation; they do not guarantee exam coverage. Pattern counts come from exact question excerpts, not predictions.
- Topic-name deduplication handles matching titles and duplicated question text; semantically identical concepts with different names may remain separate.
- The newest pack is the default review. Older packs and sessions remain persisted, but there is not yet a pack-history selector.
- The optional worker handles browser-independent processing. A Vercel deployment alone does not run the worker, and local filesystem mode is not durable on serverless hosting.
- Data deletion is explicit. Stored reviews can retain explanations from removed files; their source links show that the source has been removed. Course deletion removes associated records and originals.

## Architecture

`app/page.tsx`: course, upload, review, practice, progress and auth interface.

`app/api/[...path]/route.ts`: bounded upload endpoints, record APIs, job steps, original-source delivery, practice and grading.

`lib/extract.ts`: format-specific extraction with source locations and warnings.

`lib/generate.ts`: chunking, schema-validated study sections, citation validation, evidence deduplication and persisted jobs.

`lib/practice.ts`: numeric templates, conceptual question generation, answer withholding, grading and attempts.

`lib/server.ts`: owner context, local/Supabase persistence, private files and leases.

`scripts/worker.ts`: optional separate background worker.

`supabase/migrations/`: dedicated backend schema and access controls.
