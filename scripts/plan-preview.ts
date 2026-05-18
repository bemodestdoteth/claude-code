#!/usr/bin/env bun

import { existsSync, mkdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'

type Options = {
  host: string
  port: number
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 0
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}

function usage(): string {
  return `Usage: bun run plan:preview -- [options]

Serve HTML plans from .claude/plans/<project>/ without directory listing.

Options:
  --host <host>       Bind address (default: ${DEFAULT_HOST})
  --port <port>       Port number, or 0 for an available port (default: ${DEFAULT_PORT})
  --help              Show this help

Examples:
  bun run plan:preview
  bun run plan:preview -- --host <tailscale-ip>
  bun run plan:preview -- --host <tailscale-ip> --port 4173
`
}

function parseArgs(args: string[]): Options | 'help' {
  const options: Options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === '--help' || arg === '-h') return 'help'

    if (arg === '--host') {
      const host = args[++index]
      if (!host) throw new Error('--host requires a value')
      options.host = host
      continue
    }

    if (arg === '--port') {
      const rawPort = args[++index]
      if (!rawPort) throw new Error('--port requires a value')
      const port = Number(rawPort)
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('--port must be an integer between 0 and 65535')
      }
      options.port = port
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value) && !value.includes('\0')
}

function notFound(): Response {
  return new Response('Not found\n', { status: 404 })
}

function methodNotAllowed(): Response {
  return new Response('Method not allowed\n', {
    status: 405,
    headers: { Allow: 'GET, HEAD' },
  })
}

function rootPage(host: string, port: number): Response {
  const exampleProject = '<project>'
  const examplePlan = '<plan>.html'
  const displayHost = host === '0.0.0.0' ? '&lt;host&gt;' : host
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Claude Code Plan Preview</title>
</head>
<body>
  <h1>Claude Code Plan Preview</h1>
  <p>This server serves HTML plans from <code>.claude/plans/&lt;project&gt;/</code>.</p>
  <p>No directory listing is available.</p>
  <p>Open a plan at:</p>
  <pre>http://${displayHost}:${port}/plan/${exampleProject}/${examplePlan}</pre>
</body>
</html>
`
  return new Response(body, { headers: HTML_HEADERS })
}

function getPlanPath(url: URL, plansRoot: string): string | null {
  const parts = url.pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part)
    } catch {
      return ''
    }
  })

  if (parts.length !== 3 || parts[0] !== 'plan') return null

  const [, project, plan] = parts
  if (!isSafeSegment(project) || !isSafeSegment(plan)) return null
  if (!plan.endsWith('.html')) return null

  const filePath = resolve(plansRoot, project, plan)
  if (!filePath.startsWith(plansRoot + sep)) return null

  return filePath
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed === 'help') {
    process.stdout.write(usage())
    return
  }

  const { host, port } = parsed
  const plansRoot = resolve(process.cwd(), '.claude/plans')
  mkdirSync(plansRoot, { recursive: true })

  if (host === '0.0.0.0') {
    console.warn('Warning: binding to 0.0.0.0 exposes plan previews on all network interfaces.')
  }

  try {
    const server = Bun.serve({
      hostname: host,
      port,
      fetch(request) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return methodNotAllowed()
        }

        const url = new URL(request.url)
        if (url.pathname === '/') {
          const response = rootPage(host, server.port)
          return request.method === 'HEAD' ? new Response(null, response) : response
        }

        const filePath = getPlanPath(url, plansRoot)
        if (!filePath || !existsSync(filePath)) return notFound()

        const file = Bun.file(filePath)
        const response = new Response(request.method === 'HEAD' ? null : file, {
          headers: HTML_HEADERS,
        })
        return response
      },
    })

    const displayHost = host === '0.0.0.0' ? '<host>' : host
    console.log('Plan preview server running')
    console.log(`Root: ${plansRoot}`)
    console.log(`Host: ${host}`)
    console.log(`Port: ${server.port}`)
    console.log(`URL: http://${displayHost}:${server.port}/`)
    console.log(`Plan URL pattern: http://${displayHost}:${server.port}/plan/<project>/<plan>.html`)
  } catch (error) {
    if (port !== 0) {
      console.error(`Port ${port} is unavailable. Use --port 0 for automatic port selection.`)
    }
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
