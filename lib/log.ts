const LEVELS = ["debug", "info", "warn", "error"] as const
type Level = (typeof LEVELS)[number]

// LOG_LEVEL=debug to see request bodies and timings; unset means debug locally, info in prod.
// An unrecognised value logs everything — the safe way to be wrong about a log setting.
const configured =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === "development" ? "debug" : "info")
const min = LEVELS.indexOf(configured as Level)

// JSON.stringify turns an Error into {} — the one value you actually needed to see
const replacer = (_: string, v: unknown) =>
  v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v

function make(level: Level) {
  const enabled = LEVELS.indexOf(level) >= min
  return (msg: string, data?: Record<string, unknown>) => {
    if (!enabled) return
    // one line per event: Vercel's log viewer treats each line as a separate entry
    console[level](
      `${level.toUpperCase()} ${msg}${data ? ` ${JSON.stringify(data, replacer)}` : ""}`
    )
  }
}

export const log = {
  debug: make("debug"),
  info: make("info"),
  warn: make("warn"),
  error: make("error"),
}
