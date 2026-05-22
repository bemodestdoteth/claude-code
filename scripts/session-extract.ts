#!/usr/bin/env bun

import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import readline from 'node:readline'

const FIRST_MSG_TRUNCATE = 500
const LAST_MSG_TRUNCATE = 500
const MAX_ERROR_SIGNALS = 20
const MAX_ASSUMPTION_SIGNALS = 20
const MAX_RECURRENCE_SIGNALS = 20

const FILE_WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'notebookedit', 'notebook_edit'])
const ERROR_SCAN_TOOLS = new Set(['bash', 'grep', 'read', 'edit', 'write'])
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bdenied\b/i,
]
const ASSUMPTION_PATTERNS = [
  /\bassumption\b/i,
  /\bassuming\b/i,
  /\bnot sure\b/i,
  /\bunclear\b/i,
]
const RECURRENCE_PATTERNS = [
  /\bprevent\b/i,
  /\brecurrence\b/i,
  /\bregression\b/i,
  /\bsimilar risk\b/i,
]

type FileChangeStat = {
  path: string
  additions: number | null
  deletions: number | null
  source: string
  confidence: string
}

async function main(): Promise<void> {
  const transcriptPath = process.argv[2]
  const sessionMetaPath = process.argv[3]
  if (!transcriptPath) throw new Error('Usage: bun scripts/session-extract.ts <transcript.jsonl> [session-meta.json]')

  const fileStat = statSync(transcriptPath)
  const fileName = basename(transcriptPath)
  const sessionId = fileName.replace(/\.jsonl$/, '')
  const extracted = await extractClaudeCodeSession(transcriptPath, sessionId, fileStat, fileName)
  const omcMeta = sessionMetaPath ? await readJsonOptional(sessionMetaPath) : null

  process.stdout.write(
    JSON.stringify(
      {
        ...extracted,
        omcMeta: omcMeta
          ? {
              duration_ms: omcMeta.duration_ms,
              reason: omcMeta.reason,
              agents_spawned: omcMeta.agents_spawned,
              agents_completed: omcMeta.agents_completed,
              modes_used: omcMeta.modes_used,
            }
          : null,
      },
      null,
      2,
    ),
  )
}

async function extractClaudeCodeSession(filePath: string, sessionId: string, fileStat: { size: number; mtime: Date }, fileName: string) {
  const userMessages: Array<{ text: string; timestamp: string }> = []
  const toolsUsed = new Set<string>()
  const filesModified = new Set<string>()
  const filesRead = new Set<string>()
  const fileChangeStats = new Map<string, FileChangeStat>()
  const errorSignals: string[] = []
  const assumptionSignals: string[] = []
  const recurrenceSignals: string[] = []
  let assistantTurnCount = 0
  let currentToolName = ''
  let sessionCwd = ''
  let gitBranch = ''
  let firstTimestamp = ''

  const rl = readline.createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }

    const type = obj.type || ''
    if (!firstTimestamp && obj.timestamp) firstTimestamp = String(obj.timestamp)
    if (!sessionCwd) sessionCwd = String(obj.cwd || obj.message?.cwd || '')
    if (!gitBranch && obj.gitBranch) gitBranch = String(obj.gitBranch)

    if (type === 'user' || type === 'human') {
      const text = normalizeUserMessage(extractText(obj.message))
      if (text && !isSystemBoilerplate(text)) userMessages.push({ text: text.slice(0, FIRST_MSG_TRUNCATE), timestamp: obj.timestamp || '' })
      const content = obj.message?.content
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'tool_result' || part?.tool_use_id) {
            const resultText = extractResultText(part)
            if (resultText) {
              scanFileChangeStats(resultText, fileChangeStats)
              if (ERROR_SCAN_TOOLS.has(currentToolName.toLowerCase())) scanSignals(resultText, errorSignals, ERROR_PATTERNS)
            }
            currentToolName = ''
          }
        }
      }
    }

    if (type === 'assistant') {
      assistantTurnCount += 1
      const content = obj.message?.content
      scanAssistantContent(content, assumptionSignals, ASSUMPTION_PATTERNS)
      scanAssistantContent(content, recurrenceSignals, RECURRENCE_PATTERNS)
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'tool_use') {
            const toolName = String(part.name || '')
            if (toolName) {
              toolsUsed.add(toolName)
              currentToolName = toolName
            }
            const toolInput = part.input || {}
            const fp = toolInput.file_path || toolInput.path || toolInput.filePath || ''
            if (fp) {
              if (FILE_WRITE_TOOLS.has(toolName.toLowerCase())) {
                filesModified.add(fp)
                recordFileChangeStat(fileChangeStats, fp, inferToolInputChangeStats(toolName, toolInput))
              } else {
                filesRead.add(fp)
              }
            }
          }
        }
      }
    }
  }
  rl.close()

  const substantiveMessages = userMessages.filter((m) => m.text.length >= 10)
  const firstDate = firstTimestamp ? new Date(firstTimestamp) : fileStat.mtime
  const lastDate = userMessages.at(-1)?.timestamp ? new Date(userMessages.at(-1)!.timestamp) : undefined

  return {
    sessionId,
    source: 'claude-code',
    sourceFile: fileName,
    date: localDateStr(firstDate),
    startTime: localTimeStr(firstDate),
    endTime: lastDate && !Number.isNaN(lastDate.getTime()) ? localTimeStr(lastDate) : '',
    projectCwd: sessionCwd,
    gitBranch,
    sizeBytes: fileStat.size,
    userMessageCount: userMessages.length,
    assistantTurnCount,
    firstUserMessage: substantiveMessages[0]?.text || userMessages[0]?.text || '',
    lastUserMessage: userMessages.at(-1)?.text || '',
    toolsUsed: [...toolsUsed],
    filesModified: [...filesModified],
    filesRead: [...filesRead],
    fileChangeStats: buildFileChangeStats(filesModified, fileChangeStats),
    errorSignals: errorSignals.slice(0, MAX_ERROR_SIGNALS),
    errorSignalCount: errorSignals.length,
    assumptionSignals: assumptionSignals.slice(0, MAX_ASSUMPTION_SIGNALS),
    assumptionSignalCount: assumptionSignals.length,
    recurrenceSignals: recurrenceSignals.slice(0, MAX_RECURRENCE_SIGNALS),
    recurrenceSignalCount: recurrenceSignals.length,
    isEmptySession: substantiveMessages.length < 1,
  }
}

