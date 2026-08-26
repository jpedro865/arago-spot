import { getJobs } from "@/lib/ashby"
import { generate } from "@/lib/generate"
import { log } from "@/lib/log"
import { fetchProfile } from "@/lib/unipile"

export async function POST(req: Request) {
  const started = Date.now()
  const body = await req.json().catch(() => null)
  if (
    !body ||
    typeof body.profileUrl !== "string" ||
    typeof body.jobId !== "string"
  ) {
    log.warn("generate: bad request", { body })
    return Response.json(
      { error: "profileUrl and jobId are required." },
      { status: 400 }
    )
  }
  const previous: string[] = Array.isArray(body.previous)
    ? body.previous.filter((m: unknown) => typeof m === "string").slice(-3)
    : []

  // `previous` is non-empty only on Regenerate — the two paths are worth telling apart in the logs
  log.info("generate: request", {
    profileUrl: body.profileUrl,
    jobId: body.jobId,
    regenerate: previous.length > 0,
  })

  const job = (await getJobs()).find((j) => j.id === body.jobId)
  if (!job) {
    log.warn("generate: unknown job", { jobId: body.jobId })
    return Response.json({ error: "Unknown role." }, { status: 400 })
  }

  try {
    const profile = await fetchProfile(body.profileUrl)
    const draft = await generate(profile, job, previous)
    log.info("generate: ok", { ms: Date.now() - started })
    return Response.json(draft)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed."
    log.error("generate: failed", {
      ms: Date.now() - started,
      profileUrl: body.profileUrl,
      err: e,
    })
    return Response.json({ error: message }, { status: 502 })
  }
}
