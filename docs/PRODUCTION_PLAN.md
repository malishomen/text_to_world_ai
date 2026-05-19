# DreamCraft — Production Architecture Plan

> Status: planning document. Nothing in this file is implemented yet. The
> current shipped system is described in `docs/PROJECT_MAP.yaml`; the most
> recent hardening work (timeouts + restart) is in `FIX_PLAN.md`. This
> document describes what we would build *next* if the hackathon MVP becomes
> a real product.

---

## 1. Where we are today (hackathon MVP)

DreamCraft today is a single-machine demo. A Next.js 16 App Router app
(`web/`) takes a dream from the user, calls three local AI services from its
own route handlers, writes the resulting images and GLBs into
`web/public/generated/` and `web/public/generated3d/`, and stitches the
artifacts together client-side in `app/play/page.tsx` using React Three
Fiber + Rapier. There is no database, no auth, and no queue — the entire
pipeline runs in-process and state is passed between pages via
`localStorage` (`dreamText`, `gameConfig`, `gameAssets`). The full inventory
is in `docs/PROJECT_MAP.yaml` (see `architecture.runtime_processes`,
`api.endpoints`, and `frontend.cache_strategy`).

**What works on a developer laptop**

- One person, one dream, one game at a time.
- LM Studio at `:1234`, Automatic1111 at `:7860`, TRELLIS (HF Space or local
  Gradio) — all reachable on `localhost`.
- Hard client-side timeout of 75 s (`NEXT_PUBLIC_MAX_GENERATION_MS`) plus
  `lib/with-timeout.ts` on every Gradio call (Phases A–B in `FIX_PLAN.md`)
  keep the demo from hanging when an upstream is down.
- `web/lib/fallback-config.ts` gives every page a known-good default scene
  when the AI pipeline fails.

**What breaks the moment we deploy this**

- The route handlers in `web/app/api/generate-3d/route.ts` and
  `web/app/api/generate-assets/route.ts` hold the request open for 30–90 s.
  Vercel's serverless runtime caps Node functions at 10 s (Hobby) / 60 s
  (Pro) / 900 s (Enterprise, on Fluid Compute only) — anything that needs
  to run TRELLIS inline will be killed.
- `QWEN_BASE_URL`, `SD_BASE_URL`, `TRELLIS_URL` all default to `localhost`
  values that are meaningless on Vercel.
- `web/app/api/generate-3d/route.ts` writes files into `web/public/`. Vercel
  filesystem outside `/tmp` is read-only, and `/tmp` is wiped between
  invocations and is not exposed via a public URL.
- All state lives in the browser. Refreshing the tab after generation
  starts loses the in-flight job; closing the browser before navigation
  silently aborts everything.
- There is no notion of "user" — the same `localStorage` key collides
  across tabs and across people sharing a device.

The rest of this document is the migration plan from "works on my laptop"
to "works for N concurrent users, observably, recoverably, and within a
budget."

---

## 2. Why Vercel-only isn't enough

Vercel (or any serverless-only host) is genuinely good for the static
frontend and the small synchronous endpoints (`/api/analyze` if we keep its
LLM call short). It is the wrong place for the rest of the pipeline.

### 2.1 Long-running generation exceeds serverless timeouts

| Step                          | Realistic wall time | Vercel function limit  |
|-------------------------------|---------------------|------------------------|
| `/api/analyze` (LLM)          | 2–15 s              | 10 s Hobby / 60 s Pro  |
| `/api/generate-assets` (SD ×3)| 15–45 s             | exceeds Hobby reliably |
| `/api/generate-3d` (TRELLIS ×3)| 60–240 s, cold 5 min| exceeds every tier on a non-Fluid runtime |

The TRELLIS step in particular is bursty: a cold HF Space takes minutes to
wake. `lib/with-timeout.ts` lets us *bail out* of those calls, but it does
not make them faster. In production we have to move the long calls behind
an async job, not behind an HTTP request.

### 2.2 Local AI dependencies are invisible to Vercel

`QWEN_BASE_URL=http://localhost:1234` cannot resolve from a Vercel edge
node. We need either:

- a managed inference provider (Replicate, RunPod Serverless, Modal,
  Together, Fireworks) — pay-per-second, no infra to operate, but each
  provider has its own model catalog and quirks; or
