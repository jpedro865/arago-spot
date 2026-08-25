import { NextResponse, type NextRequest } from "next/server"

import { COOKIE, isValidToken } from "@/lib/auth"

export async function proxy(req: NextRequest) {
  if (process.env.NODE_ENV === "development") return NextResponse.next()

  const { PASSWORD, PASSWORD_SECRET } = process.env
  // fail closed — a missing env var must never mean "no gate"
  if (!PASSWORD || !PASSWORD_SECRET) {
    return new NextResponse("Auth is not configured.", { status: 503 })
  }

  if (await isValidToken(req.cookies.get(COOKIE)?.value, PASSWORD_SECRET)) {
    return NextResponse.next()
  }
  return NextResponse.redirect(new URL("/login", req.url))
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
}