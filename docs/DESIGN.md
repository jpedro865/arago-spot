# Arago Spot — Design & Decisions

AI-powered LinkedIn connection-message generator for Arago's Talent Acquisition team.
This document records the decisions behind it. Everything here is a choice, with the reason and the alternative rejected.

---

## 1. What the product has to do

| Requirement                             | Where it's handled                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| LinkedIn as primary candidate source    | Unipile `GET /users/{id}` (§4.1)                                                         |
| Functional LinkedIn integration         | Unipile hosted-auth + API (§4.1)                                                         |
| AI model generates the message          | Claude API, `claude-opus-5` (§5)                                                         |
| English output                          | System prompt + evaluated in tests                                                       |
| ≤300 characters incl. spaces            | Server-side validator + retry loop (§5.3) — never trusted to the model                   |
| ≥1 specific element from the profile/CV | Structured output returns an `evidence` field quoting the source snippet (§5.2)          |
| Clearly relates to the selected job     | Job description injected from Ashby API (§4.2)                                           |
| No invented information                 | Grounding rules + `evidence` shown in UI (§5.2)                                          |
| Regenerate                              | Client keeps parsed context; regenerate re-posts with `previous` to force variation (§6) |
| PDF fallback when URL fetch fails       | PDF sent natively to Claude as a `document` block (§4.3)                                 |

The constraint that shapes the rest of this document: the tool only earns its place if it is _faster than writing the message by hand_. Not the most complete solution, not the most features. Every decision below is biased that way.

---

## 2. The interaction cost problem

A recruiter writes these one at a time, between other work. If the workflow costs too many clicks, copy-and-paste actions, manual inputs or page changes, it stops being faster than just typing the message — and then nobody opens it twice.

The obvious build is **two URL inputs**: one for the candidate, one for the job. But Arago's job board is a fixed, small, public list:

```
GET https://api.ashbyhq.com/posting-api/job-board/arago  →  16 jobs, with descriptionPlain
```

So asking a recruiter to go find and paste a job URL is a manual input we can simply delete. **The job becomes a dropdown, pre-loaded.** Pasting a job URL still works — `resolveJob()` extracts the UUID and matches it, for anyone who arrives from the board with a link already on their clipboard — but the default path is one paste + one select + one click.

It costs almost nothing to build and it removes the single most annoying step.

**Target interaction cost: paste URL → pick job → Generate → Copy.** Four actions, one screen, no page changes.

---

## 3. Stack

| Layer      | Choice                                                               | Why (and what was rejected)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework  | **Next.js 15 (App Router) + TypeScript**                             | One repo, one deploy, API routes are the backend. Rejected: separate FastAPI/Express backend — a second service to host for three endpoints.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Hosting    | **Vercel** free tier                                                 | Zero-config for Next.js, public URL with no infrastructure work. Rejected: Fly/Railway/Docker — more setup, no benefit here.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| UI         | **shadcn/ui** — scaffolds the project _and_ supplies every component | `shadcn init -t next` generates the Next.js app, Tailwind v4, and `components.json` in one command; each component is then `shadcn add <name>`. Source is copied in, so there is no runtime UI dependency and no component we maintain. Rejected: hand-rolled CSS (slow to look good), MUI/Chakra (heavy runtime dep). See §6.2.                                                                                                                                                                                                                  |
| State      | **React local state.** No database.                                  | Nothing needs to outlive the request. Rejected: Postgres/KV — persistence for a tool with no accounts, no history requirement, no multi-user state. Add later if they ask for message history.                                                                                                                                                                                                                                                                                                                                                    |
| Validation | **Hand-written type guards.** No validation library.                 | Three boundaries, and each one needs a different check, not a shared schema: the request body is two `typeof` tests, the Unipile payload treats every field as absent-able and degrades (§4.1), and the model's JSON is checked for shape before it is trusted (§5.2). Rejected: Zod — a dependency and a parallel set of schemas to keep in step with the types, for what ten lines of `typeof` already do at three fixed points. Add it when there is a fourth boundary or a payload deep enough that a hand-written guard stops being obvious. |
| Tests      | **`node:test`**, stdlib                                              | Node runs `.ts` directly with `--experimental-strip-types`, so there is no test framework, no config, and no dependency at all. Rejected: Vitest (a dependency for what stdlib does), Playwright E2E (cost far exceeds value on a 3-endpoint prototype).                                                                                                                                                                                                                                                                                          |

