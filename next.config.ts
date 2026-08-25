import type { NextConfig } from "next"

// a stray ~/package-lock.json makes Turbopack infer the wrong workspace root
const nextConfig: NextConfig = { turbopack: { root: import.meta.dirname } }

export default nextConfig
