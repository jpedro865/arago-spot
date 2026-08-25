const { BOARD } = process.env

export type Job = {
  id: string
  title: string
  descriptionPlain: string
}

export async function getJobs(): Promise<Job[]> {
  if (!BOARD) throw new Error("Missing BOARD env var")
  const res = await fetch(BOARD, { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`Ashby ${res.status}`)
  const { jobs } = await res.json()
  return jobs
    .filter((j: { isListed: boolean }) => j.isListed)
    .map(({ id, title, descriptionPlain }: Job) => ({ id, title, descriptionPlain }))
}
