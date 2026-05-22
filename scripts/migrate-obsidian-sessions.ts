#!/usr/bin/env bun

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const EXTRACT_SCRIPT = join(SCRIPT_DIR, 'session-extract.ts')
const VAULT_WRITE_SCRIPT = join(SCRIPT_DIR, 'obsidian-vault-write.ts')
const SUMMARIZE_SCRIPT = join(SCRIPT_DIR, 'obsidian-session-summarize.ts')

const DEFAULT_VAULT = process.env.OBSIDIAN_VAULT || '/mnt/870-evo-1/.obsidian/Growth Reactor'
const DEFAULT_PROJECTS_ROOT = '/home/codys/.claude/projects'

const args = parseArgs(process.argv.slice(2))
const apply = Boolean(args.apply)
const queueSummary = args.queueSummary !== false
const vaultPath = resolve(String(args.vault || DEFAULT_VAULT))
const sessionsDir = join(vaultPath, 'Sessions')
const projectsRoot = resolve(String(args.projectsRoot || DEFAULT_PROJECTS_ROOT))
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const manifestPath = resolve(String(args.manifest || join(REPO_ROOT, '.claude', 'plans', 'sessions', new Date().toISOString().slice(0, 10), `obsidian-backfill-${runId}.json`)))
const backupDir = resolve(String(args.backupDir || join(vaultPath, '.session-backfill-backups', runId)))
const limit = args.limit ? Number(args.limit) : 0
const refreshQueued = Boolean(args.refreshQueued)
const refreshExisting = Boolean(args.refreshExisting)

if (refreshQueued && refreshExisting) throw new Error('Use only one of --refresh-queued or --refresh-existing')

main()

function main(): void {
  const transcripts = listFiles(projectsRoot, '.jsonl').slice(0, limit || undefined)
  const notes = existsSync(sessionsDir) ? listFiles(sessionsDir, '.md') : []
  const noteIndex = buildNoteIndex(notes)
  const transcriptIndex = buildTranscriptIndex(transcripts)
  const actions = buildActionPlan(transcriptIndex, noteIndex)
  const manifest: any = {
    ok: !actions.some((action: any) => action.action === 'conflict'),
    mode: apply ? 'apply' : 'dry-run',
    runId,
    vaultPath,
    sessionsDir,
    projectsRoot,
    backupDir,
    queueSummary,
    summaryQueueDir: join(sessionsDir, '.claude-summary-queue'),
    counts: countActions(actions),
    actions,
  }

  writeJson(manifestPath, manifest)
  if (apply) {
    if (!manifest.ok) {
      console.error(JSON.stringify({ ok: false, error: 'Refusing to apply with conflicts', manifestPath }, null, 2))
      process.exit(1)
    }
    applyManifest(manifest)
    writeJson(manifestPath, manifest)
  }
  writeIndexes(manifest.actions)
  console.log(JSON.stringify({ ok: true, mode: manifest.mode, manifestPath, counts: manifest.counts }, null, 2))
}

function buildTranscriptIndex(transcripts: string[]): any[] {
  const bySession = new Map<string, any>()
  const entries: any[] = []
  for (const transcriptPath of transcripts) {
    let extracted: any
    try {
      extracted = JSON.parse(execFileSync('bun', [EXTRACT_SCRIPT, transcriptPath], { encoding: 'utf8', timeout: 8000 }))
    } catch (error: any) {
      entries.push(conflictEntry('unreadable-transcript', transcriptPath, error.message))
      continue
    }
    if (extracted.isEmptySession) continue
    const sessionId = extracted.sessionId || extracted.session_id
    if (!sessionId) {
      entries.push(conflictEntry('missing-session-id', transcriptPath, 'Extractor returned no session id'))
      continue
    }
    const projectName = deriveProjectName(extracted.projectCwd || extracted.project_cwd || '')
    if (projectName === 'unknown-project') {
      entries.push(conflictEntry('unresolved-project', transcriptPath, 'No trusted projectCwd in extracted metadata', extracted))
      continue
    }
    const monthDir = String(extracted.date || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(monthDir)) {
      entries.push(conflictEntry('invalid-date', transcriptPath, `Invalid extracted date: ${extracted.date}`, extracted))
      continue
    }

    const filename = buildFilename(extracted)
    const kind = transcriptPath.includes('/subagents/') ? 'agent-session' : 'main-session'
    const targetPath = kind === 'agent-session' ? join(sessionsDir, projectName, monthDir, 'agents', filename) : join(sessionsDir, projectName, monthDir, filename)
    const parentSessionId = kind === 'agent-session' ? basename(dirname(dirname(transcriptPath))) : ''
    const agentId = kind === 'agent-session' ? sessionId : ''
    const entry = { sessionId, transcriptPath, extracted, projectName, monthDir, targetPath, kind, parentSessionId, agentId }
    if (bySession.has(sessionId)) {
      entries.push({ action: 'conflict', reason: 'duplicate-transcript-session-id', sessionId, sourceJsonl: transcriptPath, otherSourceJsonl: bySession.get(sessionId).transcriptPath })
      continue
    }
    bySession.set(sessionId, entry)
    entries.push(entry)
  }
  return entries
}

