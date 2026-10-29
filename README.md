# HireLens AI

AI-assisted resume screening and candidate shortlisting: upload resumes, score candidates against a job with a
transparent deterministic engine, rank and compare them, generate interview questions, and keep an audit trail.
The scoring engine decides the numbers; AI is optional and only writes summaries and questions.

```text
Browser (frontend/)  ──REST/JSON + JWT──▶  Express API (Backend/)  ──Mongoose──▶  MongoDB
                                                │
                                                ├─ resume parser · job analyzer · scoring engine
                                                └─ AI service (optional, deterministic fallback)
```

## Repository layout
```text
HireLens-AI/
├── frontend/                 static single-page app, plain browser JavaScript (no build step)
│   ├── index.html            login markup + <link>/<script> tags
│   ├── css/  styles.css (tokens, base, layout)  components.css (tables, modals, reports, workspace)
│   └── js/   config · api · state · scoring · router · views · actions · app   (loaded in this order)
├── Backend/                  Node.js + Express + MongoDB API (see Backend/README.md)
└── README.md
```

## Frontend
- Plain browser JavaScript, no build step. Classic `<script>` files share global scope (not ES modules) so `frontend/index.html`
  also works when opened from disk. Load order is fixed in `index.html`.
  - `config.js` constants, API base URL, token storage. `api.js` `apiFetch`, the `API` object (one function per endpoint),
    `fetchAllPages` (list endpoints return at most 100 rows), XHR resume upload with real progress, `remoteFetch` cache.
  - `state.js` helpers, Demo-Mode sample data, **mode helpers** (`isLive()` / `isDemo()`), preferences (theme, weights).
  - `scoring.js` browser copy of the scoring engine (same formula as the backend; used for lists and Demo Mode).
  - `router.js`, `views.js` (every page), `actions.js` (click/form actions, resume upload queue, self-test), `app.js` (events, startup).
- **Two clearly separated modes**
  - **Real session** (register/login): MongoDB is the source of truth. Jobs and candidates are loaded from the server after sign-in;
    the browser keeps only the JWT and display preferences (theme, saved weights). If the server fails you get an error message
    and a *Try again* button - never fabricated data. An expired token returns you to the sign-in screen.
  - **Demo Mode** ("Try Demo Mode" button): offline sample data in this browser, labelled *Demo Mode* in the header.
    Resume upload is disabled there; no sample candidate is ever created from a file.
- **Resume upload flow:** select a job -> drop/browse PDF or DOCX (several at once) -> the server extracts text and parses it
  (`POST /api/candidates/upload` with `preview=true`, nothing saved) -> review/correct name, email, phone, location -> *Review & Create
  Candidate* (same endpoint again, with your corrections as `overrides`) -> run screening. Duplicates (same file or same email for the
  same job) are refused with "This candidate already exists for this job."
- **Themes:** Light, Dark or System (Settings or the header button); the choice is stored in `localStorage` and applied before first paint.
- **API base URL** (`config.js`): `window.HIRELENS_API_BASE_URL` if set; `http://localhost:3000/api` when opened as `file://` or served
  from another dev port; otherwise same-origin `/api`.
- Console helpers: `runSelfTest()` (21 checks, runs in Demo Mode) and `HireLens.resetData()`.

## Backend
Express app in `Backend/src` (routes → controllers → services → models). Full endpoint table, security notes and
resume-upload behaviour are in [Backend/README.md](Backend/README.md). Express also serves `frontend/` as static
files at `/`, so `http://localhost:3000` gives the app and the API on one origin; `/api/*` is unchanged.

## MongoDB
Database `hirelens_ai` (name fixed in `Backend/src/config/db.js`), collections `users`, `jobs`, `candidates`,
`screenings`, `auditlogs`. Set `MONGODB_URI` (local MongoDB or Atlas). Uploaded resume files are parsed in memory and
discarded; only extracted text, structured fields and file metadata are stored.