No database, no auth, no queue, no ORM, no state manager. The answer to "why no X" is that nothing in the product needs it yet.

---

## 4. Data sources

### 4.1 Candidate — Unipile (primary)

The lowest-risk route to real profile data.

```
GET https://{subdomain}.unipile.com:{port}/api/v1/users/{identifier}?account_id={ACCOUNT_ID}
X-API-KEY: {UNIPILE_API_KEY}
```

- `identifier` = the last path segment of the profile URL. `linkedin.com/in/satyanadella/` → `satyanadella`.
- Returns `headline`, `work_experience[]`, `education[]`, `skills`, `location` — everything the prompt needs.
- We use `linkedin_sections` to request only the sections we ground on, keeping payload and token count down.
- Calls execute **on behalf of a connected LinkedIn account** (mine, connected once via Unipile hosted auth). This is Unipile's stated model and is what keeps the integration within third-party terms — see §4.4.

The lookup is a `GET` with `next: { revalidate: 3600 }`, so **Regenerate never reaches LinkedIn again** — the Data Cache answers the identical URL. That is the §6 "no refetch" promise and the §9 rate-limit mitigation, and it costs no code: same idiom as the Ashby fetch, no client-side profile cache to trust and validate.

**Known risk:** the Unipile trial is **7 days**, and it bills per connected account after. Mitigation: §4.3 ships as a permanent fallback, so the product degrades instead of hard-failing when the trial lapses or billing stops.

### 4.2 Job — Ashby public posting API

Verified live. One unauthenticated GET returns the entire board including `descriptionPlain`, so:

- **No scraping, no headless browser, no HTML parsing.** The careers page has a public JSON API behind it; using it is both more reliable and less code.
- The whole board is fetched once server-side and cached for the page (`revalidate: 3600`) to fill the dropdown.
- A pasted job URL is resolved by extracting the trailing UUID and matching `jobUrl`.

### 4.3 Fallback — PDF/CV upload

The second path into the same pipeline, for when Unipile is down, rate-limited, or out of contract — and for candidates the connected account simply cannot see.

**We do not parse the PDF ourselves.** It is sent as a `file` content block and Claude reads it natively. That deletes `pdf-parse`, the serverless bundling headache, and — the reason that actually matters — the text-extraction quality problem.

```jsonc
{
  "type": "file",
  "file": {
    "filename": "cv.pdf",
    "file_data": "data:application/pdf;base64,…",
  },
}
```

**Why not extract the text first.** A CV is the worst possible input for a text extractor. Two columns, a sidebar, a skills table, a header — extraction returns reading order as the bytes happen to sit in the file, which interleaves the columns and hands the model a scrambled document that still _looks_ like text. Nothing downstream can tell that apart from a badly written CV, so the failure is silent: a generic message, or `evidence` quoting a sentence the candidate never wrote. §5.2 exists to make hallucination visible; feeding it a mangled source defeats it. A designed CV also carries information in its layout — what is emphasised, what is grouped, what is a heading — and native processing renders each page as an image alongside the text, so Claude sees that. Scanned CVs, where extraction returns nothing at all, come free with the same decision.

**And the cost is not the deciding factor at this volume.** Native PDF billing is text tokens plus one page image, roughly 2,300 tokens per page (Anthropic documents 1,500–3,000 text tokens per page; AWS publishes ~7,000 for a 3-page PDF in visual mode against ~1,000 for text-only extraction — a ~5× multiplier that our own 3-page sample, 5,959 extractable characters ≈ 1,500 tokens, matches). At `claude-opus-5`'s $5/1M input:

| Path                         | Tokens for a 2-page CV | Input cost |
| ---------------------------- | ---------------------- | ---------- |
| Text extracted, sent as text | ~1,000                 | $0.005     |
| PDF sent natively            | ~4,600                 | $0.023     |

Under two cents of difference per draft, against a workflow whose entire premise is beating a recruiter writing the message by hand. Buying layout fidelity and scanned-CV support for that is not a close call, and the §5.1 position stands: cost is not the design constraint here, quality of the one paragraph is.

**No `file-parser` plugin block.** OpenRouter already defaults to the model's own file handling, so specifying `engine: "native"` is a no-op on Claude — and it turns a swapped `OPENROUTER_MODEL` (§5.1's whole point) into a hard error on any model without native file input, where the default instead falls back to `mistral-ocr` at $2/1k pages, about $0.004 per CV. The line that changes nothing on the happy path and breaks the comparison path is the line not to write. If native passthrough ever misbehaves, `engine: "cloudflare-ai"` (free, PDF → markdown) is the fallback-to-the-fallback and is a one-line addition then.

**Entry point: always on screen.** The upload is not gated on a failed lookup — see §6. A recruiter with only a CV never produces the error that would have revealed it.

**Size ceiling: 3 MB**, checked on both sides (`checkPdf`, `lib/generate.ts`). Vercel caps a function request body at 4.5 MB and base64 inflates a file by a third, so a larger CV would fail as an opaque 413 rather than a sentence a recruiter can act on.

### 4.4 Why not scraping, and why not LinkedIn's official API

Three mechanisms get confused with each other. We use exactly one of them.

| Option                                                                                       | Verdict                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LinkedIn official API**                                                                    | Not available. OpenID Connect returns only the _authenticated member's own_ profile. Third-party profile lookup requires a LinkedIn Talent Solutions partnership — gated and months long. This is a non-option, not a rejected one. |
| **Scraping** (`linkedin-profile-scraper`, `linkedin-jobs-scraper`, Apify/Bright Data actors) | Rejected. All require injecting an `li_at` session cookie into a headless browser.                                                                                                                                                  |
| **Unipile**                                                                                  | Chosen. Acts on behalf of an authenticated account, scoped to what that account can already see.                                                                                                                                    |

Scraping is rejected on three grounds, in order of weight:

1. **Third-party terms.** A cookie-driven headless browser is the textbook case of access inconsistent with a platform's terms of service. Arago is a company with a legal department; shipping this would be their problem, not just ours.
2. **Precedent, six weeks old.** LinkedIn sued Proxycurl — the largest LinkedIn-data API — in January 2026 (CFAA, fraud, breach of contract). Proxycurl shut down on 4 July 2026. Building a recruiting tool on that pattern now is indefensible.
3. **It is also worse engineering.** Puppeteer on Vercel serverless means bundle bloat and cold starts; LinkedIn blocks datacenter IP ranges aggressively; selectors break continuously; the driving account gets banned. More code, less reliability.

To be precise rather than flattering: Unipile drives LinkedIn's private endpoints via a real session, so it is not "officially sanctioned" in an absolute sense. What makes it defensible is that it is account-scoped, vendor-operated with its own compliance posture, and accumulates no scraped database of its own.

---

## 5. AI layer

### 5.1 Provider and model

**OpenRouter**, called with plain `fetch` — no SDK.

The `openai` package was the obvious choice and was rejected once the call was written: this is a single non-streaming POST with a JSON body, and the SDK's value is retries, streaming helpers, and typed params for a surface we use one corner of. `fetch` is ~15 lines and zero dependencies. If a second call shape or streaming ever appears, the SDK earns its place then.