function buildNoteIndex(notes: string[]) {
  const bySession = new Map<string, string[]>()
  const byPath = new Map<string, any>()
  for (const notePath of notes) {
    const content = readFileSync(notePath, 'utf8')
    const sessionId = extractSessionId(content)
    byPath.set(notePath, { path: notePath, sessionId, content })
    if (!sessionId) continue
    const current = bySession.get(sessionId) || []
    current.push(notePath)
    bySession.set(sessionId, current)
  }
  return { bySession, byPath }
}

function buildActionPlan(transcriptEntries: any[], noteIndex: any): any[] {
  const actions: any[] = []
  for (const entry of transcriptEntries) {
    if (entry.action === 'conflict') {
      actions.push(entry)
      continue
    }
    const existingPaths = noteIndex.bySession.get(entry.sessionId) || []
    if (existingPaths.length > 1) {
      actions.push({ action: 'conflict', reason: 'duplicate-note-session-id', sessionId: entry.sessionId, paths: existingPaths })
      continue
    }
    const targetNote = noteIndex.byPath.get(entry.targetPath)
    if (targetNote && targetNote.sessionId && targetNote.sessionId !== entry.sessionId) {
      actions.push({ action: 'conflict', reason: 'target-path-owned-by-other-session', sessionId: entry.sessionId, targetPath: entry.targetPath, ownerSessionId: targetNote.sessionId })
      continue
    }
    if (existingPaths.length === 0) {
      actions.push(baseAction('create', entry, null))
      continue
    }
    const existingPath = existingPaths[0]
    if (refreshQueued || refreshExisting) {
      const summaryStatusBefore = readMemorySummaryStatus(existingPath)
      const qualifies = refreshExisting || (refreshQueued && summaryStatusBefore === 'queued')
      if (qualifies) {
        actions.push({ ...baseAction('skip', entry, existingPath), action: 'refresh', existingPath, summaryStatusBefore, reason: refreshQueued ? 'refresh-queued' : 'refresh-existing' })
        continue
      }
    }
    actions.push(existingPath === entry.targetPath ? baseAction('skip', entry, existingPath) : baseAction('move', entry, existingPath))
  }
  return actions
}

function applyManifest(manifest: any): void {
  mkdirSync(backupDir, { recursive: true })
  for (const action of manifest.actions) {
    if (action.action === 'skip') continue
    if (action.action === 'move') applyMove(action)
    if (action.action === 'create') applyCreate(action)
    if (action.action === 'refresh') applyRefresh(action)
  }
}

function applyMove(action: any): void {
  mkdirSync(dirname(action.newPath), { recursive: true })
  const backupPath = backupFile(action.oldPath)
  copyFileSync(action.oldPath, backupPath)
  renameSync(action.oldPath, action.newPath)
}

function applyCreate(action: any): void {
  mkdirSync(dirname(action.newPath), { recursive: true })
  const output = writeVaultNote({ ...action.extracted, summary_status: queueSummary ? 'queued' : 'not-run', summary: action.extracted.firstUserMessage || 'Summary queued.' })
  const createdPath = moveOutputToTarget(output.filePath, action.newPath)
  action.createdPath = createdPath
  if (queueSummary) action.summaryJob = enqueueSummaryJob(action.sessionId, createdPath, action.extracted)
}

function applyRefresh(action: any): void {
  const oldSha256 = sha256File(action.existingPath)
  const backupPath = backupFile(action.existingPath)
  copyFileSync(action.existingPath, backupPath)
  const output = writeVaultNote({ ...action.extracted, summary_status: queueSummary ? 'queued' : 'not-run', summary: action.extracted.firstUserMessage || 'Summary queued.' })
  const refreshedPath = moveOutputToTarget(output.filePath, action.existingPath)
  action.backupPath = backupPath
  action.oldSha256 = oldSha256
  action.newSha256 = sha256File(refreshedPath)
  action.summaryStatusAfter = readMemorySummaryStatus(refreshedPath)
  if (queueSummary) action.summaryJob = enqueueSummaryJob(action.sessionId, refreshedPath, action.extracted)
}