## Authentication
`POST /api/auth/register` and `/login` return a JWT (bcrypt-hashed passwords, `JWT_SECRET`, default 7-day expiry).
The frontend keeps the token in `localStorage` and sends `Authorization: Bearer <token>`; a 401 clears it.
Registration always creates a `recruiter`; data is scoped per user. Auth routes are rate limited.

## Screening engine
`Backend/src/services/scoringEngine.js` is deterministic and is the only thing that produces scores:
`overall = skills×0.35 + experience×0.20 + semantic×0.25 + education×0.10 + projects×0.10` (weights configurable, must
total 100%). Every result lists matched / partial / missing skills, strengths, gaps and evidence taken from the actual
candidate and job data. Gender, religion, caste, race, age, photograph and marital status are never used.
A test checks that the backend and `frontend/js/scoring.js` give identical scores on the demo data.

## AI service
`Backend/src/services/aiService.js` (optional; needs `AI_API_KEY` and `AI_MODEL`) writes recruiter summaries, interview
questions and job-analysis hints from already-computed facts. It never changes a score, keys stay on the server, and
every call falls back to deterministic output if AI is unconfigured or fails.

## API (all under `/api`, JWT required except health and auth)
`GET /health` · `GET /candidates/upload-config` (limits) · `POST /auth/register|login`, `GET /auth/me` · `/jobs` CRUD, `POST /jobs/:id/analyze`,
`GET /jobs/:id/ranking`, `POST /jobs/:id/ranking/simulate` · `/candidates` CRUD, `POST /candidates/upload` (multipart: `resume`, `job`, optional `preview=true`, `overrides`) / `compare`
· `POST /screen` · `POST /interview/questions` (technical, behavioral, project, role-specific, skill-gap, follow-up) · `GET /reports/:candidateId?jobId=` · `GET /analytics`, `GET /audit-logs`.
The ranking endpoint lists only candidates that have been screened for that job.

## Run locally
```bash
cd Backend
cp .env.example .env     # set MONGODB_URI and JWT_SECRET (e.g. openssl rand -hex 32)
npm install
npm run seed             # optional, dev only: demo@hirelens.ai / password with demo jobs and candidates
npm start                # http://localhost:3000  -> app at /, API at /api, health at /api/health
npm test                 # parser, scoring, upload-flow and AI-fallback tests; real PDF/DOCX extraction and the MongoDB API suite run after npm install
```
To use only the frontend, open `frontend/index.html` (it talks to `http://localhost:3000/api` if the backend is running,
otherwise use the demo account).

## Environment variables (`Backend/.env`)
| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | signs JWTs; never commit |
| `PORT`, `NODE_ENV` | no | default `3000`, `development` |
| `JWT_EXPIRES_IN` | no | default `7d` |
| `CLIENT_URL` | production | comma-separated allowed browser origins (not needed when Express serves the frontend) |
| `AI_API_KEY`, `AI_MODEL` | no | enable AI extraction, summaries and questions; `AI_PROVIDER` (`anthropic` default or `openai`), `AI_BASE_URL`, `AI_EMBEDDING_MODEL` optional |
| `AI_RESUME_EXTRACTION`, `AI_TIMEOUT_MS`, `AI_MAX_RESUME_CHARS` | no | AI extraction switch (default `true`), provider timeout (20000), characters sent (24000) |
| `MAX_RESUME_MB`, `UPLOAD_RATE_LIMIT` | no | upload size limit (1-20, default 5) and uploads per user per 15 min (40) |
| `RESUME_TEXT_RETENTION_DAYS` | no | delete stored resume text after N days (0 = keep until the candidate is deleted) |

Deploying (Render/Railway): the Express app expects the repository root so it can find `frontend/` next to `Backend/`
(start command `npm start` from `Backend`, health check `/api/health`). If only `Backend/` is deployed, the API still
works and the frontend must be hosted separately with `window.HIRELENS_API_BASE_URL` and `CLIENT_URL` set.