- a self-hosted GPU box (Hetzner GEX44, Lambda, Runpod Pod, or a colocated
  3090/4090) running vLLM + SD WebUI + TRELLIS behind a private network.

Either way the *frontend host* and the *AI host* are now two different
things connected over the network.

### 2.3 Runtime filesystem writes are incompatible with read-only FS

The current code does:

```ts
fs.writeFileSync(path.join(process.cwd(), 'public/generated3d', filename), buf);
```

That assumes a writable, persistent, *publicly-served* directory. On any
serverless target (Vercel, Cloudflare Pages, Netlify), `process.cwd()` is
read-only, `/tmp` is ephemeral, and nothing under either is served as a
static asset. The fix is not "find a place to write files" — it is "stop
writing files, write to object storage and return signed URLs."

### 2.4 Per-request AI cost vs batched/queued

Today every page load that triggers `/loading-dream` fires three SD calls
and three TRELLIS calls, with no deduplication, no cap, no batching. A
single user hitting refresh ten times costs us thirty image generations
and thirty 3D extractions. With a job queue:

- We can deduplicate by (user_id, dream_hash) — the second click reuses
  the first job's result.
- We can throttle per-user and per-IP (see §7).
- We can batch SD prompts into a single A1111 `/sdapi/v1/txt2img` request
  with `batch_size > 1` — A1111 amortizes the model load.
- We can prioritize: paying users go to a fast queue, anonymous demo
  traffic goes to a slow queue.

This is the single biggest lever for keeping the bill bounded.

---

## 3. Target architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            User browser                                  │
│  Next.js 16 (App Router, RSC)  ──▶  /loading-dream polls /api/jobs/:id  │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │ HTTPS
                       ▼
        ┌──────────────────────────────────┐
        │  Vercel — Next.js frontend       │   <- thin: SSR pages,
        │  Edge cache, RSC, auth callback  │      no long jobs here
        └────┬───────────────────────┬─────┘
             │ enqueue job           │ read status/results
             ▼                       ▼
   ┌─────────────────┐      ┌──────────────────────┐
   │  API Gateway    │◀────▶│  Postgres (Neon /    │
   │  Fastify on     │      │  Supabase / RDS)     │
   │  Fly.io / Railway│      │  users, dreams,      │
   │  region: ams     │      │  assets, gen_jobs    │
   └────┬────────────┘      └──────────────────────┘
        │ BullMQ producer
        ▼
   ┌─────────────────┐
   │   Redis         │  ◀── BullMQ queues:
   │   (Upstash /    │      analyze, generate-assets,
   │    Redis Cloud) │      generate-3d, finalize
   └────┬────────────┘
        │ BullMQ consumer (long-poll)
        ▼
   ┌──────────────────────────────────────────────┐
   │  Worker pool — Python FastAPI on RunPod      │
   │  Serverless GPU (cold-start friendly) OR     │
   │  pinned GPU box (Hetzner GEX44 + 4090)       │
   │  hosts: vLLM (Qwen), SD WebUI, TRELLIS       │
   └────┬─────────────────────────────────────────┘
        │ PUT pre-signed URLs
        ▼
   ┌──────────────────────────────────────────────┐
   │  Object storage — Cloudflare R2              │
   │  bucket: dreams/<dreamId>/...                │
   │  fronted by Cloudflare CDN                   │
   └──────────────────────────────────────────────┘
