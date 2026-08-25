# Arago Spot — Design & Decisions

AI-powered LinkedIn connection-message generator for Arago's Talent Acquisition team.
This document locks the decisions for the build phase. Everything here is a choice, with the reason and the alternative rejected.

---

## 1. What the assignment actually asks for

| Requirement | Where it's handled |
|---|---|
| LinkedIn as primary candidate source | Unipile `GET /users/{id}` (§4.1) |
| Functional LinkedIn integration | Unipile hosted-auth + API (§4.1) |
| AI model generates the message | Claude API, `claude-opus-5` (§5) |
| English output | System prompt + evaluated in tests |
| ≤300 characters incl. spaces | Server-side validator + retry loop (§5.3) — never trusted to the model |
| ≥1 specific element from the profile/CV | Structured output returns an `evidence` field quoting the source snippet (§5.2) |
| Clearly relates to the selected job | Job description injected from Ashby API (§4.2) |
| No invented information | Grounding rules + `evidence` shown in UI (§5.2) |
| Regenerate | Client keeps parsed context; regenerate re-posts with `previous` to force variation (§6) |
| PDF fallback when URL fetch fails | PDF sent natively to Claude as a `document` block (§4.3) |
| Public URL + GitHub + README | Vercel + this repo (§8) |

The graded axes are **technical**, **product/UX**, and **judgment**. They explicitly say: not the most complex solution, not the most features. Fast, simple, effective wins. Every decision below is biased that way.

---

## 2. The one product insight worth having

The assignment says: *"If the workflow requires too many clicks, copy-and-paste actions, manual inputs, or page changes, it may defeat the purpose of the tool."*

The literal spec asks for **two URL inputs**. But Arago's job board is a fixed, small, public list — I verified it:

```
GET https://api.ashbyhq.com/posting-api/job-board/arago  →  16 jobs, with descriptionPlain
```

So asking a recruiter to go find and paste a job URL is a manual input we can just delete. **The job becomes a dropdown, pre-loaded.** Pasting a job URL still works (we extract the UUID and match it), so the literal requirement is met — but the default path is one paste + one select + one click.

This is the difference between implementing the spec and understanding the product. It's also nearly free to build.

**Target interaction cost: paste URL → pick job → Generate → Copy.** Four actions, one screen, no page changes.

---

## 3. Stack

| Layer | Choice | Why (and what was rejected) |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | One repo, one deploy, API routes are the backend. Rejected: separate FastAPI/Express backend — a second service to host for three endpoints. |
| Hosting | **Vercel** free tier | Zero-config for Next.js, gives the public test URL the submission needs. Rejected: Fly/Railway/Docker — more setup, no benefit here. |
| UI | **shadcn/ui** — scaffolds the project *and* supplies every component | `shadcn init -t next` generates the Next.js app, Tailwind v4, and `components.json` in one command; each component is then `shadcn add <name>`. Source is copied in, so there is no runtime UI dependency and no component we maintain. Rejected: hand-rolled CSS (slow to look good), MUI/Chakra (heavy runtime dep). See §6.2. |
| State | **React local state.** No database. | Nothing needs to outlive the request. Rejected: Postgres/KV — persistence for a tool with no accounts, no history requirement, no multi-user state. Add later if they ask for message history. |
| Validation | **Zod** | Already the idiom for typed API-route boundaries; guards the untrusted LinkedIn/Ashby payloads. |
| Tests | **`node:test`**, stdlib | Node runs `.ts` directly with `--experimental-strip-types`, so there is no test framework, no config, and no dependency at all. Rejected: Vitest (a dependency for what stdlib does), Playwright E2E (cost far exceeds value on a 3-endpoint prototype). |

No database, no auth, no queue, no ORM, no state manager. If a reviewer asks "why no X", the answer is that nothing in the product needs it yet.

---

## 4. Data sources

### 4.1 Candidate — Unipile (primary)

Blessed by the assignment, and the lowest-risk path.

```
GET https://{subdomain}.unipile.com:{port}/api/v1/users/{identifier}?account_id={ACCOUNT_ID}
X-API-KEY: {UNIPILE_API_KEY}
```

- `identifier` = the last path segment of the profile URL. `linkedin.com/in/satyanadella/` → `satyanadella`.
- Returns `headline`, `work_experience[]`, `education[]`, `skills`, `location` — everything the prompt needs.
- We use `linkedin_sections` to request only the sections we ground on, keeping payload and token count down.
- Calls execute **on behalf of a connected LinkedIn account** (mine, connected once via Unipile hosted auth). This is Unipile's stated model and is what keeps the integration within third-party terms — §7 of the assignment.

