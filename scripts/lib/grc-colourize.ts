import { styledCharsFromTokens, tokenize } from '@alcalzone/ansi-tokenize'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

type StyledChar = ReturnType<typeof styledCharsFromTokens>[number]

const configRoot = resolve(import.meta.dir, '../grc')
const markerPattern = /<pre\b([^>]*)\bdata-grc-config="([^"]+)"([^>]*)>([\s\S]*?)<\/pre>/g

const sgrClassMap: Record<string, string> = {
  '1': 'ansi-bold',
  '2': 'ansi-dim',
  '3': 'ansi-italic',
  '4': 'ansi-underline',
  '30': 'ansi-fg-black',
  '31': 'ansi-fg-red',
  '32': 'ansi-fg-green',
  '33': 'ansi-fg-yellow',
  '34': 'ansi-fg-blue',
  '35': 'ansi-fg-magenta',
  '36': 'ansi-fg-cyan',
  '37': 'ansi-fg-white',
  '90': 'ansi-fg-bright-black',
  '91': 'ansi-fg-bright-red',
  '92': 'ansi-fg-bright-green',
  '93': 'ansi-fg-bright-yellow',
  '94': 'ansi-fg-bright-blue',
  '95': 'ansi-fg-bright-magenta',
  '96': 'ansi-fg-bright-cyan',
  '97': 'ansi-fg-bright-white',
}

export type ColourizePlanHtmlOptions = {
  html: string
  cwd?: string
}

export async function colourizeMarkedGrcBlocks({ html, cwd = process.cwd() }: ColourizePlanHtmlOptions): Promise<string> {
  const matches = [...html.matchAll(markerPattern)]
  if (matches.length === 0) return html

  let output = ''
  let lastIndex = 0

  for (const match of matches) {
    const [raw, beforeConfig, configName, afterConfig, body] = match
    const start = match.index ?? 0
    const configPath = resolveConfig(configName)
    const plainText = decodeHtmlText(body)
    const ansi = await runGrcat(configPath, plainText, cwd)
    const coloured = ansiToHtmlSpans(ansi)

    output += html.slice(lastIndex, start)
    output += `<pre${beforeConfig}data-grc-config="${escapeAttribute(configName)}"${afterConfig}>${coloured}</pre>`
    lastIndex = start + raw.length
  }

  output += html.slice(lastIndex)
  return output
}

function resolveConfig(configName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(configName)) {
    throw new Error(`Invalid GRC config name: ${configName}`)
  }

  const configPath = resolve(configRoot, configName)
  if (!configPath.startsWith(`${configRoot}/`) || !existsSync(configPath)) {
    throw new Error(`Missing GRC config for marked plan block: ${configName}`)
  }

  return configPath
}

async function runGrcat(configPath: string, input: string, cwd: string): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn<string[]>>

  try {
    proc = Bun.spawn(['grcat', configPath], {
      cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (error) {
    throw new Error(`Marked GRC plan block requires grcat, but it could not be started: ${errorMessage(error)}`)
  }

  proc.stdin.write(input)
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`grcat failed for marked plan block with exit ${exitCode}: ${stderr.trim() || 'no stderr output'}`)
  }

  return stdout
}

export function ansiToHtmlSpans(ansi: string): string {
  const chars = styledCharsFromTokens(tokenize(ansi))
  let html = ''
  let activeClasses = ''

  for (const char of chars) {
    const classes = classesForChar(char)
    if (classes !== activeClasses) {
      if (activeClasses) html += '</span>'
      if (classes) html += `<span class="${classes}">`
      activeClasses = classes
    }
    html += escapeHtml(char.value)
  }

  if (activeClasses) html += '</span>'
  return html
}

function classesForChar(char: StyledChar): string {
  const classes = new Set<string>()

  for (const style of char.styles) {
    const code = style.code.slice(style.code.indexOf('[') + 1, -1)
    const mapped = sgrClassMap[code]
    if (mapped) classes.add(mapped)
  }

  return [...classes].sort().join(' ')
}

function decodeHtmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
