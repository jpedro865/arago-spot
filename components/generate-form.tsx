"use client"

import { useState } from "react"
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react"

import type { Job } from "@/lib/ashby"
import { LIMIT, countChars, type Draft } from "@/lib/generate"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export function GenerateForm({ jobs }: { jobs: Job[] }) {
  const [profileUrl, setProfileUrl] = useState("")
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [message, setMessage] = useState("")
  const [history, setHistory] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * A draft belongs to one candidate and one role. Change either and it is stale — leaving it
   * on screen invites copying the previous candidate's message, evidence line and all.
   * Clearing `history` matters too: it is fed back as "already rejected", so it must not
   * follow you to a different person.
   */
  function clearDraft() {
    setDraft(null)
    setHistory([])
    setError(null)
  }

  async function run(previous: string[]) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrl, jobId, previous }),
      })
      // an expired session redirects to /login and answers HTML — .json() would throw
      // "Unexpected token '<'" and show that to the recruiter
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.message) {
        throw new Error(
          body?.error ??
            "Couldn't reach the generator. Check your connection and try again."
        )
      }
      setDraft(body)
      setMessage(body.message)
      setHistory([...previous, body.message])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.")
    } finally {
      setLoading(false)
    }
  }

  function copy() {
    // only claim it copied if it actually did — clipboard writes reject on an insecure origin
    navigator.clipboard.writeText(message).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => setError("Couldn't copy — select the message and copy it manually.")
    )
  }

  const count = countChars(message)

  return (
    <div className="grid gap-6">
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          run([])
        }}
      >
        <div className="grid min-w-0 gap-2">
          <label htmlFor="profile" className="text-sm font-medium">
            Candidate LinkedIn profile
          </label>
          <Input
            id="profile"
            type="url"
            required
            value={profileUrl}
            onChange={(e) => {
              setProfileUrl(e.target.value)
              clearDraft()
            }}
            placeholder="https://www.linkedin.com/in/..."
          />
        </div>

        <div className="grid min-w-0 gap-2">
          <label htmlFor="job" className="text-sm font-medium">
            Open role
          </label>
          <Select
            value={jobId}
            onValueChange={(v) => {
              setJobId(v)
              clearDraft()
            }}
          >
            <SelectTrigger
              id="job"
              className="w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
            >
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {jobId && (
            // Ashby posting URLs are always board + id — verified across the whole board
            <a
              href={`https://jobs.ashbyhq.com/arago/${jobId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
            >
              View this posting
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        <Button type="submit" size="lg" disabled={!profileUrl || loading}>
          {loading && <Loader2 className="animate-spin" />}
          {loading ? "Drafting…" : "Generate message"}
        </Button>
      </form>

      {error && (
        <p
          role="alert"
          className="min-w-0 text-sm break-words text-destructive"
        >
          {error}
        </p>
      )}

      {draft && (
        <div className="grid gap-2 border-t pt-6">
          <label htmlFor="message" className="text-sm font-medium">
            Connection message
          </label>
          <Textarea
            id="message"
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center justify-between gap-4">
            <p
              aria-live="polite"
              className={
                count > LIMIT
                  ? "text-xs text-destructive tabular-nums"
                  : "text-xs text-muted-foreground tabular-nums"
              }
            >
              {count}/{LIMIT}
              {count > LIMIT && " — LinkedIn will reject this"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => run(history)}
              >
                {loading && <Loader2 className="animate-spin" />}
                Regenerate
              </Button>
              <Button type="button" size="sm" onClick={copy}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Based on: <span className="text-foreground">{draft.evidence}</span>
          </p>
        </div>
      )}
    </div>
  )
}