**Known risk:** the Unipile trial is **7 days**, and it bills per connected account after. Mitigation: start the trial timed to submission, and ship §4.3 as a permanent fallback so the product never hard-fails in front of a reviewer.

### 4.2 Job — Ashby public posting API

Verified live. One unauthenticated GET returns the entire board including `descriptionPlain`, so:

- **No scraping, no headless browser, no HTML parsing.** The careers page has a public JSON API behind it; using it is both more reliable and less code.
- The whole board is fetched once server-side and cached for the page (`revalidate: 3600`) to fill the dropdown.
- A pasted job URL is resolved by extracting the trailing UUID and matching `jobUrl`.

### 4.3 Fallback — PDF/CV upload

Explicitly allowed by the assignment, and it doubles as our demo-resilience story if Unipile is down, rate-limited, or the trial lapses.

**We do not parse the PDF ourselves.** It is sent as a `file` content block with OpenRouter's `file-parser` plugin set to `engine: "native"`, which passes the PDF straight through to Claude (which accepts PDFs natively) and bills it as input tokens. That deletes `pdf-parse`, the text-extraction quality problem, and the serverless bundling headache in one move.

```jsonc
"plugins": [{ "id": "file-parser", "pdf": { "engine": "native" } }]
```

If native passthrough misbehaves, `engine: "cloudflare-ai"` (free, PDF → markdown) is the fallback-to-the-fallback. `mistral-ocr` ($2/1k pages) is only worth it for scanned CVs, which is not the common case here.

### 4.4 Why not scraping, and why not LinkedIn's official API

Three mechanisms get confused with each other. We use exactly one of them.

| Option | Verdict |
|---|---|
| **LinkedIn official API** | Not available. OpenID Connect returns only the *authenticated member's own* profile. Third-party profile lookup requires a LinkedIn Talent Solutions partnership — gated and months long. This is a non-option, not a rejected one. |
| **Scraping** (`linkedin-profile-scraper`, `linkedin-jobs-scraper`, Apify/Bright Data actors) | Rejected. All require injecting an `li_at` session cookie into a headless browser. |
| **Unipile** | Chosen. Acts on behalf of an authenticated account, scoped to what that account can already see. |

Scraping is rejected on three grounds, in order of weight:

1. **The assignment's own §7** disclaims access "inconsistent with applicable third-party terms." A cookie-driven headless browser is the textbook case. This is a judgment test, not a technical one.
2. **Precedent, six weeks old.** LinkedIn sued Proxycurl — the largest LinkedIn-data API — in January 2026 (CFAA, fraud, breach of contract). Proxycurl shut down on 4 July 2026. Building a hiring-assignment product on that pattern is indefensible in a debrief.
3. **It is also worse engineering.** Puppeteer on Vercel serverless means bundle bloat and cold starts; LinkedIn blocks datacenter IP ranges aggressively; selectors break continuously; the driving account gets banned. More code, less reliability.

To be precise rather than flattering: Unipile drives LinkedIn's private endpoints via a real session, so it is not "officially sanctioned" in an absolute sense. What makes it defensible is that it is account-scoped, vendor-operated with its own compliance posture, accumulates no scraped database, and is the integration the assignment names explicitly.

---

## 5. AI layer

### 5.1 Provider and model

**OpenRouter**, called through the `openai` SDK pointed at OpenRouter's base URL (its API is OpenAI-compatible, so this is a two-line client config, not an adapter layer).

```ts
new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY })
```

Model: **`anthropic/claude-opus-5`** — verified on OpenRouter's models endpoint at 1M context, $5/$25 per 1M tokens (identical to first-party), with both `structured_outputs` and `reasoning` supported.

The generation is short but not easy — grounded, non-generic, persuasive, and hard-capped at 300 characters. Quality of that one paragraph *is* the product, so we don't drop model tier to save fractions of a cent. Latency is managed with `reasoning: { effort: "low", exclude: true }` instead: OpenRouter maps `effort` to an Anthropic thinking budget, and `exclude` keeps reasoning tokens out of the response we have to parse.

**Why OpenRouter over calling Anthropic directly:**

- One key, one endpoint, and **model choice becomes configuration**. We can benchmark `anthropic/claude-opus-5` against `anthropic/claude-haiku-4.5` ($1/$5) on real profiles by changing an env var, and report the tradeoff in the debrief with numbers instead of an opinion.
- No provider lock-in in a prototype whose model choice is explicitly left open by the assignment.

**Consequences accepted:**

