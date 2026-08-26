import { getJobs, resolveJob } from "@/lib/ashby"
import { UserError, publicMessage } from "@/lib/errors"
import { type Candidate, checkPdf, generate } from "@/lib/generate"
import { log } from "@/lib/log"
import { fetchProfile } from "@/lib/unipile"

export async function POST(req: Request) {
  const started = Date.now()
  const body = await req.json().catch(() => null)
  // the CV arrives as a `data:application/pdf;base64,…` URL — never logged, it is ~1 MB of it
  const pdf: string | null = typeof body?.pdf === "string" ? body.pdf : null
  if (
    !body ||
    typeof body.jobId !== "string" ||
    (!pdf && typeof body.profileUrl !== "string")
  ) {
    log.warn("generate: bad request", { jobId: body?.jobId, pdf: !!pdf })
    return Response.json(
      {
        error: "A LinkedIn profile URL or a PDF CV, and a jobId, are required.",
      },
      { status: 400 }
    )
  }
  const previous: string[] = Array.isArray(body.previous)
    ? body.previous.filter((m: unknown) => typeof m === "string").slice(-3)
    : []

  // `previous` is non-empty only on Regenerate — the two paths are worth telling apart in the logs
  log.info("generate: request", {
    source: pdf ? "pdf" : "linkedin",
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

    if (pdf) checkPdf(pdf)
    // an uploaded CV wins over the URL: it is only ever offered after the URL path failed
    const candidate: Candidate = pdf
      ? { pdf }
      : await fetchProfile(body.profileUrl)
    const draft = await generate(candidate, job, previous)
    log.info("generate: ok", { ms: Date.now() - started })
    return Response.json(draft)
  } catch (e) {
    log.error("generate: failed", {
      ms: Date.now() - started,
      source: pdf ? "pdf" : "linkedin",
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
