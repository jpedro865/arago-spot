import { log } from "./log.ts"

const { BOARD_URL } = process.env

export type Job = {
  id: string
  title: string
  descriptionPlain: string
}

export async function getJobs(): Promise<Job[]> {
  if (!BOARD_URL) throw new Error("Missing BOARD_URL env var")
  const started = Date.now()
  const res = await fetch(BOARD_URL, { next: { revalidate: 3600 } })
  if (!res.ok) {
    log.error("ashby: request failed", { status: res.status })
    throw new Error(`Ashby ${res.status}`)
  }
  const { jobs } = await res.json()
  const listed = jobs
    .filter((j: { isListed: boolean }) => j.isListed)
    .map(({ id, title, descriptionPlain }: Job) => ({
      id,
      title,
      descriptionPlain,
    }))
  log.debug("ashby: board loaded", {
    listed: listed.length,
    of: jobs.length,
    ms: Date.now() - started,
  })
  return listed
}