## Resume parsing and AI-assisted extraction
Upload -> **validate** (extension, MIME type, magic bytes, size limit `MAX_RESUME_MB`) -> **extract text in memory** (`pdf-parse` for PDF,
`mammoth` for DOCX; password-protected, corrupted and scanned/image-only files get specific messages - OCR is *not* implemented, so scanned PDFs
are rejected with a clear message) -> **rule-based parse** -> *(optional)* **AI structuring** -> review/edit -> save.

- **Fields:** name, email, phone, location, LinkedIn/GitHub/portfolio, summary, skills (normalized and grouped: languages, frameworks, libraries,
  databases, cloud, tools, other), education (degree, field, institution, start/graduation year, CGPA/percentage only if written), work experience
  (employer, title, dates, responsibilities, measurable results, internship flag), projects (description, technologies, links, contribution),
  certifications, achievements, publications, years of experience (stated or calculated). Anything not in the resume stays empty and is shown as
  **"Not found"** - nothing is guessed (`React.js` does not imply `JavaScript`; a `github.com/...` link is not a "GitHub" skill).
- **AI step (only if `AI_API_KEY` and `AI_MODEL` are set; `AI_RESUME_EXTRACTION=false` turns it off):**
  1. The resume text goes to the model inside `<resume_text>` tags as **untrusted data**; the system prompt forbids following anything written in it,
     and the model has no tools.
  2. The reply must be JSON; it is validated against a schema (`services/resumeSchema.js`); unknown keys (e.g. an injected `"score": 100`) are dropped.
  3. **Grounding:** every value must be verifiable in the resume text (emails, phones, URLs, employers, institutions, years, grades, skills, sentences).
     Anything the model invented or inferred is discarded and counted in a warning. So the AI only helps *structure* what is explicitly written.
  4. Timeouts, 429/5xx (one automatic retry), malformed output or invalid shape -> the rule-based result is used and a warning explains why.
  5. Explicit rule-based values always win over AI values for email/phone/links/name.
  Instruction-like text in a resume ("ignore all previous instructions...") never changes the result or the score; it only raises a warning, and such lines
  are not kept as profile content. **The AI never sets or changes a score.**
- **Storage & privacy:** uploaded files are **never written to disk** (memory storage; no temp files, nothing publicly reachable). Saved: the reviewed
  structured profile, a sanitized text copy (for explainability), a SHA-256 hash (duplicate detection), file metadata and the extraction method/warnings.
  The API never returns the stored text. Set `RESUME_TEXT_RETENTION_DAYS=N` to delete the text after N days; deleting a candidate removes the profile,
  text and screenings. Audit entries and logs contain no resume text or contact details. Uploads are rate limited per user (`UPLOAD_RATE_LIMIT`).
- **Matching:** the deterministic engine scores the saved profile against the selected job. "Not found in the resume" is worded as exactly that - it does
  not mean the candidate lacks the skill, and a missing field never rejects anyone. The profile and report explain the formula and its limits.

## Tests
- `npm test` (Backend): 57 tests, 53 passing locally + 4 skipped. Covers: scoring and normalization; the parser on five synthetic resumes (PDF/DOCX text);
  AI pipeline (valid output, hallucination removal, prompt injection, malformed JSON, timeout, 429 retry, provider error, truncation); upload flow with
  in-memory models (preview, duplicates, overrides, scanned / password-protected / corrupted PDFs, size limit, **no files written**, cross-recruiter access,
  edit-and-save validation, retention, audit without personal data, scoring on real data).
- Skipped without extra setup: 3 tests that run real `pdf-parse`/`mammoth` on the fixture PDF/DOCX files (need `npm install`) and the MongoDB API suite
  `tests/api.test.js` (needs `mongodb-memory-server`, i.e. `npm install`): real-file uploads, unauthorized upload/access, persistence, multi-tenant isolation.
- `Backend/tests/e2e/` is a developer harness (not part of `npm test`): `fakeServer.js` serves the frontend and runs the real controllers on in-memory
  models; `browser.e2e.js` drives Chromium through the whole flow with the fixture files. Screenshots: `docs/screenshots/`.
- Fixtures are synthetic people (`Backend/tests/fixtures/`); no real candidate data is used or committed.
