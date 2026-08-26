/** What the prompt grounds on. `lib/unipile.ts` maps `GET /users/{id}` onto this. */
export type Profile = {
  name: string
  headline: string
  location: string
  work_experience: {
    position: string
    company: string
    duration: string
    description?: string
  }[]
  education: { school: string; degree: string }[]
  skills: string[]
}