```

### 3.1 Frontend — keep on Vercel

The Next.js app stays on Vercel. It does three things:

1. Serves marketing + landing (`app/page.tsx`).
2. Mounts the React Three Fiber scene (`app/play/page.tsx` +
   `components/DreamGame3D.tsx`). R3F loads client-side only via
   `next/dynamic({ ssr: false })`, which is exactly what Vercel is good at.
3. Acts as the auth callback host (NextAuth or Clerk middleware).

The Vercel `/api/*` routes shrink to thin proxies: enqueue a job, read job
status, sign a download URL. No long-running work.

### 3.2 Generation backend — Fastify (Node) on Fly.io

Recommendation: **Fastify on Node 20, deployed on Fly.io in the same
region as Redis and Postgres** (e.g. `ams` or `iad`).

Rationale for picking Fastify-on-Node over a Python FastAPI worker for
*this* tier:

- Schema (`gameConfigSchema`, Phase 2 of the migration) lives in
  TypeScript already; we can share it between frontend and backend via a
  `@dreamcraft/shared` package. A Python FastAPI service would need its
  pydantic mirror.
- The "API + queue producer" tier does no model inference itself. It just
  validates input, writes a row to Postgres, and pushes a BullMQ job. Node
  is fine.
- BullMQ is the Node-native ergonomic queue. pg-boss is the alternative if
  we want to keep the dependency footprint to just Postgres (see §3.3).

The *worker* tier — the actual GPU process — is a separate service and
**is** Python (FastAPI or Litestar). Wrapping diffusers / TRELLIS / vLLM
in Python is far easier than calling them from Node. So we end up with
two services: a Node API and a Python worker, talking via Redis + R2.

### 3.3 Job queue — BullMQ on Redis (with pg-boss as a serious alternative)

Pick **BullMQ on Upstash Redis** for V1.

| Option         | Pros                                      | Cons                                                |
|----------------|-------------------------------------------|-----------------------------------------------------|
| BullMQ + Redis | Mature, great DX, per-job progress, repeatable jobs, rate limits built in | Adds Redis as a dependency, Redis memory cost grows with job volume |
| pg-boss        | Zero new infrastructure (we already need Postgres), transactional enqueue with the row insert | Lower throughput, weaker tooling, polling-based     |
| Cloud Tasks / SQS | Operationally trivial             | Vendor lock, weaker progress reporting, harder local dev |

BullMQ wins on developer ergonomics: `QueueEvents` gives us free progress
streaming to SSE; `FlowProducer` lets us express the
`analyze → fan-out(SD, TRELLIS) → finalize` DAG natively. If Redis cost
becomes a problem in V2 we can move to pg-boss without changing the
shape of `generation_jobs`.

### 3.4 Object storage — Cloudflare R2

Pick **Cloudflare R2** for V1.

- S3-compatible API → `@aws-sdk/client-s3` works unchanged.
- **No egress fees**, which matters because we serve GLBs (5–20 MB each)
  and PNGs to every player.
- Free tier is generous enough to cover the hackathon-to-V1 window.
- Pairs naturally with Cloudflare CDN in front (same account, single
  cache rule).

S3 itself is the safe alternative if we end up on AWS for other reasons.
Supabase Storage is fine but its egress pricing is worse than R2 and we
do not need its Postgres-row-level-RLS integration here.

### 3.5 Database — Postgres (Neon)

Postgres is the default for one reason: every other piece of this stack
already speaks SQL. Specifically we want:

- JSONB for `dreams.dream_text_analysis` (the raw LLM output before we
  shape it into the game config) and `dreams.game_config` (the validated
  output). JSONB indexes let us search by `genre`, `palette`, etc.
- `LISTEN`/`NOTIFY` so the API can push job-state changes to SSE without
  polling Redis.
- Mature migration tooling (Prisma, Drizzle, or plain `node-pg-migrate`).

**Neon** specifically because: serverless Postgres scales-to-zero between
demos (matters when we are not yet break-even), branch-per-PR is built
in, and the connection-pool proxy makes Vercel function cold-starts
tolerable. Supabase is the alternative if we want bundled auth.

### 3.6 GPU worker pool

Two viable shapes:

- **Managed serverless GPU** (RunPod Serverless, Modal, Replicate): pay
  per second, cold start 5–30 s, no ops. Best when traffic is bursty and
  unpredictable, which describes V1.
- **Pinned GPU box** (Hetzner GEX44 with 4090, ~€220/mo; or LeaderGPU /
  Vast.ai): predictable bill, no cold starts, but we own the
  reliability. Best when we have a steady ≥30 % utilization.

Recommendation: **start on RunPod Serverless** with one image bundling
vLLM (Qwen2.5-7B-Instruct), an `sd-webui` API, and the TRELLIS Gradio
predict path exposed as a plain HTTP endpoint. Migrate to pinned hardware
when sustained utilization > 30 % for a week.

---

## 4. Job lifecycle

### 4.1 States

```
queued ──▶ analyzing ──▶ generating_assets ──┬──▶ ready
                                              │
                                              └──▶ failed
```

`generating_assets` covers both 2D (SD) and 3D (TRELLIS) in parallel; the
job only advances to `ready` when both children finish (or one finishes
and the other fails non-fatally — we ship with a partial result rather
than failing the whole dream, mirroring the `partial: true` behaviour in
the current `/api/generate-3d` route).

### 4.2 Transitions

| From → To                                | Trigger                                    | Writer       | Side effects                                                              | Retry policy                                  |
|------------------------------------------|--------------------------------------------|--------------|---------------------------------------------------------------------------|-----------------------------------------------|
| (none) → `queued`                        | `POST /api/dreams` after auth + rate limit | API server   | Row in `dreams`, row in `generation_jobs`, BullMQ `analyze` job enqueued  | n/a (synchronous failure returns 4xx/5xx)     |
| `queued` → `analyzing`                   | Worker picks up `analyze` job              | Worker       | LLM call to vLLM; updates `generation_jobs.started_at`                    | 3 attempts, exp. backoff (1 s, 4 s, 15 s)     |
| `analyzing` → `generating_assets`        | LLM returns valid config (Zod-validated)   | Worker       | Enqueue `generate-assets` + `generate-3d` as BullMQ child flow            | LLM JSON parse fail → 1 retry, then fallback config (no further retry) |
| `analyzing` → `failed`                   | All LLM retries exhausted *and* no fallback acceptable | Worker | `dreams.error` set, SSE event emitted, job archived after 7 days        | manual replay only                            |
| `generating_assets` → `ready`            | Both children resolved (success or partial)| Worker (finalize step) | R2 URLs written to `assets`, `dreams.status='ready'`, NOTIFY        | n/a                                           |
| `generating_assets` → `failed`           | Both children hard-fail                    | Worker       | Cleanup of any partial R2 uploads (lifecycle rule handles orphans too)    | per-child: 2 attempts; whole-job: no replay   |
| `ready` → (terminal)                     | —                                          | —            | Asset URLs remain valid until lifecycle TTL (§5)                          | —                                             |

The `analyze` step is cheap enough to retry aggressively. The
`generate-3d` step is expensive (GPU-minutes) and must retry at most
twice; the third failure surfaces as a "partial" result so the user still
gets a playable scene built from `lib/fallback-config.ts`.

### 4.3 Idempotency

Every state transition writes by `generation_id` (UUID v7) which the
client gets back on enqueue. The API rejects duplicate `POST /api/dreams`
with the same `Idempotency-Key` header within a 10 minute window.

---

## 5. Storage layout in object storage

### 5.1 Bucket layout

Single bucket per environment: `dreamcraft-prod`, `dreamcraft-staging`,
`dreamcraft-dev`. Inside the bucket:

```
dreams/
  <dreamId>/
    config.json                  # validated GameConfig (immutable)
    raw/
      llm-response.json          # original LLM output for debugging (24h TTL)
      sd-prompts.json
    assets/
      2d/
        background.png
        character.png
        platform.png
      3d/
        character.glb
        prop.glb
        portal.glb
      preview.webp               # auto-generated thumbnail
```

`dreamId` is a UUIDv7 so listing by prefix gives chronological order
without a secondary index.

### 5.2 Lifecycle rules (R2 / S3 lifecycle policy)

| Path                            | TTL                      | Reason                                                 |
|---------------------------------|--------------------------|--------------------------------------------------------|
| `dreams/*/raw/*`                | 24 hours → delete        | Debug-only; not referenced by the game                 |
| `dreams/*/` where job `failed`  | 7 days → delete          | Orphans from failed runs                               |
| `dreams/*/` where last access > 30 d | move to R2 Infrequent Access | Cold dreams keep their URL but pay less to store |
| `dreams/*/` where last access > 180 d | hard delete         | GDPR + cost; users get a 14-day warning email          |

`last_access` is tracked in `dreams.last_played_at`, updated by
`POST /api/dreams/:id/touch` from the game canvas on session start.

### 5.3 CDN integration

R2 bucket → Cloudflare Worker (or directly via `r2.dev` public bucket for
non-sensitive assets) → CDN cache with `Cache-Control:
public, max-age=31536000, immutable`. Asset URLs are content-addressed by
`dreamId`, so they are safe to cache forever. Signed URLs are used only
for private dreams; public dreams (the "share my dream" feature) are
served from cache.

---

## 6. Database schema (minimal)

PostgreSQL 16. Migrations live in `apps/api/db/migrations/`. Use
`uuid_generate_v7` (via `pg_idkit` or manual `gen_random_uuid` if v7 is
not available yet).

```sql
-- users -----------------------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT UNIQUE NOT NULL,
  display_name    TEXT,
  auth_provider   TEXT NOT NULL,        -- 'google' | 'github' | 'email'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- dreams ----------------------------------------------------------------
