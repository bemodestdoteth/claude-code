#!/usr/bin/env bun

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeVaultNote } from './obsidian-vault-write.ts'

const CHALLENGE_FILE = process.env.OBSIDIAN_CHALLENGE || 'Core Software.md'
const MAX_MEMORY_BYTES = Number(process.env.OBSIDIAN_MEMORY_MAX_BYTES || 2000)
const MAX_WIKI_PAGES = Number(process.env.OBSIDIAN_WIKI_MAX_PAGES || 12)
const MAX_WIKI_SNIPPET_BYTES = Number(process.env.OBSIDIAN_WIKI_SNIPPET_BYTES || 500)
const VAULT_PATH = process.env.OBSIDIAN_VAULT || '/mnt/870-evo-1/.obsidian/Growth Reactor'
const QUEUE_DIR = process.env.OBSIDIAN_SUMMARY_QUEUE || join(VAULT_PATH, 'Sessions', '.claude-summary-queue')
const MEMORY_QUEUE_DIR = process.env.OBSIDIAN_MEMORY_QUEUE || join(VAULT_PATH, 'Sessions', 'Claude Memory', 'distillation', 'queue')
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  const payload = await readPayload()
  const sessionId = payload.session_id || payload.sessionId
  const transcriptPath = payload.transcript_path || payload.transcriptPath
  const cwd = payload.cwd || payload.projectCwd || ''

  if (!sessionId || !transcriptPath) {
    console.error(JSON.stringify({ error: 'Missing session_id or transcript_path' }))
    return
  }

  let extracted: any
  try {
    const gitRoot = findGitRoot(cwd)
    const omcMetaPath = gitRoot ? join(gitRoot, '.omc', 'sessions', `${sessionId}.json`) : ''
    const extractArgs = [join(SCRIPT_DIR, 'session-extract.ts'), transcriptPath]
    if (omcMetaPath && existsSync(omcMetaPath)) extractArgs.push(omcMetaPath)
    extracted = JSON.parse(execFileSync('bun', extractArgs, { encoding: 'utf8', timeout: 5000 }))
    extracted.projectCwd = extracted.projectCwd || cwd
    if (gitRoot) extracted.omcSync = collectOmcSync(gitRoot, sessionId)
  } catch (error) {
    console.error(JSON.stringify({ error: `Extractor failed: ${error instanceof Error ? error.message : String(error)}` }))
    return
  }

  if (extracted.isEmptySession) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'empty session' }))
    return
  }

  const noteData = {
    ...extracted,
    summary_status: 'queued',
    summary: extracted.firstUserMessage || 'Summary queued.',
  }

  let vaultResult: ReturnType<typeof writeVaultNote>
  try {
    vaultResult = writeVaultNote(noteData, CHALLENGE_FILE)
  } catch (error) {
    console.error(JSON.stringify({ error: `Vault write failed: ${error instanceof Error ? error.message : String(error)}` }))
    return
  }

  try {
    const jobPath = enqueueSummaryJob(sessionId, vaultResult.filePath, extracted)
    const memoryJobPath = enqueueMemoryDistillationJob(sessionId, vaultResult.filePath, extracted, 'memory')
    const antiPatternJobPath = enqueueMemoryDistillationJob(sessionId, vaultResult.filePath, extracted, 'antiPatterns')
    spawnBackgroundSummarizer(jobPath)
    spawnBackgroundMemoryDistiller(memoryJobPath, false)
    spawnBackgroundMemoryDistiller(antiPatternJobPath, true)
    console.log(JSON.stringify({ ok: true, summaryQueued: true, summaryJob: jobPath, memoryQueued: true, memoryJob: memoryJobPath, antiPatternsQueued: true, antiPatternsJob: antiPatternJobPath, ...vaultResult }))
  } catch (error) {
    console.log(JSON.stringify({ ok: true, summaryQueued: false, memoryQueued: false, antiPatternsQueued: false, queueError: error instanceof Error ? error.message : String(error), ...vaultResult }))
  }
}

async function readPayload(): Promise<any> {
  try {
    const input = await readStdin(2000)
    return JSON.parse(input || '{}')
  } catch {
    console.error(JSON.stringify({ error: 'Invalid SessionEnd JSON on stdin' }))
    return {}
  }
}

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = []
    const timer = setTimeout(() => resolve(chunks.join('')), timeoutMs)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => chunks.push(String(chunk)))
    process.stdin.on('end', () => {
      clearTimeout(timer)
      resolve(chunks.join(''))
    })
  })
}

function enqueueSummaryJob(sessionId: string, notePath: string, extracted: Record<string, any>): string {
  mkdirSync(QUEUE_DIR, { recursive: true })
  const jobPath = join(QUEUE_DIR, `${sessionId}.json`)
  writeFileSync(jobPath, JSON.stringify({ sessionId, notePath, extracted, queuedAt: new Date().toISOString() }, null, 2) + '\n')
  return jobPath
}