Model: **`anthropic/claude-opus-5`** — verified on OpenRouter's models endpoint at 1M context, $5/$25 per 1M tokens (identical to first-party), with both `structured_outputs` and `reasoning` supported.

The generation is short but not easy — grounded, non-generic, persuasive, and hard-capped at 300 characters. Quality of that one paragraph _is_ the product, so we don't drop model tier to save fractions of a cent. Latency is managed with `reasoning: { effort: "low", exclude: true }` instead: OpenRouter maps `effort` to an Anthropic thinking budget, and `exclude` keeps reasoning tokens out of the response we have to parse.

**Why OpenRouter over calling Anthropic directly:**

- One key, one endpoint, and **model choice becomes configuration**. We can benchmark `anthropic/claude-opus-5` against `anthropic/claude-haiku-4.5` ($1/$5) on real profiles by changing an env var, which makes the quality-versus-cost tradeoff a number instead of an opinion.
- No provider lock-in this early. Model choice is not a decision worth freezing while the prompt is still moving.

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
  "message": "…the ≤300-char connection request…",
  "evidence": "…the exact snippet from the profile this message is built on…",
}
```

(`job_link` was specced here originally and dropped when built — nothing rendered it, and the message names the role anyway.)

`evidence` is the anti-hallucination mechanism, and it's the product feature too. The UI renders **"Based on: <evidence>"** under the message, so the recruiter can verify the personalization in one glance instead of re-reading the profile. Grounding you can _see_ beats grounding you're promised.

Prompt rules: only the supplied profile/job text may be used; no inferred employers, tenures, or achievements; if the profile is too thin to personalize, say so rather than invent.

### 5.3 The 300-character guarantee

Models cannot count characters reliably. So the limit is enforced in code:

1. Instruct the limit in the prompt (gets us close most of the time).
2. Validate `message.length <= 300` server-side.
3. On overflow, one retry that feeds back the actual length and the overage.
4. If it still overflows, return the shortest valid attempt or a clear error — **never** a silent truncation mid-word.

This is the most testable requirement in the product, and the most embarrassing one to fail in front of a user.

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

- **Editable output.** Recruiters will tweak; a read-only box would force a copy-paste into another editor, which is exactly the friction §2 is about.
- **Live character counter**, turning red past 300 (it can only happen after a manual edit).
- **Copy** puts it on the clipboard in one click — the recruiter's next action is pasting it into LinkedIn.
- **Regenerate** re-posts the _already fetched_ profile and job. No refetch, no Unipile call, no rate-limit burn — and it passes the previous messages so the new one is genuinely different, not a reshuffle.
- Errors are specific and actionable, and the CV upload sits under the form permanently rather than being revealed by the error it answers. Error-gating it was the first build and it was wrong: Generate is disabled without a URL, so the uploader was unreachable for a candidate you only have a CV for — exactly the case §4.3 exists for. It stays visually secondary (dashed, below the button), so the §2 path is still paste → pick → Generate.

Deliberately **not** building: tone/length selectors, message history, multi-candidate batching, accounts. Each is a plausible v2 and each dilutes a workflow whose whole value is being short.

### 6.1 Brand and theme

The Arago wordmark resolves to exactly one colour: **`#3F00FF`** — `oklch(0.4732 0.3008 273.6)`, pure electric blue-violet at 100% saturation. (The mark itself is a diffraction pattern — the literal _Arago spot_, which is also this repo's name.)

**One finding that changes the design.** Measured against a near-black surface, the brand colour scores **2.49:1** — it fails WCAG AA for text (4.5:1) and for UI components (3:1). It cannot be used unmodified in dark mode. On white it scores 7.91:1 and passes AAA, so light mode can use it pure.

So the two modes are not the same colour on inverted backgrounds:

- **Light — blue on white.** `--primary` is the true brand `#3F00FF`, white label on it at 7.91:1.
- **Dark — blue on black.** `--primary` lifts to `oklch(0.62 0.20 273.6)` = `#6475FC` with a dark label, 5.19:1. Neutrals are tinted toward the brand hue rather than pure grey, which is what makes it read as _Arago's_ black instead of generic dark mode.
- **The pure brand colour still appears in dark mode** — as the wordmark and as a soft radial glow behind the card, echoing the logo's diffraction motif. Decorative use carries no contrast obligation, so the brand stays present without breaking legibility.

Tokens below are gamut-verified and contrast-checked; paste into `app/globals.css`. shadcn/ui on Tailwind v4 overrides the same names inside `.dark`.

```css
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 273.6); /* #FFFFFF */
  --foreground: oklch(0.2 0.03 273.6); /* #121524 */
  --card: oklch(1 0 273.6);
  --card-foreground: oklch(0.2 0.03 273.6);
  --primary: oklch(0.4732 0.3008 273.6); /* #3F00FF  brand */
  --primary-foreground: oklch(1 0 273.6);
  --secondary: oklch(0.968 0.012 273.6); /* #F2F4FD */
  --secondary-foreground: oklch(0.24 0.035 273.6);
  --muted: oklch(0.968 0.012 273.6);
  --muted-foreground: oklch(0.5 0.03 273.6); /* #5D6275  6.05:1 */
  --accent: oklch(0.955 0.02 273.6);
  --accent-foreground: oklch(0.3 0.09 273.6);
  --border: oklch(0.917 0.014 273.6); /* #E0E3ED */
  --input: oklch(0.917 0.014 273.6);
  --ring: oklch(0.4732 0.3008 273.6);
}

.dark {
  --background: oklch(0.145 0.022 273.6); /* #070913  blue-tinted black */
  --foreground: oklch(0.968 0.008 273.6); /* #F2F4FA  18.06:1 */
  --card: oklch(0.185 0.024 273.6); /* #0F121D */
  --card-foreground: oklch(0.968 0.008 273.6);
  --primary: oklch(0.62 0.2 273.6); /* #6475FC  lifted brand, 5.19:1 */
  --primary-foreground: oklch(0.145 0.022 273.6);
  --secondary: oklch(0.245 0.026 273.6); /* #1C202D */
  --secondary-foreground: oklch(0.968 0.008 273.6);
  --muted: oklch(0.245 0.026 273.6);
  --muted-foreground: oklch(0.712 0.028 273.6); /* #9CA1B4  7.73:1 */
  --accent: oklch(0.285 0.048 273.6);
  --accent-foreground: oklch(0.968 0.008 273.6);
  --border: oklch(0.278 0.028 273.6); /* #242836 */
  --input: oklch(0.32 0.03 273.6);
  --ring: oklch(0.62 0.2 273.6);
}
```

Verified contrast — every pair passes its WCAG threshold:

| Pair                     | Light   | Dark    | Threshold      |
| ------------------------ | ------- | ------- | -------------- |
| Body text on background  | 18.13:1 | 18.06:1 | 4.5 (AA)       |
| Button label on primary  | 7.91:1  | 5.19:1  | 4.5 (AA)       |
| Primary against page     | 7.91:1  | 5.19:1  | 3.0 (non-text) |
| Muted text on background | 6.05:1  | 7.73:1  | 4.5 (AA)       |

Theme switching is `next-themes` with `class` strategy, defaulting to **light** — the brand colour is only pure `#3F00FF` on white, so a first-time visitor should land on the mode that shows it. Dark is one click (or `d`) away and is remembered. `enableSystem` is off: nothing sets `"system"` now that the toggle flips light/dark directly.

### 6.2 shadcn setup

Project is scaffolded _by_ shadcn rather than added to afterwards:

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

