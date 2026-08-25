const { BOARD_URL } = process.env

export type Job = {
  id: string
  title: string
  descriptionPlain: string
}

export async function getJobs(): Promise<Job[]> {
  if (!BOARD_URL) throw new Error("Missing BOARD_URL env var")
  const res = await fetch(BOARD_URL, { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`Ashby ${res.status}`)
  const { jobs } = await res.json()
  return jobs
    .filter((j: { isListed: boolean }) => j.isListed)
    .map(({ id, title, descriptionPlain }: Job) => ({ id, title, descriptionPlain }))
}
