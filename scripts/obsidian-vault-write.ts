#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

const VAULT_PATH = process.env.OBSIDIAN_VAULT || '/mnt/870-evo-1/.obsidian/Growth Reactor'
const SESSIONS_DIR = join(VAULT_PATH, 'Sessions')

export type VaultWriteResult = {
  ok: true
  filePath: string
  filename: string
  challengeUpdated: boolean
  vaultPath: string
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  })
}

async function main(): Promise<void> {
  const inputJson = process.argv[2]
  const challengeFile = process.argv[3]
  if (!inputJson) throw new Error('Usage: bun scripts/obsidian-vault-write.ts <json-string> [Challenge-File.md]')
  const result = writeVaultNote(JSON.parse(inputJson), challengeFile)
  process.stdout.write(JSON.stringify(result, null, 2))
}

export function writeVaultNote(data: any, challengeFile?: string): VaultWriteResult {
  const sessionId = data.sessionId || data.session_id || 'unknown'
  const date = data.date || localDateStr(new Date())
  const time = data.startTime || localTimeStr(new Date())
  const topic = sanitizeText(deriveTopic(data).replace(/https?:\/\/\S+/g, '').trim() || 'Session')
  const filename = `${date}-${time.replace(/:/g, '')}_${makeSlug(topic)}.md`
  const projectName = deriveProjectName(data.projectCwd || data.project_cwd || data.project || '')
  const dirPath = safeJoin(SESSIONS_DIR, projectName, date.slice(0, 7))
  const existingPath = findExistingSessionNote(dirPath, sessionId)
  const filePath = existingPath || safeJoin(dirPath, filename)

  if (challengeFile && !data.challenge) data.challenge = basename(challengeFile).replace(/\.md$/, '')
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(filePath, `---\n${buildFrontmatter(data, filename.replace(/\.md$/, ''))}---\n\n${buildBody(data)}`, 'utf8')

  const challengeUpdated = challengeFile ? updateChallengeFile(challengeFile, filename.replace(/\.md$/, ''), topic) : false
  return { ok: true, filePath, filename, challengeUpdated, vaultPath: VAULT_PATH }
}

function buildFrontmatter(data: any, noteName: string): string {
  const fields: Record<string, any> = {
    date: data.date ? `${data.date}T${data.startTime || '00:00'}` : new Date().toISOString(),
    project: data.project || deriveProjectName(data.projectCwd || data.project_cwd || ''),
    challenge: data.challenge || '',
    category: data.category || 'session-log',
    topic: deriveTopic(data),
    working_directory: deriveWorkingDirectory(data),
    exchanges: safeArray(data.exchanges),
    files_modified: normalizeFileList(data.filesModified || data.files_modified || [], deriveWorkingDirectory(data)),
    files_read: normalizeFileList(data.filesRead || data.files_read || [], deriveWorkingDirectory(data)),
    file_change_stats: normalizeFileChangeStats(data.fileChangeStats || data.file_change_stats || [], deriveWorkingDirectory(data)),
    tools_used: safeArray(data.toolsUsed || data.tools_used),
    error_signals: safeArray(data.errorSignals || data.error_signals),
    related_docs: safeArray(data.relatedDocs || data.related_docs),
    omc_sync_status: data.omcSync?.status || 'missing',
    omc_wiki_pages: safeArray(data.omcSync?.wikiPages).map((page: any) => page.name),
    memory_files: safeArray(data.omcSync?.memoryFiles).map((file: any) => file.name),
    memory_summary_status: data.summary_status || 'queued',
    verification_status: inferVerificationStatus(data),
    session_id: data.sessionId || data.session_id || '',
    status: data.status || 'done',
  }
  if (!fields.related_docs.includes(noteName)) fields.related_docs.push(noteName)

  return Object.entries(fields)
    .map(([key, value]) => formatYamlField(key, redactValue(value)))
    .join('\n') + '\n'
}

