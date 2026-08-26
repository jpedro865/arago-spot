import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveJob, type Job } from "./ashby.ts"

const jobs: Job[] = [
  {
    id: "25cfdecb-8269-489f-90a6-d7b18cc5cf8c",
    title: "Senior RF/Analog Design Engineer",
    descriptionPlain: "…",
  },
  {
    id: "9f1e0a7b-1111-4222-8333-444455556666",
    title: "Digital Verification Engineer",
    descriptionPlain: "…",
  },
]

test("the dropdown's bare id resolves", () => {
  assert.equal(resolveJob(jobs, jobs[0].id)?.title, jobs[0].title)
})

test("a pasted Ashby posting URL resolves to the same job", () => {
  for (const input of [
    "https://jobs.ashbyhq.com/arago/25cfdecb-8269-489f-90a6-d7b18cc5cf8c",
    "https://jobs.ashbyhq.com/arago/25cfdecb-8269-489f-90a6-d7b18cc5cf8c/application",
    "https://jobs.ashbyhq.com/arago/25cfdecb-8269-489f-90a6-d7b18cc5cf8c?utm_source=li",
    "  https://jobs.ashbyhq.com/arago/25CFDECB-8269-489F-90A6-D7B18CC5CF8C  ",
  ]) {
    assert.equal(resolveJob(jobs, input)?.id, jobs[0].id, input)
  }
})

test("a well-formed id for a job that is not on the board is not found", () => {
  assert.equal(
    resolveJob(jobs, "00000000-0000-4000-8000-000000000000"),
    undefined
  )
})

test("input carrying no id is not guessed at", () => {
  for (const input of [
    "https://jobs.ashbyhq.com/arago",
    "Senior RF/Analog Design Engineer",
    "",
  ]) {
    assert.equal(resolveJob(jobs, input), undefined, input)
  }
})
