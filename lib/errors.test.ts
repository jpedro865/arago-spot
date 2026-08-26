import assert from "node:assert/strict"
import { test } from "node:test"

import { UserError, publicMessage } from "./errors.ts"

test("a UserError's message reaches the recruiter", () => {
  assert.equal(publicMessage(new UserError("Check the URL.")), "Check the URL.")
})

test("internal detail never does", () => {
  for (const e of [
    new Error(`OpenRouter 401: {"error":{"message":"No auth credentials"}}`),
    new Error("Set UNIPILE_DSN, UNIPILE_API_KEY and UNIPILE_ACCOUNT_ID."),
    "a bare string throw",
    undefined,
  ]) {
    const shown = publicMessage(e)
    assert.equal(shown, "Something went wrong drafting the message. Try again.")
    assert.doesNotMatch(shown, /UNIPILE|OPENROUTER|\d{3}:/)
  }
})