function enqueueMemoryDistillationJob(sessionId: string, notePath: string, extracted: Record<string, any>, mode: 'memory' | 'antiPatterns'): string {
  const modeDir = join(MEMORY_QUEUE_DIR, mode)
  mkdirSync(modeDir, { recursive: true })
  const jobPath = join(modeDir, `${sessionId}.json`)
  writeFileSync(jobPath, JSON.stringify({ sessionId, notePath, extracted, mode, queuedAt: new Date().toISOString() }, null, 2) + '\n')
  return jobPath
}

function spawnBackgroundSummarizer(jobPath: string): void {
  const workerPath = join(SCRIPT_DIR, 'obsidian-session-summarize.ts')
  const child = spawn('bun', [workerPath, jobPath], { detached: true, stdio: 'ignore' })
  child.unref()
}

function spawnBackgroundMemoryDistiller(jobPath: string, antiPatterns: boolean): void {
  const workerPath = join(SCRIPT_DIR, 'obsidian-memory-distill.ts')
  const args = antiPatterns ? [workerPath, '--job', jobPath, '--anti-patterns'] : [workerPath, '--job', jobPath]
  const child = spawn('bun', args, { detached: true, stdio: 'ignore' })
  child.unref()
}

function findGitRoot(startPath: string): string | null {
  let current = startPath || process.cwd()
  try {
    return execFileSync('git', ['-C', current, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 1000 }).trim()
  } catch {
    while (current && current !== dirname(current)) {
      if (existsSync(join(current, '.git'))) return current
      current = dirname(current)
    }
    return null
  }
}

function collectOmcSync(gitRoot: string, sessionId: string) {
  const projectMemory = readJsonSummary(join(gitRoot, '.omc', 'project-memory.json'))
  const sessionMemory = readJsonSummary(join(gitRoot, '.omc', 'sessions', `${sessionId}.json`))
  const memoryFiles = collectMemoryFiles(join(gitRoot, 'memory'))
  const wikiPages = collectWikiPages(join(gitRoot, '.omc', 'wiki'))
  return {
    status: 'ok',
    projectMemory,
    sessionMemory,
    memoryFiles,
    wikiPages,
    counts: {
      memoryFiles: memoryFiles.length,
      wikiPages: wikiPages.length,
      hasProjectMemory: Boolean(projectMemory),
      hasSessionMemory: Boolean(sessionMemory),
    },
  }
}

function readJsonSummary(path: string): any | null {
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return {
      version: value.version,
      projectRoot: value.projectRoot,
      techStack: value.techStack,
      build: value.build,
      customNotes: limitArray(value.customNotes || [], 10),
      userDirectives: limitArray(value.userDirectives || [], 10),
      hotPaths: limitArray(value.hotPaths || [], 12),
      duration_ms: value.duration_ms,
      reason: value.reason,
      agents_spawned: value.agents_spawned,
      agents_completed: value.agents_completed,
      modes_used: value.modes_used,
    }
  } catch {
    return null
  }
}

function collectMemoryFiles(memoryDir: string): Array<{ name: string; path: string; snippet: string }> {
  if (!existsSync(memoryDir)) return []
  try {
    return readdirSync(memoryDir)
      .filter((name) => name.endsWith('.md'))
      .sort()
      .slice(0, MAX_WIKI_PAGES)
      .map((name) => ({ name, path: join(memoryDir, name), snippet: safeSnippet(join(memoryDir, name), MAX_MEMORY_BYTES) }))
      .filter((entry) => entry.snippet)
  } catch {
    return []
  }
}

function collectWikiPages(wikiDir: string): Array<{ name: string; path: string; snippet: string }> {
  if (!existsSync(wikiDir)) return []
  try {
    return readdirSync(wikiDir)
      .filter((name) => name.endsWith('.md') && !['index.md', 'log.md'].includes(name))
      .sort((a, b) => statSync(join(wikiDir, b)).mtimeMs - statSync(join(wikiDir, a)).mtimeMs)
      .slice(0, MAX_WIKI_PAGES)
      .map((name) => ({ name, path: join(wikiDir, name), snippet: safeSnippet(join(wikiDir, name), MAX_WIKI_SNIPPET_BYTES) }))
      .filter((entry) => entry.snippet)
  } catch {
    return []
  }
}

function safeSnippet(path: string, maxBytes: number): string {
  try {
    return readFileSync(path, 'utf8')
      .slice(0, maxBytes)
      .split('\n')
      .filter((line) => !/(api[_-]?key|secret|token|password|private[_-]?key|\.env|test\.env)/i.test(line))
      .join('\n')
      .trim()
  } catch {
    return ''
  }
}

function limitArray<T>(value: T[], maxItems: number): T[] {
  return Array.isArray(value) ? value.slice(0, maxItems) : []
}

main()
  .catch((error) => console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })))
  .finally(() => process.exit(0))