function moveOutputToTarget(outputPath: string, targetPath: string): string {
  if (resolve(outputPath) !== resolve(targetPath)) {
    mkdirSync(dirname(targetPath), { recursive: true })
    renameSync(outputPath, targetPath)
  }
  return targetPath
}

function writeVaultNote(data: any): any {
  return JSON.parse(execFileSync('bun', [VAULT_WRITE_SCRIPT, JSON.stringify(data)], { encoding: 'utf8', env: { ...process.env, OBSIDIAN_VAULT: vaultPath } }))
}

function enqueueSummaryJob(sessionId: string, notePath: string, extracted: Record<string, any>): string {
  const queueDir = join(sessionsDir, '.claude-summary-queue')
  mkdirSync(queueDir, { recursive: true })
  const jobPath = join(queueDir, `${sessionId}.json`)
  writeFileSync(jobPath, JSON.stringify({ sessionId, notePath, extracted, queuedAt: new Date().toISOString(), source: 'historical-backfill' }, null, 2) + '\n')
  spawnBackgroundSummarizer(jobPath)
  return jobPath
}

function spawnBackgroundSummarizer(jobPath: string): void {
  const child = spawn('bun', [SUMMARIZE_SCRIPT, jobPath], { detached: true, stdio: 'ignore', env: { ...process.env, OBSIDIAN_VAULT: vaultPath } })
  child.unref()
}

function writeIndexes(actions: any[]): void {
  const groups = new Map<string, any>()
  for (const action of actions) {
    if (!['create', 'move', 'skip', 'refresh'].includes(action.action)) continue
    const key = `${action.projectName}/${action.monthDir}`
    const group = groups.get(key) || { projectName: action.projectName, monthDir: action.monthDir, actions: [] }
    group.actions.push(action)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const dirPath = join(sessionsDir, group.projectName, group.monthDir)
    if (apply) mkdirSync(dirPath, { recursive: true })
    const index = buildIndex(group)
    if (apply) {
      writeFileSync(join(dirPath, 'index.md'), index.markdown, 'utf8')
      writeJson(join(dirPath, 'index.json'), index.json)
    }
  }
}

function buildIndex(group: any): any {
  const sessions = group.actions.map((action: any) => {
    const workingDirectory = deriveWorkingDirectory(action.extracted)
    return {
      kind: action.kind,
      session_id: action.sessionId,
      parent_session_id: action.parentSessionId || '',
      agent_id: action.agentId || '',
      note: relative(join(sessionsDir, group.projectName, group.monthDir), action.newPath),
      topic: action.extracted.topic || action.extracted.firstUserMessage || 'Session',
      date: action.extracted.date || '',
      start_time: action.extracted.startTime || '',
      action: action.action,
      working_directory: workingDirectory,
      tools_used: action.extracted.toolsUsed || [],
      files_modified: normalizeFileList(action.extracted.filesModified || [], workingDirectory),
      files_read: normalizeFileList(action.extracted.filesRead || [], workingDirectory),
      file_change_stats: normalizeFileChangeStats(action.extracted.fileChangeStats || [], workingDirectory),
    }
  }).sort((a: any, b: any) => `${a.date} ${a.start_time} ${a.kind}`.localeCompare(`${b.date} ${b.start_time} ${b.kind}`))
  const mainSessions = sessions.filter((session: any) => session.kind === 'main-session')
  const agentSessions = sessions.filter((session: any) => session.kind === 'agent-session')
  const lines = [`# ${group.projectName} — ${group.monthDir} Sessions`, '', '## Main Sessions', '', '| Time | Topic | Note | Agents |', '|---|---|---|---:|']
  for (const session of mainSessions) {
    const agentCount = agentSessions.filter((agent: any) => agent.parent_session_id === session.session_id).length
    lines.push(`| ${session.date} ${session.start_time} | ${escapeTable(session.topic).slice(0, 120)} | [[${session.note.replace(/\.md$/, '')}]] | ${agentCount} |`)
  }
  lines.push('', '## Agent Runs', '', '| Time | Parent | Topic | Note |', '|---|---|---|---|')
  for (const session of agentSessions) lines.push(`| ${session.date} ${session.start_time} | ${session.parent_session_id || ''} | ${escapeTable(session.topic).slice(0, 120)} | [[${session.note.replace(/\.md$/, '')}]] |`)
  lines.push('')
  return { markdown: lines.join('\n'), json: { project: group.projectName, month: group.monthDir, sessions } }
}

