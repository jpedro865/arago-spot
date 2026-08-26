import { getJobs, resolveJob } from "@/lib/ashby"
import { UserError, publicMessage } from "@/lib/errors"
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

  try {
    // inside the try: an Ashby blip must still answer JSON, or the client parses an HTML 500
    // accepts the dropdown's id or a pasted Ashby posting URL
    const job = resolveJob(await getJobs(), body.jobId)
    if (!job) {
      log.warn("generate: unknown job", { jobId: body.jobId })
      throw new UserError("Unknown role — pick one from the list.")
    }

    const profile = await fetchProfile(body.profileUrl)
    const draft = await generate(profile, job, previous)
    log.info("generate: ok", { ms: Date.now() - started })
    return Response.json(draft)
  } catch (e) {
    log.error("generate: failed", {
      ms: Date.now() - started,
      profileUrl: body.profileUrl,
      err: e,
    })
    // 400 for "you gave us bad input", 502 for "an upstream let us down"
    return Response.json(
      { error: publicMessage(e) },
      { status: e instanceof UserError ? 400 : 502 }
    )
  }
}