- `lib/auth.test.ts` _(written)_ — signature forgery, wrong secret, tampered expiry, expired-but-correctly-signed tokens, malformed input, and exact-match-only password comparison. Six cases; this is the only security boundary in the app, so it is the one place tests are not optional.
- `linkedInUrlToIdentifier()` _(written, `lib/unipile.test.ts`)_ — trailing slashes, query strings, `/in/` vs company URLs, locale prefixes.
- `lib/generate.test.ts` _(written)_ — the limit boundary at exactly 300/301, empty and whitespace-only drafts, and astral characters counted once rather than twice.
- `resolveJob()` _(written, `lib/ashby.test.ts`)_ — UUID extraction from a pasted Ashby URL, and the not-found case. A bare id is itself a UUID, so the dropdown path and the pasted-URL path are one match, not two branches.
- `publicMessage()` _(written, `lib/errors.test.ts`)_ — the one place internal error text could reach the client, so it asserts that upstream bodies and env-var names never do.

One convention this forces: a _value_ import between `lib/` modules needs the explicit `.ts` extension (`from "./log.ts"`). Next resolves either form, but `node --experimental-strip-types` uses Node's ESM resolver, which does not guess extensions — so an extensionless import passes `tsc` and `next build` and fails only under `npm test`. Type-only imports are exempt: they are erased before Node sees them.

Not tested: the OpenRouter call and the Unipile call. Mocking them would test the mocks. Both are exercised manually against the live services before each release.

---

## 8. Deployment

