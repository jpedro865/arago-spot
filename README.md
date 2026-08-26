# arago spot

AI-drafted LinkedIn connection requests for Arago's Talent Acquisition team.
Paste a candidate's profile, pick an open role, get a grounded message under LinkedIn's
300-character limit — with the profile detail it was built on shown next to it.

---

## Run it

```bash
npm install
cp .env.example .env   # fill in the keys, see below
npm run dev            # http://localhost:3000
```

`npm run dev` needs no password — `NODE_ENV=development` bypasses the gate. A production
build (`npm run build && npm start`) will correctly ask for one.

| Variable                                                 | Required        | What it is                                                                       |
| -------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `BOARD_URL`                                              | yes             | Ashby public job board. The value in `.env.example` is Arago's and needs no key. |
| `OPENROUTER_API_KEY`                                     | yes             | Inference.                                                                       |
| `OPENROUTER_MODEL`                                       | no              | Defaults to `anthropic/claude-opus-5`. Swap to compare models.                   |
| `UNIPILE_DSN` / `UNIPILE_API_KEY` / `UNIPILE_ACCOUNT_ID` | yes             | LinkedIn profile lookup, on behalf of a connected account.                       |
| `PASSWORD` / `PASSWORD_SECRET`                           | production only | The gate. Missing in production ⇒ 503, never an open app.                        |
| `LOG_LEVEL`                                              | no              | `debug` logs the prompt, the raw profile and the draft.                          |

## Run the tests

```bash
npm test
```

`node:test` from the standard library — no framework, no config, no test dependency.
Needs Node ≥ 22 for `--experimental-strip-types`. Also `npm run typecheck` and `npm run lint`.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
   browser  ──────► │  /  (server component)                   │
                    │     └─ getJobs()  ──────────► Ashby posting API
                    │                                (public, cached 1h)
                    │  proxy.ts — password gate, Edge runtime  │
                    └──────────────────────────────────────────┘
                                     │  POST { profileUrl, jobId, previous }
                                     ▼
                    ┌──────────────────────────────────────────┐
                    │  /api/generate                           │
                    │   1. resolveJob()   id or pasted URL      │
                    │   2. fetchProfile() ────────► Unipile ──► LinkedIn
                    │                                (cached 1h)
                    │   3. generate()     ────────► OpenRouter ─► Claude
                    │      └─ ≤300 chars enforced in code,      │
                    │         one retry, never truncated        │
                    └──────────────────────────────────────────┘
                                     │  { message, evidence }
                                     ▼
                        editable textarea · live counter · Copy
```

One screen, no database, no routing, no state manager. `Regenerate` re-posts the same
profile URL, which the Next Data Cache answers — so drafting five variants costs **one**
LinkedIn call, not five.

Full reasoning, and every alternative rejected, is in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## The decisions that matter

**The job is a dropdown, not a second URL field.** Arago's board is a small public list with
a JSON API behind it, so making a recruiter go find and paste a job URL is a manual input we
could simply delete. Pasting one still works — `resolveJob()` takes the id or the URL, for
anyone arriving with a board link already copied — but the default path is
paste profile → pick role → Generate → Copy. The tool only earns its place if it beats
writing the message by hand, and every removed step widens that margin.

**Unipile, not scraping.** LinkedIn's official API only returns the authenticated member's
own profile; third-party lookup needs a Talent Solutions partnership. Every scraping library
in this space works by injecting an `li_at` session cookie into a headless browser — access
plainly inconsistent with LinkedIn's terms, and the exact pattern LinkedIn sued Proxycurl over
in January 2026 (Proxycurl shut down that July). Unipile acts on behalf of a connected account,
scoped to what that account can already see. It is also less code and more reliable: no
Puppeteer in a serverless bundle, no selectors breaking weekly, no driving account to get
banned.

**The 300-character limit is enforced in code, never trusted to the model.** Models cannot
count characters. The server validates, retries once with the actual overage fed back, and
fails loudly rather than truncating mid-word. Counting is by code point, so an emoji counts
once, and CRLF counts as one break.

**`evidence` is the anti-hallucination mechanism, and the product feature.** The model returns
the profile snippet it built on, quoted verbatim, and the UI renders it under the message. The
recruiter verifies the personalisation at a glance instead of re-reading the profile. Grounding
you can see beats grounding you're promised.

**OpenRouter over a direct Anthropic call.** Model choice becomes an env var, so
`claude-opus-5` vs `claude-haiku-4.5` is a measurable comparison rather than an opinion. Called
with plain `fetch` — the SDK's value is streaming and retries, and this is one non-streaming POST.

**One shared password, not accounts.** One audience, no per-user state anywhere. A user table
would be infrastructure serving nobody. Signed HMAC cookie, Web Crypto (the Edge runtime has no
Node `crypto`), and it fails closed.
