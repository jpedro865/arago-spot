import { UserError } from "./errors.ts"
import { log } from "./log.ts"
import type { Profile } from "./profile"

const { UNIPILE_DSN, UNIPILE_API_KEY, UNIPILE_ACCOUNT_ID } = process.env

/** `https://fr.linkedin.com/in/marta-oyelaran-1a2b/?trk=x` -> `marta-oyelaran-1a2b` */
export function linkedInUrlToIdentifier(url: string): string {
  // only `/in/` is a profile — company, school and post URLs deliberately fail here
  const slug = url
    .trim()
    .match(/linkedin\.com\/(?:[\w-]+\/)?in\/([^/?#\s]+)/i)?.[1]
  if (!slug)
    throw new UserError(
      "Not a LinkedIn profile URL — expected linkedin.com/in/…"
    )
  // browsers percent-encode non-ASCII slugs on copy; Unipile wants the decoded public identifier
  try {
    return decodeURIComponent(slug)
  } catch {
    return slug
  }
}

type Experience = { start?: string; end?: string; current?: boolean }

type UnipileProfile = {
  first_name?: string
  last_name?: string
  headline?: string
  location?: string
  work_experience?: (Experience & {
    position?: string
    company?: string
    description?: string
  })[]
  education?: { school?: string; degree?: string; field_of_study?: string }[]
  skills?: { name?: string }[]
}

// Unipile gives start/end, the prompt wants one string
const period = (e: Experience) =>
  [e.start, e.end ?? (e.current ? "Present" : "")].filter(Boolean).join(" — ")

/** Every field is optional upstream: a section we don't get back must degrade, not throw. */
export function toProfile(u: UnipileProfile): Profile {
  return {
    name: [u.first_name, u.last_name].filter(Boolean).join(" "),
    headline: u.headline ?? "",
    location: u.location ?? "",
    work_experience: (u.work_experience ?? []).map((e) => ({
      position: e.position ?? "",
      company: e.company ?? "",
      duration: period(e),
      description: e.description,
    })),
    education: (u.education ?? []).map((e) => ({
      school: e.school ?? "",
      degree: [e.degree, e.field_of_study].filter(Boolean).join(", "),
    })),
    skills: (u.skills ?? []).map((s) => s.name ?? "").filter(Boolean),
  }
}

export async function fetchProfile(profileUrl: string): Promise<Profile> {
  if (!UNIPILE_DSN || !UNIPILE_API_KEY || !UNIPILE_ACCOUNT_ID) {
    throw new Error(
      "LinkedIn lookup is not configured — set UNIPILE_DSN, UNIPILE_API_KEY and UNIPILE_ACCOUNT_ID."
    )
  }
  const identifier = linkedInUrlToIdentifier(profileUrl)
  const params = new URLSearchParams({ account_id: UNIPILE_ACCOUNT_ID })
  // only the sections the prompt grounds on — keeps payload and token count down
  for (const s of ["experience", "education", "skills"])
    params.append("linkedin_sections", s)

  const host = UNIPILE_DSN.replace(/^https?:\/\//, "")
  const started = Date.now()
  const res = await fetch(
    `https://${host}/api/v1/users/${encodeURIComponent(identifier)}?${params}`,
    {
      headers: { "X-API-KEY": UNIPILE_API_KEY, accept: "application/json" },
      // Regenerate re-posts the same URL, so the Data Cache answers it: one LinkedIn call
      // per candidate however many messages we draft (DESIGN §6, §9 rate-limit risk).
      next: { revalidate: 3600 },
    }
  )

  const ms = Date.now() - started

  if (res.status === 404) {
    log.warn("unipile: profile not reachable", { identifier, ms })
    throw new UserError(
      "That profile isn't reachable from the connected LinkedIn account. Check the URL, or try another candidate."
    )
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200)
    log.error("unipile: request failed", {
      identifier,
      status: res.status,
      ms,
      body,
    })
    throw new Error(`Unipile ${res.status}: ${body}`)
  }

  const profile = toProfile(await res.json())
  // `ms` separates a live LinkedIn call (hundreds of ms) from a Data Cache hit (~0) — it is
  // how you confirm Regenerate is not burning the rate limit. The counts diagnose a thin
  // profile before you go hunting for a prompt bug.
  log.info("unipile: profile fetched", {
    identifier,
    ms,
    name: profile.name,
    experience: profile.work_experience.length,
    education: profile.education.length,
    skills: profile.skills.length,
  })
  log.debug("unipile: profile", { profile })
  return profile
}
