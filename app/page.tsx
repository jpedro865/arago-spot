import { getJobs } from "@/lib/ashby"
import { GenerateForm } from "@/components/generate-form"
import { ThemeToggle } from "@/components/theme-toggle"

export default async function Page() {
  const jobs = await getJobs()

  return (
    <main className="relative isolate mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-8 px-6 py-12">
      {/* the Arago spot: brand glow, decorative only */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full opacity-15 blur-3xl dark:opacity-25"
        style={{
          background: "radial-gradient(circle, #3F00FF, transparent 65%)",
        }}
      />

      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-primary">
            arago spot
          </p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">
            Connection message generator
          </h1>
          <p className="mt-1 text-sm text-balance text-muted-foreground">
            Draft a personalised LinkedIn request, grounded in the
            candidate&apos;s profile and the role.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <GenerateForm jobs={jobs} />
      </div>
    </main>
  )
}