CREATE TYPE dream_status AS ENUM
  ('queued','analyzing','generating_assets','ready','failed');

CREATE TABLE dreams (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  dream_text         TEXT NOT NULL CHECK (length(dream_text) <= 5000),
  status             dream_status NOT NULL DEFAULT 'queued',
  game_config        JSONB,             -- validated by gameConfigSchema
  generation_id      UUID NOT NULL UNIQUE, -- echoed to client; used for idempotency
  is_public          BOOLEAN NOT NULL DEFAULT false,
  last_played_at     TIMESTAMPTZ,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dreams_user_created_idx  ON dreams (user_id, created_at DESC);
CREATE INDEX dreams_status_idx        ON dreams (status) WHERE status <> 'ready';
CREATE INDEX dreams_public_recent_idx ON dreams (created_at DESC) WHERE is_public;
CREATE INDEX dreams_genre_idx         ON dreams USING gin ((game_config -> 'genre'));

-- assets ----------------------------------------------------------------
CREATE TYPE asset_kind AS ENUM
  ('background_2d','character_2d','platform_2d',
   'character_3d','prop_3d','portal_3d','preview');

CREATE TABLE assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_id      UUID NOT NULL REFERENCES dreams(id) ON DELETE CASCADE,
  kind          asset_kind NOT NULL,
  filename      TEXT NOT NULL,
  storage_url   TEXT NOT NULL,        -- public CDN URL or signed-URL key
  size_bytes    BIGINT NOT NULL,
  mime_type     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dream_id, kind)             -- one of each kind per dream
);

