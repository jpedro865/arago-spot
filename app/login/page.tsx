import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { COOKIE, MAX_AGE, issueToken, passwordMatches } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  // dev has no gate, so there is nothing to log into
  if (process.env.NODE_ENV === "development") redirect("/")

  const { error } = await searchParams

  async function login(formData: FormData) {
    "use server"
    const { PASSWORD, PASSWORD_SECRET } = process.env
    if (!PASSWORD || !PASSWORD_SECRET) throw new Error("Auth is not configured.")

    if (!(await passwordMatches(String(formData.get("password") ?? ""), PASSWORD))) {
      redirect("/login?error=1")
    }

    ;(await cookies()).set(COOKIE, await issueToken(PASSWORD_SECRET), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    })
    redirect("/")
  }

  return (
    <main className="relative isolate mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-8 px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full opacity-15 blur-3xl dark:opacity-25"
        style={{ background: "radial-gradient(circle, #3F00FF, transparent 65%)" }}
      />

      <div>
        <p className="text-2xl font-semibold tracking-tight text-primary">arago</p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">
          Connection message generator
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          This preview is password protected.
        </p>
      </div>

      <form action={login} className="grid min-w-0 gap-3">
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoFocus
          required
          autoComplete="current-password"
          placeholder="Password"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "password-error" : undefined}
        />
        {error && (
          <p id="password-error" role="alert" className="text-destructive text-sm">
            Incorrect password.
          </p>
        )}
        <Button type="submit" size="lg">
          Continue
        </Button>
      </form>
    </main>
  )
}
