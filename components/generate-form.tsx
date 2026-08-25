"use client"

import { useState } from "react"
import { ExternalLink } from "lucide-react"

import type { Job } from "@/lib/ashby"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function GenerateForm({ jobs }: { jobs: Job[] }) {
  const [profileUrl, setProfileUrl] = useState("")
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "")

  return (
    // ponytail: no action yet — step 2 wires this to POST /api/generate
    <form className="grid gap-5" onSubmit={(e) => e.preventDefault()}>
      <div className="grid min-w-0 gap-2">
        <label htmlFor="profile" className="text-sm font-medium">
          Candidate LinkedIn profile
        </label>
        <Input
          id="profile"
          type="url"
          required
          value={profileUrl}
          onChange={(e) => setProfileUrl(e.target.value)}
          placeholder="https://www.linkedin.com/in/..."
        />
      </div>

      <div className="grid min-w-0 gap-2">
        <label htmlFor="job" className="text-sm font-medium">
          Open role
        </label>
        <Select value={jobId} onValueChange={setJobId}>
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
            className="text-muted-foreground hover:text-primary inline-flex w-fit items-center gap-1 text-xs underline-offset-4 transition-colors hover:underline"
          >
            View this posting
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      <Button type="submit" size="lg" disabled={!profileUrl}>
        Generate message
      </Button>
    </form>
  )
}
