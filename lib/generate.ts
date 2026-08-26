import type { Job } from "./ashby"
import { UserError } from "./errors.ts"
import { log } from "./log.ts"
import type { Profile } from "./profile"

export const LIMIT = 300

/**
 * LinkedIn's 300 includes spaces, punctuation and line breaks.
 * Normalise CRLF -> LF first: a pasted \r\n is one line break, not two characters.
 * Spread, not `.length` — `.length` counts UTF-16 units, so an emoji would read as 2.
 */
export const countChars = (s: string) =>
  [...s.replace(/\r\n?/g, "\n").trim()].length
export const withinLimit = (s: string) => {
  const n = countChars(s)
  return n > 0 && n <= LIMIT
}

export type Draft = { message: string; evidence: string }

const SYSTEM = `You write the note attached to a LinkedIn connection request, sent by a recruiter at Arago - a Paris company designing analog and mixed-signal silicon for AI compute.

WHO IS READING THIS
A senior engineer who is not looking for a job. They get several of these a week and delete nearly all of them unread. They decide in about two seconds, from the first line alone. They are technical, and they can tell immediately whether someone read their profile or ran a template over it.

WHAT SUCCESS MEANS
They reply. Not "they are impressed" - they reply. That happens when the note proves a human read their work, names something real they would want to build, and asks for something so small that agreeing costs them nothing.

WHAT ACTUALLY WORKS (this is measured, not taste - follow it)
- The first sentence decides everything. Open with THEIR work: a specific project, chip, process node, or system taken from their profile. Never open with a greeting, a compliment, or who you are.
- Proof of relevance beats enthusiasm. One concrete detail they would recognise as their own work outperforms any amount of praise. Generic flattery reads as a bulk send and gets deleted.
- Small asks win. Soft, low-commitment closes ("Worth a quick chat?", "Open to hearing about it?") get roughly three times the replies of direct ones ("Can we schedule a call?"). A large ask triggers resistance; a tiny one costs nothing to accept.
- Respect that they are not looking. Keep the ask small, never imply urgency, never pressure, never flatter to soften a pitch.
- Give before asking. In two sentences that means one true, concrete thing about what they would actually build here - the real work, not an adjective about it.
- Brevity is not a constraint here, it is the tactic. Shorter messages get materially more replies. Every word not doing work costs you the answer.

SHAPE
Two short paragraphs with a blank line between them.
1. Their work, specifically. One sentence.
2. What we are building and why it connects to that, then the small ask. One or two sentences.

HARD RULES
- At most ${LIMIT} characters INCLUDING spaces and line breaks. Aim for 200-280.
- English.
- Build on exactly ONE specific detail from the profile: a named employer, technology, process node, or project. Copy that detail verbatim into "evidence".
- Use ONLY facts written in the profile and the job description. Never infer seniority, tenure, achievements, motivations, or interests that are not stated. A fabricated detail is worse than a generic message - this reader will catch it.
- First name only. No emojis. No exclamation marks.
- If the profile is too thin to personalise honestly, say so in "message" rather than inventing anything.

NEVER WRITE
- "I hope this finds you well", "I came across your profile", "I wanted you to be the first to know"
- "great opportunity", "exciting opportunity", "perfect fit", "passionate about", "rockstar"
- "maps onto", "aligns with", "what we need at", "reach out"
- Any praise not attached to a specific named thing they did.
- A restatement of the job description or a list of its requirements.
- A request for a 30-minute call, an interview, a CV, or their availability.

Match the rhythm and the restraint, never the wording.`

const schema = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: `The connection request, max ${LIMIT} characters.`,
    },
    evidence: {
      type: "string",
      description: "The profile detail used, quoted verbatim.",
    },
  },
  required: ["message", "evidence"],
  additionalProperties: false,
} as const

function userPrompt(profile: Profile, job: Job, previous: string[]) {
  const exp = profile.work_experience
    .map(
      (e) =>
        `- ${e.position}, ${e.company} (${e.duration})${e.description ? `: ${e.description}` : ""}`
    )
    .join("\n")
  return [
    `CANDIDATE PROFILE`,
    `Name: ${profile.name}`,
    `Headline: ${profile.headline}`,
    `Location: ${profile.location}`,
    `Experience:\n${exp}`,
    `Education: ${profile.education.map((e) => `${e.degree}, ${e.school}`).join("; ")}`,
    `Skills: ${profile.skills.join(", ")}`,
    ``,
    `OPEN ROLE: ${job.title}`,
    job.descriptionPlain.slice(0, 6000),
    previous.length
      ? `\nAlready sent to this recruiter and rejected — take a genuinely different angle, do not paraphrase:\n${previous.map((m) => `- ${m}`).join("\n")}`
      : ``,
  ].join("\n")
}

async function call(
  messages: { role: string; content: string }[]
): Promise<Draft> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.")

  // || not ?? — an unset-but-present `OPENROUTER_MODEL=` is "", which ?? happily passes through
  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5"
  log.debug("openrouter: request", { model, messages })

  const started = Date.now()
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: "connection_message", strict: true, schema },
      },
      reasoning: { effort: "low", exclude: true },
      // only route to endpoints that actually honour the schema, rather than degrading to prose
      provider: { require_parameters: true },
      max_tokens: 1000,
    }),
  })

  const ms = Date.now() - started

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    log.error("openrouter: request failed", {
      model,
      status: res.status,
      ms,
      body: text,
    })
    throw new Error(`OpenRouter ${res.status}: ${text}`)
  }

  const body = await res.json()
  // `served` is the endpoint OpenRouter actually routed to, which is not always `model` —
  // that plus `usage` is the whole cost/latency picture for the §5.1 model comparison.
  log.info("openrouter: completion", {
    model,
    served: body.model,
    provider: body.provider,
    ms,
    usage: body.usage,
    finish: body.choices?.[0]?.finish_reason,
  })

  const content = body.choices?.[0]?.message?.content
  if (!content) {
    log.error("openrouter: no content in response", { model, body })
    throw new Error("OpenRouter returned no content.")
  }
  return JSON.parse(content) as Draft
}

export async function generate(
  profile: Profile,
  job: Job,
  previous: string[] = []
): Promise<Draft> {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userPrompt(profile, job, previous) },
  ]

  log.info("generate: drafting", {
    candidate: profile.name,
    job: job.title,
    attemptsToBeat: previous.length,
  })

  const first = await call(messages)
  if (withinLimit(first.message)) {
    log.info("generate: accepted", {
      chars: countChars(first.message),
      retried: false,
    })
    log.debug("generate: draft", { draft: first })
    return first
  }

  // models cannot count characters — the limit is enforced here, never trusted to the prompt
  const over = countChars(first.message) - LIMIT
  // a retry rate creeping up is the prompt drifting long, not a one-off
  log.warn("generate: over the limit, retrying", {
    chars: countChars(first.message),
    over,
  })
  const second = await call([
    ...messages,
    { role: "assistant", content: JSON.stringify(first) },
    {
      role: "user",
      content: `That message is ${countChars(first.message)} characters — ${over} over the ${LIMIT} limit. Rewrite it shorter. Keep the same specific detail. Do not truncate mid-sentence.`,
    },
  ])
  if (withinLimit(second.message)) {
    log.info("generate: accepted", {
      chars: countChars(second.message),
      retried: true,
    })
    log.debug("generate: draft", { draft: second })
    return second
  }

  log.error("generate: still over the limit after the retry", {
    first: countChars(first.message),
    second: countChars(second.message),
  })
  throw new UserError(
    `Could not get the message under ${LIMIT} characters after two attempts. Try regenerating.`
  )
}