function extractText(message: any): string {
  if (!message) return ''
  if (typeof message === 'string') return message
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) return message.content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('\n')
  return ''
}

function extractResultText(part: any): string {
  if (typeof part?.content === 'string') return part.content
  if (Array.isArray(part?.content)) return part.content.map((item: any) => item?.text || '').join('\n')
  return part?.text || ''
}

function normalizeUserMessage(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

function isSystemBoilerplate(text: string): boolean {
  return text.startsWith('SessionStart:') || text.includes('UserPromptSubmit hook additional context')
}

function scanAssistantContent(content: any, out: string[], patterns: RegExp[]): void {
  if (!Array.isArray(content)) return
  for (const part of content) {
    const text = typeof part === 'string' ? part : part?.text || ''
    scanSignals(text, out, patterns)
  }
}

function scanSignals(text: string, out: string[], patterns: RegExp[]): void {
  for (const line of text.split('\n')) {
    if (out.length >= 50) return
    if (patterns.some((pattern) => pattern.test(line))) out.push(line.trim().slice(0, 300))
  }
}

function inferToolInputChangeStats(toolName: string, toolInput: any): Omit<FileChangeStat, 'path'> {
  const content = toolInput.content || toolInput.new_string || toolInput.new_source || ''
  if (!content || typeof content !== 'string') return { additions: null, deletions: null, source: 'tool_input', confidence: 'none' }
  return { additions: content.split('\n').length, deletions: null, source: 'tool_input', confidence: 'low' }
}

function scanFileChangeStats(text: string, stats: Map<string, FileChangeStat>): void {
  for (const line of text.split('\n')) {
    const match = line.match(/([^\s]+)\s+\|\s+(\d+)\s+[+\-]+/)
    if (!match) continue
    stats.set(match[1], { path: match[1], additions: Number(match[2]), deletions: null, source: 'tool_result', confidence: 'low' })
  }
}

function recordFileChangeStat(stats: Map<string, FileChangeStat>, path: string, stat: Omit<FileChangeStat, 'path'>): void {
  stats.set(path, { path, ...stat })
}

function buildFileChangeStats(filesModified: Set<string>, stats: Map<string, FileChangeStat>): FileChangeStat[] {
  return [...filesModified].map((path) => stats.get(path) || { path, additions: null, deletions: null, source: 'unknown', confidence: 'none' })
}

async function readJsonOptional(path: string): Promise<any | null> {
  try {
    return JSON.parse(await Bun.file(path).text())
  } catch {
    return null
  }
}

function localDateStr(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function localTimeStr(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  return date.toTimeString().slice(0, 5)
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
})
