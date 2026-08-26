import { log } from "./log.ts"

const { BOARD_URL } = process.env

export type Job = {
  id: string
  title: string
  descriptionPlain: string
}

// `jobUrl` is always board + id, so the id *is* the trailing UUID — verified across the whole board
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * The dropdown sends a bare id; someone arriving from the job board pastes the posting URL.
 * A bare id is itself a UUID, so one match handles both and neither path needs its own branch.
 */
export function resolveJob(jobs: Job[], input: string): Job | undefined {
  const id = input.match(UUID)?.[0].toLowerCase()
  return id ? jobs.find((j) => j.id.toLowerCase() === id) : undefined
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