- Public URL on Vercel; env vars `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `UNIPILE_API_KEY`, `UNIPILE_DSN`, `UNIPILE_ACCOUNT_ID`, `PASSWORD`, `PASSWORD_SECRET`.
- README covers: run locally, run tests, architecture in one diagram, the decisions above in short form, and known limitations stated plainly.
- `npm test`, `npm run typecheck` and `npm run lint` are clean before anything is pushed.

### 8.1 Access control

The deploy is a public Vercel URL, and behind it sit a paid inference key and a connected LinkedIn account. It should not be open to the internet, indexable, or reachable by anyone who guesses the subdomain. So the whole app sits behind **one shared password**.

Not user accounts: there is one small, known audience — the TA team — and no per-user state anywhere in the product. A login form with a single password is the entire requirement — a user table, sessions per identity, or an auth provider would all be infrastructure serving nobody.

**Mechanism**

| Piece        | Choice                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| Gate         | `proxy.ts` — runs before every route except `/login` and static assets         |
| Credential   | `PASSWORD`, compared in constant time against the submitted value              |
| Session      | HMAC-SHA256 signed cookie, keyed by `PASSWORD_SECRET`, 7-day expiry            |
| Cookie flags | `httpOnly`, `secure`, `sameSite=lax`, `path=/`                                 |
| Login page   | Server component + server action — no client JS, works with scripting disabled |

`PASSWORD_SECRET` is what stops the cookie from being forged. Without a signature, `session=ok` in devtools would be a valid session; with it, minting one requires the secret. The two variables are not interchangeable and neither is optional.

Crypto goes through **Web Crypto** (`crypto.subtle`), not Node's `crypto` — the proxy runs on the Edge runtime, where the Node module is unavailable. This is the detail most likely to break a naive implementation.

**Development is bypassed.** `NODE_ENV === "development"` returns `next()` immediately, so `npm run dev` needs no password and no env vars. `next build` / `next start` and every Vercel deploy set `NODE_ENV=production` and are therefore gated — running a production build locally will correctly ask for the password.

**Fail closed.** If `PASSWORD` or `PASSWORD_SECRET` is missing in production, the proxy returns **503** rather than allowing the request. A missing environment variable silently disabling the gate is the classic version of this bug, and it is the one thing here worth being deliberate about.

**Deliberately not built**

- _Rate limiting._ Serverless instances do not share memory, so in-process counters are close to useless and a real limiter means Vercel KV or Upstash — infrastructure for a demo gate. A high-entropy password is the mitigation. Add a limiter if this ever holds anything real.
- _Password rotation, reset, lockout, audit log._ No.

**One consequence to manage.** A gate is only as good as its handover. Anyone who is given the URL has to be given the password in the same breath — someone who hits a login wall with no credential cannot tell it apart from a broken deploy, and will report it as one. The password lives in the README and goes out with every link to the app.

---

## 9. Risks, stated honestly

| Risk                                                 | Mitigation                                                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unipile trial expires, or billing stops              | PDF fallback keeps the product usable regardless — shipped                                                                                                                    |
| LinkedIn rate-limits or blocks the connected account | Regenerate never refetches; one profile fetch per candidate; PDF fallback                                                                                                     |
| Thin profile → generic message                       | `evidence` field makes weakness visible instead of hidden; prompt is instructed to admit insufficiency rather than invent                                                     |
| A profile the connected account cannot see           | Error message says exactly that and offers the PDF path inline                                                                                                                |
| Someone gets the URL but not the password            | The README carries it and it goes out with every link (§8.1); this is the failure mode that looks like a broken deploy                                                        |
| OpenRouter outage or routing to a degraded endpoint  | `require_parameters: true` prevents silent schema degradation; the client is OpenAI-compatible, so falling back to a direct provider call is a base-URL and model-slug change |

---

## 10. Build order

1. Ashby fetch + job dropdown _(no dependencies, verified working — ships the UX win first)_ — **done**
2. Claude generation against a hardcoded profile fixture — proves the prompt, the structured output, and the 300-char loop — **done**
3. Unipile integration behind the same interface — **done**; the fixture is deleted, `lib/unipile.ts` maps `GET /users/{id}` onto the same `Profile`, and nothing above it changed. Not yet exercised against the live API (§9), so the first real call is the one to watch.
4. UI polish, copy, error states — **done**; Copy button, stale drafts cleared when the candidate or role changes, and `UserError` (`lib/errors.ts`) splits the errors worth showing a recruiter from the upstream bodies that only belong in the logs. Skipped `sonner`/`skeleton` — the Copy button confirms itself and §5.1 already chose the spinner.
5. Tests, README, deploy — **tests and README done**, deploy is the remaining step. All four §7 targets now exist (22 cases); `resolveJob()` was described in §2/§4.2 but had never actually been built, so pasted job URLs silently did nothing until now. `next build` is clean. **Shippable once deployed.**
6. PDF fallback — **done**; the CV rides the same `POST /api/generate` as a `data:` URL, `generate()` takes `Profile | { pdf }`, and the upload appears inline under the error that caused it. No new dependency and no new endpoint. §4.3 records why the PDF is not parsed first, and what the extra ~2 cents a draft buys.

Steps 1–2 produce a working product against fixtures. Unipile, the only external unknown, slots in without changing anything above it. Step 5 is the release gate: everything after it is additive.

**Tradeoff of deferring the PDF fallback to last:** it was the mitigation for two risks in §9 (Unipile trial lapsing, and a profile the connected account cannot see), so until step 6 landed a Unipile failure was a dead end rather than a degraded path. Accepted deliberately, and it paid: the fallback reuses the request body, the route and the prompt that steps 1–5 settled, which is why it is one type and one branch rather than a second pipeline.

**Known gap:** Regenerate re-posts the CV, so each variant is billed for the PDF again (§4.3's ~2 cents), where the LinkedIn path is answered by the Data Cache. Worth fixing only if drafting variants off a CV turns out to be the common case rather than the fallback it is meant to be.

---

## 11. Out of scope, and why

The long-term vision is a Grammarly-style Chrome extension that detects the LinkedIn message field in place. That is probably the right long-term product. It is deliberately not v1: it needs store review, it breaks whenever LinkedIn ships a DOM change, and it cannot be validated with the TA team next week.

Worth noting: the architecture is a single `POST /api/generate` taking `{ profile, jobId }`. An extension would be a thin client over that same endpoint, with the profile scraped from the DOM the recruiter is already looking at. The web app is not a detour from the vision; it's the backend of it.