function buildBody(data: any): string {
  const lines: string[] = []
  lines.push(`# ${sanitizeText(deriveTopic(data))}`, '')
  lines.push('## Summary', sanitizeText(data.summary || data.firstUserMessage || 'Summary queued.'), '')
  addListSection(lines, 'Key Decisions', data.keyDecisions || data.key_decisions)
  addListSection(lines, 'Assumptions & Uncertainty', data.assumptionSignals || data.assumption_signals)

  const workingDirectory = deriveWorkingDirectory(data)
  const filesModified = normalizeFileList(data.filesModified || data.files_modified || [], workingDirectory)
  const filesRead = normalizeFileList(data.filesRead || data.files_read || [], workingDirectory)
  if (filesModified.length > 0 || filesRead.length > 0) {
    lines.push('## Changes')
    for (const file of filesModified) lines.push(`- \`${file}\` — modified`)
    for (const file of filesRead) lines.push(`- \`${file}\` — read`)
    lines.push('')
  }

  const fileChangeStats = normalizeFileChangeStats(data.fileChangeStats || data.file_change_stats || [], workingDirectory)
  if (fileChangeStats.length > 0) {
    lines.push('## File Change Stats')
    for (const stat of fileChangeStats) lines.push(`- \`${stat.path}\` — ${stat.additions ?? '?'} / ${stat.deletions ?? '?'} (${stat.source}, ${stat.confidence})`)
    lines.push('')
  }

  addListSection(lines, 'Errors & Fixes', data.errorsEncountered || data.errors_encountered || data.errorSignals)
  addListSection(lines, 'Recurrence Prevention', data.recurrenceSignals || data.recurrence_signals)
  addChecklistSection(lines, 'Next Steps', data.nextSteps || data.next_steps)
  lines.push('## Verification', `- Status: ${inferVerificationStatus(data)}`, '')
  lines.push('## Links')
  if (data.challenge) lines.push(`- Challenge: [[${sanitizeText(data.challenge)}]]`)
  const relatedDocs = safeArray(data.relatedDocs || data.related_docs)
  if (relatedDocs.length > 0) {
    lines.push('- Related:')
    for (const doc of relatedDocs) lines.push(`  - [[${sanitizeText(doc)}]]`)
  }
  lines.push('', '<!-- session metadata -->', `<!-- session_id: ${sanitizeText(data.sessionId || data.session_id || '')} -->`, `<!-- tools_used: ${safeArray(data.toolsUsed).map(sanitizeText).join(', ')} -->`, `<!-- duration_ms: ${sanitizeText(data.duration_ms || data.omcMeta?.duration_ms || '')} -->`, '')
  return lines.join('\n')
}

export function updateVaultNoteSummary(notePath: string, summary: Record<string, any>): void {
  const resolved = resolve(notePath)
  const vaultResolved = resolve(VAULT_PATH)
  if (!resolved.startsWith(vaultResolved + sep)) throw new Error('Refusing to update note outside Obsidian vault')
  const current = readFileSync(resolved, 'utf8')
  const updatedFrontmatter = current.replace(/memory_summary_status: .*/, 'memory_summary_status: ok')
  const bodyStart = updatedFrontmatter.indexOf('\n---\n')
  if (bodyStart === -1) throw new Error('Invalid note frontmatter')
  const frontmatter = updatedFrontmatter.slice(0, bodyStart + 5)
  const body = buildBody({ ...summary, summary_status: 'ok' })
  writeFileSync(resolved, `${frontmatter}\n${body}`, 'utf8')
}

function addListSection(lines: string[], title: string, values: any): void {
  const items = safeArray(values).map(sanitizeText).filter(Boolean)
  if (items.length === 0) return
  lines.push(`## ${title}`)
  for (const item of items) lines.push(`- ${item}`)
  lines.push('')
}

function addChecklistSection(lines: string[], title: string, values: any): void {
  const items = safeArray(values).map(sanitizeText).filter(Boolean)
  if (items.length === 0) return
  lines.push(`## ${title}`)
  for (const item of items) lines.push(`- [ ] ${item}`)
  lines.push('')
}

function formatYamlField(key: string, value: any): string {
  if (Array.isArray(value)) return value.length === 0 ? `${key}: []` : `${key}:\n${value.map((item) => `  - ${formatYamlValue(item)}`).join('\n')}`
  if (value === null || value === undefined) return `${key}: ""`
  return `${key}: ${formatYamlValue(value)}`
}

