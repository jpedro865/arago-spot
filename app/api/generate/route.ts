import { getJobs } from "@/lib/ashby"
import { generate } from "@/lib/generate"
import { FIXTURE } from "@/lib/profile"

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.jobId !== "string") {
    return Response.json({ error: "jobId is required." }, { status: 400 })
  }
  const previous: string[] = Array.isArray(body.previous)
    ? body.previous.filter((m: unknown) => typeof m === "string").slice(-3)
    : []

  const job = (await getJobs()).find((j) => j.id === body.jobId)
  if (!job) return Response.json({ error: "Unknown role." }, { status: 400 })

  try {
    // ponytail: fixture profile until Unipile lands (phase 3)
    return Response.json(await generate(FIXTURE, job, previous))
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed."
    console.error("[generate]", message)
    return Response.json({ error: message }, { status: 502 })
  }
}
