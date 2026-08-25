// Web Crypto, not node:crypto — middleware runs on the Edge runtime.
const enc = new TextEncoder()

export const COOKIE = "arago_session"
export const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

const b64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const unb64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0)
  )

/** Token is `<expiry>.<hmac(expiry)>` — the signature is what makes it unforgeable. */
export async function issueToken(secret: string) {
  const exp = String(Date.now() + MAX_AGE * 1000)
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(exp))
  return `${exp}.${b64url(sig)}`
}

export async function isValidToken(token: string | undefined, secret: string) {
  if (!token) return false
  const [exp, sig] = token.split(".")
  if (!exp || !sig) return false
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      unb64url(sig),
      enc.encode(exp)
    )
    return ok && Number(exp) > Date.now()
  } catch {
    return false // malformed base64 or bad length
  }
}

const sha256 = async (s: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))

/** Constant-time: digests are always equal length, so this never short-circuits. */
export async function passwordMatches(input: string, expected: string) {
  const [a, b] = await Promise.all([sha256(input), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
