import assert from "node:assert/strict"
import { test } from "node:test"

import { isValidToken, issueToken, passwordMatches } from "./auth.ts"

const SECRET = "s3cret-signing-key"

test("a freshly issued token verifies", async () => {
  assert.equal(await isValidToken(await issueToken(SECRET), SECRET), true)
})

test("a token signed with another secret is rejected", async () => {
  assert.equal(await isValidToken(await issueToken("other"), SECRET), false)
})

test("tampering with the expiry invalidates the signature", async () => {
  const [, sig] = (await issueToken(SECRET)).split(".")
  const forged = `${Date.now() + 10 ** 9}.${sig}`
  assert.equal(await isValidToken(forged, SECRET), false)
})

test("an expired token is rejected even though it is correctly signed", async () => {
  const exp = String(Date.now() - 1000)
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(exp))
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  assert.equal(await isValidToken(`${exp}.${b64}`, SECRET), false)
})

test("malformed tokens are rejected, not thrown", async () => {
  for (const bad of [undefined, "", "nodot", "a.b", "123.!!!not-base64!!!"]) {
    assert.equal(await isValidToken(bad, SECRET), false, `accepted: ${bad}`)
  }
})

test("password comparison accepts only an exact match", async () => {
  assert.equal(await passwordMatches("hunter2", "hunter2"), true)
  assert.equal(await passwordMatches("hunter3", "hunter2"), false)
  assert.equal(await passwordMatches("hunter", "hunter2"), false, "prefix accepted")
  assert.equal(await passwordMatches("", "hunter2"), false)
})
