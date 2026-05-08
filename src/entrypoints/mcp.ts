import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
  type Tool,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import review from '../commands/review.js'
import type { Command } from '../commands.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../Tool.js'
import { getTools } from '../tools.js'
import { createAbortController } from '../utils/abortController.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import { logError } from '../utils/log.js'

function logForDebugging(...args: unknown[]): void {
  if (process.env.CLaude_CODE_DEBUG || process.argv.includes('--debug')) {
    // biome-ignore lint/suspicious/noConsole: debug logging
    console.error('[MCP Debug]', ...args)
  }
}
import { createAssistantMessage } from '../utils/messages.js'
import { getMainLoopModel } from '../utils/model/model.js'
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js'
import { setCwd } from '../utils/Shell.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { getErrorParts } from '../utils/toolErrors.js'
import { zodToJsonSchema } from '../utils/zodToJsonSchema.js'

type ToolInput = Tool['inputSchema']
type ToolOutput = Tool['outputSchema']

const MCP_COMMANDS: Command[] = [review]

export async function startMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
  port?: number,
  host?: string,
): Promise<void> {
  // biome-ignore lint/suspicious/noConsole: startup logging
  console.log(`[MCP] Starting server on ${host ?? '0.0.0.0'}:${port ?? 'stdio'}`)

  // Use size-limited LRU cache for readFileState to prevent unbounded memory growth
  // 100 files and 25MB limit should be sufficient for MCP server operations
  const READ_FILE_STATE_CACHE_SIZE = 100
  const readFileStateCache = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )
  setCwd(cwd)
  const server = new Server(
    {
      name: 'claude/tengu',
      version: typeof MACRO !== 'undefined' ? MACRO.VERSION : 'dev',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => {
      // TODO: Also re-expose any MCP tools
      const toolPermissionContext = getEmptyToolPermissionContext()
      const tools = getTools(toolPermissionContext)
      return {
        tools: await Promise.all(
          tools.map(async tool => {
            let outputSchema: ToolOutput | undefined
            if (tool.outputSchema) {
              const convertedSchema = zodToJsonSchema(tool.outputSchema)
              // MCP SDK requires outputSchema to have type: "object" at root level
              // Skip schemas with anyOf/oneOf at root (from z.union, z.discriminatedUnion, etc.)
              // See: https://github.com/anthropics/claude-code/issues/8014
              if (
                typeof convertedSchema === 'object' &&
                convertedSchema !== null &&
                'type' in convertedSchema &&
                convertedSchema.type === 'object'
              ) {
                outputSchema = convertedSchema as ToolOutput
              }
            }
            return {
              ...tool,
              description: await tool.prompt({
                getToolPermissionContext: async () => toolPermissionContext,
                tools,
                agents: [],
              }),
              inputSchema: zodToJsonSchema(tool.inputSchema) as ToolInput,
              outputSchema,
            }
          }),
        ),
      }
    },
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
      const toolPermissionContext = getEmptyToolPermissionContext()
      // TODO: Also re-expose any MCP tools
      const tools = getTools(toolPermissionContext)
      const tool = findToolByName(tools, name)
      if (!tool) {
        throw new Error(`Tool ${name} not found`)
      }

      // Assume MCP servers do not read messages separately from the tool
      // call arguments.
      const toolUseContext: ToolUseContext = {
        abortController: createAbortController(),
        options: {
          commands: MCP_COMMANDS,
          tools,
          mainLoopModel: getMainLoopModel(),
          thinkingConfig: { type: 'disabled' },
          mcpClients: [],
          mcpResources: {},
          isNonInteractiveSession: true,
          debug,
          verbose,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
        getAppState: () => getDefaultAppState(),
        setAppState: () => {},
        messages: [],
        readFileState: readFileStateCache,
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        updateFileHistoryState: () => {},
        updateAttributionState: () => {},
      }

      // TODO: validate input types with zod
      try {
        if (!tool.isEnabled()) {
          throw new Error(`Tool ${name} is not enabled`)
        }
        const validationResult = await tool.validateInput?.(
          (args as never) ?? {},
          toolUseContext,
        )
        if (validationResult && !validationResult.result) {
          throw new Error(
            `Tool ${name} input is invalid: ${validationResult.message}`,
          )
        }
        const finalResult = await tool.call(
          (args ?? {}) as never,
          toolUseContext,
          hasPermissionsToUseTool,
          createAssistantMessage({
            content: [],
          }),
        )

        return {
          content: [
            {
              type: 'text' as const,
              text:
                typeof finalResult === 'string'
                  ? finalResult
                  : jsonStringify(finalResult.data),
            },
          ],
        }
      } catch (error) {
        logError(error)

        const parts =
          error instanceof Error ? getErrorParts(error) : [String(error)]
        const errorText = parts.filter(Boolean).join('\n').trim() || 'Error'

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: errorText,
            },
          ],
        }
      }
    },
  )

  async function runServer() {
    // HTTP transport mode (for remote access via Tailscale, etc.)
    if (port !== undefined) {
      // Map to store transports by session ID for session management
      const transports: Record<string, StreamableHTTPServerTransport> = {}

      const httpServer = createServer(async (req, res) => {
        // Enable CORS for cross-origin requests
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, last-event-id')

        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        // Handle GET requests for SSE streams (resumability)
        if (req.method === 'GET') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400)
            res.end('Invalid or missing session ID')
            return
          }
          const transport = transports[sessionId]
          await transport.handleRequest(req, res)
          return
        }

        // Handle DELETE requests for session termination
        if (req.method === 'DELETE') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400)
            res.end('Invalid or missing session ID')
            return
          }
          const transport = transports[sessionId]
          await transport.handleRequest(req, res)
          return
        }

        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }

        // Parse request body
        const chunks: Buffer[] = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            let transport: StreamableHTTPServerTransport

            if (sessionId && transports[sessionId]) {
              // Reuse existing transport for this session
              transport = transports[sessionId]
            } else if (!sessionId && isInitializeRequest(body)) {
              // New initialization request - create a new session
              transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid: string) => {
                  // Store the transport by session ID when session is initialized
                  // This avoids race conditions where requests might come in before the session is stored
                  logForDebugging(`Session initialized with ID: ${sid}`)
                  transports[sid] = transport
                },
              })

              // Set up onclose handler to clean up transport when closed
              transport.onclose = () => {
                const sid = transport.sessionId
                if (sid && transports[sid]) {
                  logForDebugging(`Transport closed for session ${sid}, removing from transports map`)
                  delete transports[sid]
                }
              }

              // Connect the transport to the MCP server BEFORE handling the request
              // so responses can flow back through the same transport
              await server.connect(transport)
              await transport.handleRequest(req, res, body)
              return
            } else {
              // Invalid request - no session ID and not an initialization request
              res.writeHead(400)
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: {
                  code: -32000,
                  message: 'Bad Request: No valid session ID provided'
                },
                id: null,
              }))
              return
            }

            // Handle the request with existing transport
            // The existing transport is already connected to the server
            await transport.handleRequest(req, res, body)
          } catch (error) {
            logForDebugging('Error handling MCP HTTP request:', error)
            if (!res.headersSent) {
              res.writeHead(500)
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
              }))
            }
          }
        })
      })

      const listenHost = host ?? '0.0.0.0'
      // biome-ignore lint/suspicious/noConsole: debug
      console.error(`[MCP HTTP] About to listen on ${listenHost}:${port}`)
      httpServer.on('error', (err) => {
        // biome-ignore lint/suspicious/noConsole: intentional error message
        console.error(`[Claude MCP HTTP Server] Error: ${err.message}`)
        process.exit(1)
      })
      httpServer.listen(port, listenHost, () => {
        // biome-ignore lint/suspicious/noConsole: debug
        console.error(`[MCP HTTP] In listen callback`)
        logForDebugging(`[Claude MCP HTTP Server] Listening on http://${listenHost}:${port}`)
        // biome-ignore lint/suspicious/noConsole: intentional startup message
        console.log(`Claude Code MCP server listening on http://${listenHost}:${port}`)
      })

      // Handle server shutdown
      process.on('SIGINT', async () => {
        // biome-ignore lint/suspicious/noConsole: intentional shutdown message
        console.log('\nShutting down MCP server...')
        // Close all active transports to properly clean up resources
        for (const sessionId in transports) {
          try {
            logForDebugging(`Closing transport for session ${sessionId}`)
            await transports[sessionId].close()
            delete transports[sessionId]
          } catch (error) {
            logForDebugging(`Error closing transport for session ${sessionId}:`, error)
          }
        }
        process.exit(0)
      })

      // Keep the process alive
      await new Promise(() => {})
    } else {
      // Stdio transport mode (default, for local use)
      const transport = new StdioServerTransport()
      await server.connect(transport)
    }
  }

  return await runServer()
}