CREATE INDEX assets_dream_idx ON assets (dream_id);

-- generation_jobs -------------------------------------------------------
CREATE TYPE job_stage AS ENUM
  ('analyze','generate_assets_2d','generate_assets_3d','finalize');

CREATE TABLE generation_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dream_id      UUID NOT NULL REFERENCES dreams(id) ON DELETE CASCADE,
  stage         job_stage NOT NULL,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  attempts      SMALLINT NOT NULL DEFAULT 0,
  last_error    TEXT,
  worker_id     TEXT,                  -- which worker pod processed this
  duration_ms   INTEGER GENERATED ALWAYS AS
    (EXTRACT(EPOCH FROM (finished_at - started_at))*1000)::INTEGER STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX gen_jobs_dream_idx       ON generation_jobs (dream_id, stage);
CREATE INDEX gen_jobs_open_idx        ON generation_jobs (started_at)
  WHERE finished_at IS NULL;
CREATE INDEX gen_jobs_duration_idx    ON generation_jobs (stage, duration_ms);
```

Notes:

- `dreams.generation_id` is the client-facing handle. The internal `id` is
  what foreign keys reference. Keeping them separate lets us rotate the
  client-facing ID if we ever leak one.
- `assets.UNIQUE(dream_id, kind)` is what makes regeneration safe: a
  retried worker job upserts on this constraint instead of accumulating
  duplicates.
- `generation_jobs.duration_ms` as a generated column gives us cheap
  Grafana queries: `SELECT stage, percentile_cont(0.95) WITHIN GROUP
  (ORDER BY duration_ms) FROM generation_jobs WHERE finished_at >
  now() - interval '1 hour' GROUP BY stage;`.
- The partial index `dreams_status_idx WHERE status <> 'ready'` keeps the
  hot-path query (`find me stuck jobs`) tiny.

---

## 7. Security

### 7.1 Auth

- **End users**: NextAuth.js v5 (a.k.a. Auth.js) with Google + GitHub
  providers, sessions stored in Postgres via the Drizzle adapter. Clerk
  is the managed alternative if we want SSO + organizations out of the
  box (worth it once we add B2B). NextAuth is fine for V1.
- **Worker → object storage**: a single R2 service-account key with
  `bucket:dreamcraft-prod` scope only; rotated quarterly. Stored in the
  worker's secret manager, never in source.
- **API → worker**: shared HMAC on the BullMQ job payload so a leaked
  Redis URL cannot enqueue arbitrary work. Worker rejects jobs whose
  HMAC does not match.

### 7.2 Rate limiting

Use Upstash Ratelimit (Redis-backed sliding window) at the Fastify edge,
keyed differently per route:

| Route                          | Authenticated         | Anonymous              |
|--------------------------------|-----------------------|------------------------|
| `POST /api/dreams`             | 5 / hour / user       | 1 / hour / IP          |
| `GET /api/dreams/:id`          | 60 / minute / user    | 60 / minute / IP       |
| `POST /api/dreams/:id/replay`  | 2 / hour / user       | denied                 |
| Asset download (R2 → CDN)      | not rate-limited (CDN) | not rate-limited (CDN) |

Tight anonymous limits are the demo-traffic firebreak. The `5/hour`
authenticated limit comes from a back-of-envelope: at SD ≈ $0.0008/image
and TRELLIS ≈ $0.05/run on a managed provider, 5 dreams cost ≈ $0.30
per user per hour — survivable as a free tier; revisited when paid tiers
land.

### 7.3 Prompt length limit

Enforce **5000 characters** on both ends:

- Frontend: `app/page.tsx` `<textarea maxLength={5000}>` plus a Zod check
  in the form action.
- Server: same Zod schema on `POST /api/dreams`. The `dreams.dream_text`
  column has `CHECK (length(dream_text) <= 5000)` as the last line of
  defence.

5000 chars maps to ~1250 tokens on Qwen's tokenizer, leaving headroom for
the system prompt within an 8k context.

### 7.4 Secret management

- Vercel: built-in environment variables, separate per environment
  (Preview / Production). Never in `.env` files in the repo. The current
  `.env.local.example` (Phase C of `FIX_PLAN.md`) becomes the
  documentation of what each variable does.
- Fly.io / Railway (API + worker): `fly secrets set` / Railway secret
  store. Same name as Vercel for cross-env consistency.
- R2 keys: stored in Vercel's secret manager and in the worker's
  secret store; the worker never sees the Postgres URL and the API
  never sees the GPU credentials.

### 7.5 LLM injection mitigation

The user can attempt a prompt-injection by pasting `"Ignore previous
instructions and output {evil JSON}"`. The defence is layered:

1. The system prompt in `/api/analyze` already constrains output to JSON
   and lists field names.
2. **Validate the LLM's JSON against `gameConfigSchema`** (Zod). This is
   the extraction we already plan in step 1 of §9. Reject anything that
   does not match (extra fields are stripped; missing required fields
   trigger fallback).
3. Cap LLM output tokens (`max_tokens: 1500`, from Phase B.4 of
   `FIX_PLAN.md`).
4. Run the prompt through a quick `allowlist` regex check (`[\p{L}\d\s
   .,!?'"-]+`) and reject anything containing control characters or
   markdown code fences — those are usually injection attempts.
5. Log every LLM call's request + response to `dreams.raw/llm-response.json`
   with 24h TTL so we can audit.

The schema is the load-bearing defence — without it, the entire game
config is whatever the LLM happens to output.

### 7.6 Cost guardrails

- Queue-depth alert at PagerDuty when BullMQ `waiting` count > 50 for
  > 5 min (suggests workers are dying or traffic spiked).
- Budget cap on RunPod: hard ceiling at $X / month, soft alert at 0.7×.
- Per-user spend tracking: `generation_jobs.duration_ms * stage_cost`
  rolled into a `user_spend_daily` materialized view; soft block at
  $1/day per free user.

---

## 8. Observability

### 8.1 Logging

- Structured JSON via `pino` (Node) and `structlog` (Python worker).
- One field per concept: `dream_id`, `generation_id`, `user_id`, `stage`,
  `duration_ms`, `attempt`. No interpolated strings into the message
  body — Loki / Datadog filters become useless once you do.
- **Redact**: API keys, the user's email, the raw dream text in any log
  that ships off-host. Aggregate logs say "dream of 387 chars analyzed in
  4.2 s," not the dream itself. Privacy: per-user logs (debug mode) only
  with explicit user consent.

### 8.2 Tracing

OpenTelemetry SDK in both API and worker, exporting to either Grafana
Tempo (self-hosted, cheap) or Honeycomb (managed, better UX). One trace
spans the full job: `analyze → fan-out → finalize`. Span attributes
mirror the log fields above so jumping log → trace is one click.

Critical spans:

- `api.dreams.create` (Fastify)
- `worker.analyze.llm_call`
- `worker.generate_assets_2d.sd_txt2img` (×3, one per asset)
- `worker.generate_assets_3d.trellis_image_to_3d` (×3)
- `worker.finalize.upload_to_r2`

### 8.3 Metrics

Prometheus scraping from both services, Grafana dashboards.

| Metric                                             | Type      | SLO                        |
|----------------------------------------------------|-----------|----------------------------|
| `dream_generation_duration_seconds{stage=...}`     | histogram | p95 `ready` < 90 s         |
| `dream_generation_errors_total{stage=...,reason}`  | counter   | < 2 % of `analyze` fails   |
| `bullmq_queue_depth{queue=...}`                    | gauge     | `waiting` < 20 sustained   |
| `worker_gpu_utilization_percent`                   | gauge     | 30–70 % during business hr |
| `r2_storage_bytes`                                 | gauge     | growth rate < $X/mo        |
| `auth_rate_limit_blocks_total`                     | counter   | spike alert                |

### 8.4 On-call dashboard

A single Grafana page with three rows:

1. **Now**: queue depth per queue, in-flight jobs, oldest in-flight job
   age (alerts when > 5 min for any single job).
2. **Last hour**: success/fail ratio per stage, p50/p95/p99 duration per
   stage.
3. **Failed jobs table**: live SQL view over `generation_jobs` where
   `last_error IS NOT NULL AND created_at > now() - interval '1 day'`,
   with a "replay" button that re-enqueues via the API.

---

## 9. Migration path (incremental)

Each step is independently shippable; each one leaves the system *more*
production-ready without breaking the demo. Do not skip ahead.

### Step 1 — Extract `gameConfigSchema` (already underway: Phase 2 of the 12-phase plan)

Move the shape of the `gameConfig` object into a Zod schema in
`web/lib/game-config-schema.ts`. Use it in `/api/analyze`, in the
fallback (`lib/fallback-config.ts`), and in `/play`'s `useEffect` guard.
This is the contract every later step assumes.

**Done when**: `web/lib/fallback-config.ts` returns a value typed by
`z.infer<typeof gameConfigSchema>` and `/api/analyze` calls
`gameConfigSchema.parse()` on the LLM output before returning.

### Step 2 — Move generation to a separate worker process

Lift `app/api/generate-3d/route.ts` and `app/api/generate-assets/route.ts`
out of Next.js into a standalone Node service (`apps/api/`). Same code,
new host. The Vercel route becomes `fetch(API_BASE + '/generate-3d')`.
No queue yet; this is just a deployment topology change.

**Done when**: deleting the AI deps from `web/package.json` does not
break `npm run build`.

### Step 3 — Introduce a job queue; switch loading-dream to poll

Add Redis + BullMQ. `POST /api/dreams` now enqueues an `analyze` job and
returns `{ generationId }` immediately. `loading-dream/page.tsx` stops
calling generate endpoints directly; instead it polls
`GET /api/dreams/:generationId` every 2 s and reads `status` +
`progress`. The hard 75 s client timeout from
`NEXT_PUBLIC_MAX_GENERATION_MS` is replaced by a server-side job timeout
in BullMQ (`job.opts.timeout = 180_000`), and the client just shows
"Still working… 95 s" without bailing.

**Done when**: closing the browser tab mid-generation, then re-opening
`/loading-dream?id=...`, resumes from current status (no work is lost).

### Step 4 — Move filesystem writes to object storage

Worker writes to R2 via signed PUT URLs. `assets.storage_url` is now the
CDN URL. Delete `web/public/generated/` and `web/public/generated3d/`
entirely. `lib/generated-paths.ts` is replaced by `lib/asset-urls.ts`
which just returns the CDN URL from the API response.

**Done when**: the Vercel deploy passes with `web/public/generated*`
removed from the repo and `.gitignore`.

### Step 5 — Add user auth + rate limiting

NextAuth on Vercel; sessions in Postgres. `POST /api/dreams` requires a
session OR a captcha-gated anonymous token. Upstash Ratelimit middleware
on every state-changing route.

**Done when**: an unauthenticated user hits the 1/hour anonymous limit
and sees a friendly "sign in for 5/hour" upsell.

### Step 6 — Add database + admin views

Postgres comes online for `users`, `dreams`, `assets`, `generation_jobs`.
A simple `/admin` route (next-auth-gated by an `admin` role) renders
the failed-jobs table and a replay button.

