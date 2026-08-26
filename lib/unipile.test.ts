import assert from "node:assert/strict"
import { test } from "node:test"

import { linkedInUrlToIdentifier, toProfile } from "./unipile.ts"

test("the identifier is the /in/ segment, whatever decoration the paste carries", () => {
  const id = "marta-oyelaran-1a2b3c"
  for (const url of [
    `https://www.linkedin.com/in/${id}`,
    `https://www.linkedin.com/in/${id}/`,
    `https://linkedin.com/in/${id}/?originalSubdomain=de`,
    `https://fr.linkedin.com/in/${id}`, // locale subdomain
    `https://www.linkedin.com/mwlite/in/${id}`, // mobile web
    `  https://www.linkedin.com/in/${id}/#experience  `,
  ]) {
    assert.equal(linkedInUrlToIdentifier(url), id, url)
  }
})

test("non-ASCII slugs arrive percent-encoded and must be decoded", () => {
  assert.equal(
    linkedInUrlToIdentifier(
      "https://www.linkedin.com/in/andr%C3%A9-m%C3%BCller"
    ),
    "andré-müller"
  )
})

test("anything that is not a profile URL is rejected, not guessed at", () => {
  for (const url of [
    "https://www.linkedin.com/company/arago",
    "https://www.linkedin.com/in/", // no slug
    "https://example.com/in/someone", // not LinkedIn
    "marta-oyelaran",
    "",
  ]) {
    assert.throws(
      () => linkedInUrlToIdentifier(url),
      /LinkedIn profile URL/,
      url
    )
  }
})

test("Unipile's shape is mapped onto the prompt's shape", () => {
  const profile = toProfile({
    first_name: "Marta",
    last_name: "Oyelaran",
    headline: "Analog & Mixed-Signal IC Design Engineer",
    location: "Munich, Bavaria, Germany",
    work_experience: [
      {
        position: "Senior Analog Design Engineer",
        company: "Intel",
        start: "2019",
        current: true,
        description: "112G PAM4 receiver",
      },
      {
        position: "Analog Design Engineer",
        company: "Infineon",
        start: "2015",
        end: "2019",
      },
    ],
    education: [
      {
        school: "TU München",
        degree: "MSc",
        field_of_study: "Microelectronics",
      },
    ],
    skills: [{ name: "Cadence Virtuoso" }, { name: "SerDes" }],
  })

  assert.equal(profile.name, "Marta Oyelaran")
  assert.equal(
    profile.work_experience[0].duration,
    "2019 — Present",
    "an open-ended role reads as Present"
  )
  assert.equal(profile.work_experience[1].duration, "2015 — 2019")
  assert.equal(profile.education[0].degree, "MSc, Microelectronics")
  assert.deepEqual(
    profile.skills,
    ["Cadence Virtuoso", "SerDes"],
    "skills are objects upstream, strings here"
  )
})

test("a profile missing every optional section degrades instead of throwing", () => {
  const profile = toProfile({ first_name: "Marta" })
  assert.deepEqual(profile.work_experience, [])
  assert.deepEqual(profile.skills, [])
  assert.equal(profile.headline, "")
})