function baseAction(action: string, entry: any, oldPath: string | null): any {
  return { action, kind: entry.kind, parentSessionId: entry.parentSessionId, agentId: entry.agentId, sessionId: entry.sessionId, sourceJsonl: entry.transcriptPath, projectName: entry.projectName, monthDir: entry.monthDir, oldPath, newPath: entry.targetPath, oldSha256: oldPath && existsSync(oldPath) ? sha256File(oldPath) : null, newSha256: entry.targetPath && existsSync(entry.targetPath) ? sha256File(entry.targetPath) : null, extracted: entry.extracted }
}

function conflictEntry(reason: string, transcriptPath: string, error: string, extracted: any = null): any {
  return { action: 'conflict', reason, sourceJsonl: transcriptPath, error, extracted }
}

function listFiles(root: string, extension: string): string[] {
  if (!existsSync(root)) return []
  const results: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) stack.push(path)
      else if (name.endsWith(extension)) results.push(path)
    }
  }
  return results.sort()
}

function readMemorySummaryStatus(notePath: string): string | null {
  const match = readFileSync(notePath, 'utf8').match(/^memory_summary_status:\s*["']?([^"'\n]+)["']?/m)
  return match ? match[1].trim() : null
}

function extractSessionId(content: string): string {
  const frontmatterMatch = content.match(/^session_id:\s*["']?([^"'\n]+)["']?/m)
  if (frontmatterMatch) return frontmatterMatch[1].trim()
  const marker = '<!-- session_id:'
  const start = content.indexOf(marker)
  if (start === -1) return ''
  const end = content.indexOf('-->', start)
  return end === -1 ? '' : content.slice(start + marker.length, end).trim()
}

function buildFilename(data: any): string {
  const date = data.date || localDateStr(new Date())
  const time = data.startTime || localTimeStr(new Date())
  const topic = String(data.topic || data.firstUserMessage?.slice(0, 60) || 'Session').replace(/https?:\/\/\S+/g, '').trim() || 'Session'
  return `${date}-${time.replace(/:/g, '')}_${makeSlug(topic)}.md`
}

function escapeTable(value: any): string {
  return String(value || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|')
}

function deriveProjectName(cwd: string): string {
  return normalizeProjectName(basename(String(cwd || '').replace(/\/+$/, ''))) || 'unknown-project'
}

function normalizeProjectName(value: string): string {
  if (value === 'my_exchanges') return 'my-exchanges'
  return value
}

function deriveWorkingDirectory(data: any): string {
  return String(data.projectCwd || data.project_cwd || '').replace(/\/+$/, '')
}

function normalizeFileList(files: any[], workingDirectory: string): string[] {
  return files.map((file) => relativeToWorkingDirectory(file, workingDirectory))
}

function normalizeFileChangeStats(stats: any[], workingDirectory: string): any[] {
  const byPath = new Map<string, any>()
  for (const stat of stats) {
    const normalized = { path: relativeToWorkingDirectory(stat.path, workingDirectory), additions: stat.additions ?? null, deletions: stat.deletions ?? null, source: stat.source || 'unavailable', confidence: stat.confidence || 'none' }
    const current = byPath.get(normalized.path)
    if (!current || confidenceRank(normalized.confidence) > confidenceRank(current.confidence)) byPath.set(normalized.path, normalized)
  }
  return [...byPath.values()]
}

function relativeToWorkingDirectory(file: string, workingDirectory: string): string {
  const path = String(file || '')
  if (!path) return path
  if (workingDirectory && path === workingDirectory) return '.'
  if (workingDirectory && path.startsWith(`${workingDirectory}/`)) return `./${relative(workingDirectory, path)}`
  if (!path.startsWith('/') && !path.startsWith('./')) return `./${path}`
  return path
}

function confidenceRank(confidence: string): number {
  return { none: 0, low: 1, medium: 2, high: 3 }[confidence] || 0
}

function makeSlug(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 60).toLowerCase()
}

function backupFile(path: string): string {
  const backupPath = join(backupDir, relative(vaultPath, path))
  mkdirSync(dirname(backupPath), { recursive: true })
  return backupPath
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeJson(path: string, data: any): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function countActions(actions: any[]): Record<string, number> {
  return actions.reduce((acc, action) => ({ ...acc, [action.action]: (acc[action.action] || 0) + 1 }), {})
}

function parseArgs(argv: string[]): Record<string, any> {
  const parsed: Record<string, any> = {}
  const booleanFlags = new Set(['--apply', '--refresh-queued', '--refresh-existing', '--no-queue-summary'])
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (booleanFlags.has(arg)) {
      if (arg === '--no-queue-summary') parsed.queueSummary = false
      else parsed[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = true
    } else if (arg.startsWith('--')) {
      parsed[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = argv[++index]
    }
  }
  return parsed
}

function localDateStr(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function localTimeStr(date: Date): string {
  return date.toTimeString().slice(0, 5)
}