function formatYamlValue(value: any): string {
  if (value === null || value === undefined) return '""'
  if (typeof value !== 'string') return JSON.stringify(value)
  if (value === '') return '""'
  if (/^[\[\]{}|>&*#?!@%,]/.test(value) || /[:#']/.test(value) || value.includes('\n') || value.includes('\r')) return JSON.stringify(value)
  return value
}

function updateChallengeFile(challengeName: string, noteName: string, topic: string): boolean {
  const challengePath = safeJoin(VAULT_PATH, 'Challenges', basename(challengeName))
  if (!existsSync(challengePath)) return false
  const linkPattern = `[[${noteName}]]`
  let content = readFileSync(challengePath, 'utf8')
  if (content.includes(linkPattern)) return false
  const linkLine = `- [[${noteName}|${topic}]]`
  const sessionsHeader = '### Sessions'
  const sessionsIndex = content.indexOf(sessionsHeader)
  content = sessionsIndex === -1 ? `${content}\n\n${sessionsHeader}\n${linkLine}\n` : `${content.slice(0, sessionsIndex + sessionsHeader.length)}\n${linkLine}${content.slice(sessionsIndex + sessionsHeader.length)}`
  writeFileSync(challengePath, content, 'utf8')
  return true
}

function findExistingSessionNote(dirPath: string, sessionId: string): string | null {
  if (!existsSync(dirPath)) return null
  for (const name of readdirSync(dirPath).filter((entry) => entry.endsWith('.md'))) {
    const path = safeJoin(dirPath, name)
    if (readFileSync(path, 'utf8').includes(`session_id: ${sessionId}`)) return path
  }
  return null
}

function deriveTopic(data: any): string {
  return sanitizeText(data.topic || data.firstUserMessage || data.lastUserMessage || 'Claude Code Session').slice(0, 120)
}

function deriveProjectName(cwd: string): string {
  const trimmed = String(cwd || '').replace(/\/+$/, '')
  return normalizeProjectName(basename(trimmed)) || 'unknown-project'
}

function normalizeProjectName(value: string): string {
  if (value === 'my_exchanges') return 'my-exchanges'
  return value
}

function deriveWorkingDirectory(data: any): string {
  return sanitizeText(String(data.projectCwd || data.project_cwd || '').replace(/\/+$/, ''))
}

function normalizeFileList(files: any, workingDirectory: string): string[] {
  return safeArray(files).map((file) => normalizePath(String(file), workingDirectory)).filter(Boolean)
}

function normalizeFileChangeStats(stats: any, workingDirectory: string): any[] {
  return safeArray(stats).map((stat) => ({ ...stat, path: normalizePath(String(stat.path || ''), workingDirectory) })).filter((stat) => stat.path)
}

function normalizePath(path: string, workingDirectory: string): string {
  const clean = sanitizeText(path)
  if (!clean) return ''
  return workingDirectory && clean.startsWith(workingDirectory) ? relative(workingDirectory, clean) : clean
}

function inferVerificationStatus(data: any): string {
  const errors = safeArray(data.errorSignals || data.errorsEncountered)
  const tools = safeArray(data.toolsUsed || data.tools_used).map((tool) => String(tool).toLowerCase())
  if (errors.length > 0) return 'needs-review'
  if (tools.some((tool) => tool.includes('bash'))) return 'partially-verified'
  return 'not-run'
}

function redactValue(value: any): any {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry)]))
  return sanitizeText(value)
}

export function sanitizeText(value: any): string {
  return String(value ?? '')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED_ANTHROPIC_KEY]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/(?<=api[_-]?key\s*[:=]\s*)\S+/gi, '[REDACTED]')
    .replace(/(?<=token\s*[:=]\s*)\S+/gi, '[REDACTED]')
    .replace(/(?<=password\s*[:=]\s*)\S+/gi, '[REDACTED]')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '[REDACTED_SYSTEM_REMINDER]')
    .replace(/<tool_use[\s\S]*?<\/tool_use>/g, '[REDACTED_TOOL_USE]')
    .trim()
}

function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function makeSlug(value: string): string {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'session'
}

function safeJoin(root: string, ...parts: string[]): string {
  const resolvedRoot = resolve(root)
  const resolved = resolve(root, ...parts)
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) throw new Error('Unsafe path outside root')
  return resolved
}

function localDateStr(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function localTimeStr(date: Date): string {
  return date.toTimeString().slice(0, 5)
}
