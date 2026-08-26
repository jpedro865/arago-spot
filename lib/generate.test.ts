import assert from "node:assert/strict"
import { test } from "node:test"

import { UserError } from "./errors.ts"
import {
  LIMIT,
  MAX_PDF_BYTES,
  checkPdf,
  countChars,
  withinLimit,
} from "./generate.ts"

test("the limit boundary is exact", () => {
  assert.equal(withinLimit("x".repeat(LIMIT)), true, "300 must be allowed")
  assert.equal(
    withinLimit("x".repeat(LIMIT + 1)),
    false,
    "301 must be rejected"
  )
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
  assert.equal(
    withinLimit("x".repeat(LIMIT - 1) + "\n" + "y"),
    false,
    "break must consume budget"
  )
})

test("astral characters count once, not twice", () => {
  // "🙂".length === 2 in UTF-16; LinkedIn counts it as one character
  assert.equal(countChars("🙂"), 1)
  assert.equal(withinLimit("🙂".repeat(LIMIT)), true)
  assert.equal(withinLimit("🙂".repeat(LIMIT + 1)), false)
})

test("an uploaded CV is checked before it is forwarded", () => {
  const pdf = (n: number) => "data:application/pdf;base64," + "A".repeat(n)
  assert.doesNotThrow(() => checkPdf(pdf(1000)))
  // base64 is 4 chars per 3 bytes, so the limit is on the encoded length, not the raw one
  assert.doesNotThrow(() => checkPdf(pdf(Math.ceil(MAX_PDF_BYTES / 3) * 4)))
  assert.throws(() => checkPdf(pdf(MAX_PDF_BYTES * 2)), UserError, "oversized")
  assert.throws(
    () => checkPdf("data:image/png;base64,AAAA"),
    UserError,
    "not a PDF"
  )
  assert.throws(
    () => checkPdf("https://x.test/cv.pdf"),
    UserError,
    "not a data URL"
  )
})