- **A hop is added to the critical path.** OpenRouter is an extra dependency between us and inference (§9).
- **Anthropic-specific parameters do not exist here.** `output_config.effort` becomes `reasoning.effort`; `output_config.format` becomes `response_format` (§5.2). We set `provider: { require_parameters: true }` so requests only route to endpoints that actually honour our structured-output schema, rather than silently degrading to a provider that ignores it.

Other decisions unchanged by the switch:

- **Streaming: no.** The output is under 300 characters. Streaming buys no perceived speed and adds client complexity. A spinner is the honest UI here.
- **Cost:** ~2–4K input tokens, ~150 output. Fractions of a cent per generation. Not a design constraint.

### 5.2 Structured output, and how we prove we didn't hallucinate

We use `response_format` with a strict JSON Schema to get JSON back, not prose:

```jsonc
"response_format": {
  "type": "json_schema",
  "json_schema": { "name": "connection_message", "strict": true, "schema": { /* … */ } }
}
```

The shape:

```jsonc
{
  "message":  "…the ≤300-char connection request…",
  "evidence": "…the exact snippet from the profile this message is built on…",
  "job_link": "…the phrase tying it to the role…"
}
```

`evidence` is the anti-hallucination mechanism, and it's the product feature too. The UI renders **"Based on: <evidence>"** under the message, so the recruiter can verify the personalization in one glance instead of re-reading the profile. Grounding you can *see* beats grounding you're promised.

Prompt rules: only the supplied profile/job text may be used; no inferred employers, tenures, or achievements; if the profile is too thin to personalize, say so rather than invent.

### 5.3 The 300-character guarantee

Models cannot count characters reliably. So the limit is enforced in code:

1. Instruct the limit in the prompt (gets us close most of the time).
2. Validate `message.length <= 300` server-side.
3. On overflow, one retry that feeds back the actual length and the overage.
4. If it still overflows, return the shortest valid attempt or a clear error — **never** a silent truncation mid-word.

This is the single most testable requirement in the assignment and the most embarrassing one to fail live.

---

## 6. UX

One screen. No routing, no wizard, no modal.

```
┌──────────────────────────────────────────────┐
│  LinkedIn profile URL   [___________________] │
│  Open role              [ Senior RF/Analog ▾] │
│                                   [ Generate ]│
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  │
│  │ editable message                       │  │
│  └────────────────────────────────────────┘  │
│  248/300        [ Regenerate ]   [ Copy ]     │
│  Based on: "8 years in RF front-end design…"  │
└──────────────────────────────────────────────┘
```

- **Editable output.** Recruiters will tweak; a read-only box would force a copy-paste into another editor, which is exactly the friction the assignment warns about.
- **Live character counter**, turning red past 300 (it can only happen after a manual edit).
- **Copy** puts it on the clipboard in one click — the recruiter's next action is pasting it into LinkedIn.
- **Regenerate** re-posts the *already fetched* profile and job. No refetch, no Unipile call, no rate-limit burn — and it passes the previous messages so the new one is genuinely different, not a reshuffle.
- Errors are specific and actionable: profile not fetchable → the PDF upload appears inline, on the same screen.

Deliberately **not** building: tone/length selectors, message history, multi-candidate batching, accounts. Each is a plausible v2 and each dilutes a workflow whose whole value is being short.


### 6.1 Brand and theme

