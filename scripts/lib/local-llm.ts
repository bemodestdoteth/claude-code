import { MongoClient } from 'mongodb'

type LLMEndpoint = {
  url: string
  device_name?: string
  models?: string[]
  enabled?: boolean
  health_status?: string
  structured_output_max_tokens?: number
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI
const DB_NAME = 'codys'
const COLLECTION_NAME = 'LLMEndpoint'
const DEVICE_NAME = 'data'
const REQUEST_TIMEOUT_MS = Number(process.env.LOCAL_LLM_TIMEOUT_MS || 120_000)

export async function localChatCompletion(messages: ChatMessage[]): Promise<string> {
  const endpoint = await getDataEndpoint()
  const response = await fetch(chatCompletionsUrl(endpoint.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: firstModel(endpoint),
      messages,
      temperature: 0,
      max_tokens: endpoint.structured_output_max_tokens || 8000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Local LLM request failed: ${response.status} ${await response.text()}`)
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('Local LLM response contained no assistant content')
  return content
}

async function getDataEndpoint(): Promise<LLMEndpoint> {
  if (!MONGO_URI) throw new Error('MONGODB_URI is required for local LLM endpoint lookup')
  const client = new MongoClient(MONGO_URI)
  try {
    await client.connect()
    const endpoint = await client.db(DB_NAME).collection<LLMEndpoint>(COLLECTION_NAME).findOne({
      device_name: DEVICE_NAME,
      enabled: true,
      health_status: 'healthy',
    })
    if (!endpoint) throw new Error(`No enabled healthy local LLM endpoint found for device_name=${DEVICE_NAME}`)
    validateEndpoint(endpoint)
    return endpoint
  } finally {
    await client.close()
  }
}

function validateEndpoint(endpoint: LLMEndpoint): void {
  const url = new URL(endpoint.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported local LLM URL protocol: ${url.protocol}`)
  if (!endpoint.models || endpoint.models.length === 0) throw new Error(`Local LLM endpoint has no models: ${endpoint.url}`)
}

function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/chat/completions`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function firstModel(endpoint: LLMEndpoint): string {
  const model = endpoint.models?.[0]
  if (!model) throw new Error(`Local LLM endpoint has no models: ${endpoint.url}`)
  return model
}
