import assert from "node:assert/strict"
import { test } from "node:test"

import { LIMIT, countChars, withinLimit } from "./generate.ts"

test("the limit boundary is exact", () => {
  assert.equal(withinLimit("x".repeat(LIMIT)), true, "300 must be allowed")
  assert.equal(withinLimit("x".repeat(LIMIT + 1)), false, "301 must be rejected")
})

test("empty or whitespace-only drafts are not valid", () => {
  assert.equal(withinLimit(""), false)
  assert.equal(withinLimit("   \n "), false)
})

test("surrounding whitespace does not count toward the limit", () => {
  assert.equal(withinLimit(`  ${"x".repeat(LIMIT)}  `), true)
})

test("line breaks count as one character each, CRLF included", () => {
  // LinkedIn counts line breaks toward the 300; a pasted CRLF is one break, not two
  assert.equal(countChars("a\nb"), 3)
  assert.equal(countChars("a\r\nb"), 3, "CRLF counted twice")
  assert.equal(countChars("a\rb"), 3, "lone CR counted wrong")
  assert.equal(countChars("a\n\nb"), 4, "blank line is two breaks")
  assert.equal(withinLimit("x".repeat(LIMIT - 1) + "\n" + "y"), false, "break must consume budget")
})

test("astral characters count once, not twice", () => {
  // "🙂".length === 2 in UTF-16; LinkedIn counts it as one character
  assert.equal(countChars("🙂"), 1)
  assert.equal(withinLimit("🙂".repeat(LIMIT)), true)
  assert.equal(withinLimit("🙂".repeat(LIMIT + 1)), false)
})