The Arago wordmark resolves to exactly one colour: **`#3F00FF`** — `oklch(0.4732 0.3008 273.6)`, pure electric blue-violet at 100% saturation. (The mark itself is a diffraction pattern — the literal *Arago spot*, which is also this repo's name. Worth a sentence in the debrief.)

**One finding that changes the design.** Measured against a near-black surface, the brand colour scores **2.49:1** — it fails WCAG AA for text (4.5:1) and for UI components (3:1). It cannot be used unmodified in dark mode. On white it scores 7.91:1 and passes AAA, so light mode can use it pure.

So the two modes are not the same colour on inverted backgrounds:

- **Light — blue on white.** `--primary` is the true brand `#3F00FF`, white label on it at 7.91:1.
- **Dark — blue on black.** `--primary` lifts to `oklch(0.62 0.20 273.6)` = `#6475FC` with a dark label, 5.19:1. Neutrals are tinted toward the brand hue rather than pure grey, which is what makes it read as *Arago's* black instead of generic dark mode.
- **The pure brand colour still appears in dark mode** — as the wordmark and as a soft radial glow behind the card, echoing the logo's diffraction motif. Decorative use carries no contrast obligation, so the brand stays present without breaking legibility.

Tokens below are gamut-verified and contrast-checked; paste into `app/globals.css`. shadcn/ui on Tailwind v4 overrides the same names inside `.dark`.

```css
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 273.6);              /* #FFFFFF */
  --foreground: oklch(0.20 0.030 273.6);       /* #121524 */
  --card: oklch(1 0 273.6);
  --card-foreground: oklch(0.20 0.030 273.6);
  --primary: oklch(0.4732 0.3008 273.6);       /* #3F00FF  brand */
  --primary-foreground: oklch(1 0 273.6);
  --secondary: oklch(0.968 0.012 273.6);       /* #F2F4FD */
  --secondary-foreground: oklch(0.24 0.035 273.6);
  --muted: oklch(0.968 0.012 273.6);
  --muted-foreground: oklch(0.50 0.030 273.6); /* #5D6275  6.05:1 */
  --accent: oklch(0.955 0.020 273.6);
  --accent-foreground: oklch(0.30 0.090 273.6);
  --border: oklch(0.917 0.014 273.6);          /* #E0E3ED */
  --input: oklch(0.917 0.014 273.6);
  --ring: oklch(0.4732 0.3008 273.6);
}

.dark {
  --background: oklch(0.145 0.022 273.6);      /* #070913  blue-tinted black */
  --foreground: oklch(0.968 0.008 273.6);      /* #F2F4FA  18.06:1 */
  --card: oklch(0.185 0.024 273.6);            /* #0F121D */
  --card-foreground: oklch(0.968 0.008 273.6);
  --primary: oklch(0.62 0.200 273.6);          /* #6475FC  lifted brand, 5.19:1 */
  --primary-foreground: oklch(0.145 0.022 273.6);
  --secondary: oklch(0.245 0.026 273.6);       /* #1C202D */
  --secondary-foreground: oklch(0.968 0.008 273.6);
  --muted: oklch(0.245 0.026 273.6);
  --muted-foreground: oklch(0.712 0.028 273.6);/* #9CA1B4  7.73:1 */
  --accent: oklch(0.285 0.048 273.6);
  --accent-foreground: oklch(0.968 0.008 273.6);
  --border: oklch(0.278 0.028 273.6);          /* #242836 */
  --input: oklch(0.320 0.030 273.6);
  --ring: oklch(0.62 0.200 273.6);
}
```

Verified contrast — every pair passes its WCAG threshold:

| Pair | Light | Dark | Threshold |
|---|---|---|---|
| Body text on background | 18.13:1 | 18.06:1 | 4.5 (AA) |
| Button label on primary | 7.91:1 | 5.19:1 | 4.5 (AA) |
| Primary against page | 7.91:1 | 5.19:1 | 3.0 (non-text) |
| Muted text on background | 6.05:1 | 7.73:1 | 4.5 (AA) |

Theme switching is `next-themes` with `class` strategy, defaulting to system.

### 6.2 shadcn setup

Project is scaffolded *by* shadcn rather than added to afterwards:

```bash
npx shadcn@latest init -t next
```

That produces the Next.js app, Tailwind v4, `components.json`, and `globals.css` — into which §6.1's tokens are pasted. Components are then pulled in as needed, no hand-written primitives:

```bash
npx shadcn@latest add button input textarea select card label skeleton sonner
```

- `select` — the job dropdown (§2)
- `textarea` + `label` — the editable message and its counter
- `skeleton` — the generating state
- `sonner` — copy confirmation and error toasts
- `card` — the single result surface

Anything beyond this list is a signal the UI is growing past what the workflow needs.


---

## 7. Testing

`npm test` — `node:test` from the standard library, no framework, no config, no dependency.

Covered over the logic that fails silently:

- `lib/auth.test.ts` *(written)* — signature forgery, wrong secret, tampered expiry, expired-but-correctly-signed tokens, malformed input, and exact-match-only password comparison. Six cases; this is the only security boundary in the app, so it is the one place tests are not optional.
- `linkedInUrlToIdentifier()` — trailing slashes, query strings, `/in/` vs company URLs, locale prefixes.
- `enforceLimit()` — the 300-char validator and retry decision.
- `resolveJob()` — UUID extraction from a pasted Ashby URL, and the not-found case.

Not tested: the OpenRouter call and the Unipile call. Mocking them would test the mocks. Both are exercised manually against the live services before submission.

---

## 8. Deployment & submission

- Public URL on Vercel; env vars `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `UNIPILE_API_KEY`, `UNIPILE_DSN`, `UNIPILE_ACCOUNT_ID`, `PASSWORD`, `PASSWORD_SECRET`.
- README covers: run locally, run tests, architecture in one diagram, the decisions above in short form, and known limitations stated plainly.
- Submitted ≥24h before the debrief, per §6 of the assignment.


### 8.1 Access control

The deploy is a public Vercel URL, and behind it sit a paid inference key and a connected LinkedIn account. It should not be open to the internet, indexable, or reachable by anyone who guesses the subdomain. So the whole app sits behind **one shared password**.

Not user accounts: there is one audience (Arago's reviewers) and no per-user state anywhere in the product. A login form with a single password is the entire requirement — a user table, sessions per identity, or an auth provider would all be infrastructure serving nobody.

**Mechanism**

| Piece | Choice |
|---|---|
| Gate | `middleware.ts` — runs before every route except `/login` and static assets |
| Credential | `PASSWORD`, compared in constant time against the submitted value |
| Session | HMAC-SHA256 signed cookie, keyed by `PASSWORD_SECRET`, 7-day expiry |
| Cookie flags | `httpOnly`, `secure`, `sameSite=lax`, `path=/` |
| Login page | Server component + server action — no client JS, works with scripting disabled |

`PASSWORD_SECRET` is what stops the cookie from being forged. Without a signature, `session=ok` in devtools would be a valid session; with it, minting one requires the secret. The two variables are not interchangeable and neither is optional.

Crypto goes through **Web Crypto** (`crypto.subtle`), not Node's `crypto` — middleware runs on the Edge runtime, where the Node module is unavailable. This is the detail most likely to break a naive implementation.

**Development is bypassed.** `NODE_ENV === "development"` returns `next()` immediately, so `npm run dev` needs no password and no env vars. `next build` / `next start` and every Vercel deploy set `NODE_ENV=production` and are therefore gated — running a production build locally will correctly ask for the password.

**Fail closed.** If `PASSWORD` or `PASSWORD_SECRET` is missing in production, middleware returns **503** rather than allowing the request. A missing environment variable silently disabling the gate is the classic version of this bug, and it is the one thing here worth being deliberate about.

**Deliberately not built**

- *Rate limiting.* Serverless instances do not share memory, so in-process counters are close to useless and a real limiter means Vercel KV or Upstash — infrastructure for a demo gate. A high-entropy password is the mitigation. Add a limiter if this ever holds anything real.
- *Password rotation, reset, lockout, audit log.* No.

**One consequence to manage.** The assignment asks for "a publicly accessible URL where we can test the product". A password gate satisfies the spirit (reachable, testable) but not a literal reading, so **the password must be handed over with the submission** — in the README and the submission message. A reviewer who hits a login wall with no credential is a failed submission, and that is a worse outcome than an open URL.


---

## 9. Risks, stated honestly

| Risk | Mitigation |
|---|---|
| Unipile 7-day trial expires before or during review | Time the trial to submission; PDF fallback keeps the product usable regardless — **but it is built last (§10), so this mitigation arrives late** |
| LinkedIn rate-limits or blocks the connected account | Regenerate never refetches; one profile fetch per candidate; PDF fallback |
| Thin profile → generic message | `evidence` field makes weakness visible instead of hidden; prompt is instructed to admit insufficiency rather than invent |
| Reviewer tests a profile my account can't see | Error message says exactly that and offers the PDF path inline |
| Reviewer receives the URL but not the password | README and submission message both carry it (§8.1); this is the failure mode that looks like a broken deploy |
| OpenRouter outage or routing to a degraded endpoint | `require_parameters: true` prevents silent schema degradation; the client is OpenAI-compatible, so falling back to a direct provider call is a base-URL and model-slug change |

---

## 10. Build order

1. Ashby fetch + job dropdown *(no dependencies, verified working — ships the UX win first)*
2. Claude generation against a hardcoded profile fixture — proves the prompt, the structured output, and the 300-char loop
3. Unipile integration behind the same interface
4. UI polish, copy, error states
5. Tests, README, deploy — **submittable from here**
6. PDF fallback

Steps 1–2 produce a working product against fixtures. Unipile, the only external unknown, slots in without changing anything above it. Step 5 is the submission gate: everything after it is additive.

**Tradeoff of deferring the PDF fallback to last:** it is the mitigation for two risks in §9 (Unipile trial lapsing, and a profile the connected account cannot see). Until step 6 lands, a Unipile failure in front of a reviewer is a dead end rather than a degraded path. Accepted deliberately — the primary path is what's being graded, and the fallback is worth nothing if the primary path is unfinished.

---

## 11. Out of scope, and why

The long-term vision is a Grammarly-style Chrome extension that detects the LinkedIn message field in place. That's the right product — and the assignment explicitly does not ask for it.

Worth noting for the debrief: the architecture is a single `POST /api/generate` taking `{ profile, jobId }`. An extension would be a thin client over that same endpoint, with the profile scraped from the DOM the recruiter is already looking at. The web app is not a detour from the vision; it's the backend of it.