**Done when**: a failed dream from yesterday can be replayed in one click
from `/admin`.

### Step 7 — Scale workers

Move the worker from "one box" to "N RunPod Serverless workers." Set the
BullMQ concurrency per worker to 1 (TRELLIS uses all GPU memory) and
scale horizontally via RunPod's `min_workers` / `max_workers`. Add the
Grafana dashboard from §8.4.

**Done when**: a 10× traffic spike (load-tested with `k6`) does not
breach the p95 SLO for more than 2 minutes.

---

## 10. Open questions / decisions to make

These are not blockers for Step 1 but each one influences design from
Step 5 onward.

### 10.1 Self-host AI vs managed provider

- **Replicate / Modal / RunPod Serverless**: $0.0005–0.002 / SD image,
  $0.05–0.10 / TRELLIS run. Zero ops, but per-request latency is at the
  mercy of someone else's cold start.
- **Self-host on a Hetzner GEX44 + 4090** (~€220/mo): fixed cost, no
  cold start once warm, but we own model updates, GPU driver patches,
  and out-of-memory diagnosis.

Default V1 answer: **managed** (RunPod Serverless). Switch to self-host
when sustained GPU utilization > 30 % over a week.

### 10.2 Streaming progress: SSE vs WebSocket vs polling

- **Polling** (2 s, `GET /api/dreams/:id`): simplest; works through any
  proxy; wastes ~30 requests per dream. Fine for V1.
- **SSE** (EventSource over the same `/api/dreams/:id/events` endpoint):
  one open connection, server pushes `progress` and `state` events.
  Trivial on Fastify with `fastify-sse-v2`. Vercel Edge supports SSE.
- **WebSocket**: overkill for one-way push; only worth it once we add
  multiplayer ("watch a friend's dream generate live").

Recommended: **start with polling in Step 3**, swap to **SSE in Step 7**
when worker progress events become rich enough to be worth pushing.

### 10.3 Multi-region from day one

No. Single region (`eu-central` or `us-east-1`, pick where the founding
team is) until DAU > 1000 or we have a paying customer in another
continent. Multi-region adds Postgres logical replication + R2
geo-replication + a regional DNS layer — months of work for milliseconds
of improvement we cannot yet justify.

### 10.4 Out of scope for V1; revisit when…

- **Custom user-uploaded reference images** — revisit when V1 retention
  shows users want to "iterate on a dream."
- **Realtime multiplayer dreams** — revisit when we have an analytics
  signal that users want it.
- **Mobile-native client** — the R3F scene works on mobile Safari; PWA
  install is enough until we hit Apple-payment friction.

---

## 11. Estimate

All estimates assume one full-time engineer who has shipped a similar
stack before. Multiply by 1.5 for a first-timer; multiply by 0.7 if two
engineers can parallelize cleanly. Numbers are *engineering* days only;
add 30 % for review, QA, and ops.

| Step | Description                                       | Effort      | Risk    |
|------|---------------------------------------------------|-------------|---------|
| 1    | Extract `gameConfigSchema` (Zod)                  | 1 day       | low     |
| 2    | Lift generation to a Fastify service              | 3 days      | medium (devops ramp) |
| 3    | BullMQ + Redis + polling client                   | 4 days      | medium  |
| 4    | R2 + signed URLs + asset table                    | 3 days      | low     |
| 5    | NextAuth + Upstash Ratelimit + 5000-char enforce  | 3 days      | low     |
| 6    | Postgres schema + Drizzle + `/admin`              | 4 days      | low     |
| 7    | RunPod Serverless workers + Grafana + alerting    | 5 days      | high (ops on-call setup) |
| —    | OpenTelemetry tracing across all services         | 2 days      | low     |
| —    | Load test (`k6`) + SLO definition + runbook       | 2 days      | medium  |
| **Total** | **Steps 1–7 + observability + load test**    | **~27 days**| —       |

Calendar time: roughly **6–8 weeks** for one engineer; **4–5 weeks** for
two engineers with clean ownership of (frontend + auth) vs (worker + db
+ ops).

After Step 7 we are no longer running a hackathon demo: we have a system
that survives one engineer going on holiday, recovers from a worker
crash without losing user work, and shows a per-dream cost in Grafana.
Everything beyond that (paid tiers, multi-region, multiplayer) is a
business decision, not an architecture one.
