import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { AzureCliCredential } from '@azure/identity'

const DEFAULT_MCP_ENDPOINT = '<YOUR_FABRIC_DATA_AGENT_MCP_ENDPOINT>'
const FABRIC_SCOPE = 'https://analysis.windows.net/powerbi/api/.default'

let mcpSessionId = null
let cachedCliToken = null

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

async function getAzureCliToken(forceRefresh = false) {
  const now = Date.now()
  const ttlBufferMs = 2 * 60 * 1000

  if (
    !forceRefresh &&
    cachedCliToken?.token &&
    cachedCliToken?.expiresOnTimestamp > now + ttlBufferMs
  ) {
    return cachedCliToken.token
  }

  const credential = new AzureCliCredential()
  const token = await credential.getToken(FABRIC_SCOPE)

  if (!token?.token) {
    throw new Error('Could not acquire token from Microsoft credentials.')
  }

  cachedCliToken = token
  return token.token
}

async function readJsonBody(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

async function sendMcpRequest({ endpoint, token, payload }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  if (mcpSessionId) {
    headers['mcp-session-id'] = mcpSessionId
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const updatedSessionId = response.headers.get('mcp-session-id')
  if (updatedSessionId) {
    mcpSessionId = updatedSessionId
  }

  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!response.ok) {
    const reason = data?.error?.message || data?.raw || response.statusText
    throw new Error(`MCP request failed (${response.status}): ${reason}`)
  }

  if (data?.error) {
    throw new Error(data.error.message || 'MCP error response received.')
  }

  return data
}

function chooseTool(tools = []) {
  const preferredNames = ['chat', 'ask', 'query', 'question']
  const exactMatch = tools.find((tool) =>
    preferredNames.some((name) => tool?.name?.toLowerCase() === name),
  )

  if (exactMatch) {
    return exactMatch
  }

  const containsMatch = tools.find((tool) =>
    preferredNames.some((name) => tool?.name?.toLowerCase().includes(name)),
  )

  return containsMatch || tools[0] || null
}

function buildToolArguments(tool, message) {
  const props = tool?.inputSchema?.properties || {}
  const knownKeys = ['query', 'question', 'prompt', 'input', 'message', 'text']

  const matchedKey = knownKeys.find((key) => Object.prototype.hasOwnProperty.call(props, key))
  if (matchedKey) {
    return { [matchedKey]: message }
  }

  const schemaKeys = Object.keys(props)
  if (schemaKeys.length === 1) {
    return { [schemaKeys[0]]: message }
  }

  return { input: message }
}

function extractReply(callResult) {
  const content = callResult?.result?.content
  if (Array.isArray(content) && content.length > 0) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item?.text) return item.text
        return JSON.stringify(item)
      })
      .join('\n')
  }

  if (callResult?.result?.structuredContent) {
    return JSON.stringify(callResult.result.structuredContent, null, 2)
  }

  if (callResult?.result) {
    return JSON.stringify(callResult.result, null, 2)
  }

  return 'No response content returned from the data agent.'
}

function mcpProxyPlugin() {
  return {
    name: 'fabric-mcp-proxy',
    configureServer(server) {
      server.middlewares.use('/api/auth/status', async (req, res, next) => {
        if (req.method !== 'GET') {
          next()
          return
        }

        try {
          await getAzureCliToken(false)
          writeJson(res, 200, { authenticated: true })
        } catch {
          writeJson(res, 200, { authenticated: false })
        }
      })

      server.middlewares.use('/api/auth/login', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          await getAzureCliToken(true)
          writeJson(res, 200, { authenticated: true })
        } catch (error) {
          writeJson(res, 401, {
            error:
              error instanceof Error
                ? `${error.message} Run 'az login' in a terminal with your Microsoft account and try again.`
                : "Sign-in failed. Run 'az login' and try again.",
          })
        }
      })

      server.middlewares.use('/api/chat', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const body = await readJsonBody(req)
          const message = body?.message?.trim()
          const endpoint = body?.endpoint || DEFAULT_MCP_ENDPOINT
          let token = body?.token || process.env.FABRIC_BEARER_TOKEN

          if (!message) {
            writeJson(res, 400, { error: 'Message is required.' })
            return
          }

          if (!token) {
            token = await getAzureCliToken(false)
          }

          const initPayload = {
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: {
                name: 'fabric-data-agent-app',
                version: '1.0.0',
              },
            },
          }

          try {
            await sendMcpRequest({ endpoint, token, payload: initPayload })
          } catch (error) {
            const errMessage = String(error?.message || '')
            if (!errMessage.includes('Method not found')) {
              throw error
            }
          }

          const toolsListResponse = await sendMcpRequest({
            endpoint,
            token,
            payload: {
              jsonrpc: '2.0',
              id: crypto.randomUUID(),
              method: 'tools/list',
              params: {},
            },
          })

          const selectedTool = chooseTool(toolsListResponse?.result?.tools)

          if (!selectedTool?.name) {
            throw new Error('No callable tool was returned by the MCP server.')
          }

          const callResult = await sendMcpRequest({
            endpoint,
            token,
            payload: {
              jsonrpc: '2.0',
              id: crypto.randomUUID(),
              method: 'tools/call',
              params: {
                name: selectedTool.name,
                arguments: buildToolArguments(selectedTool, message),
              },
            },
          })

          writeJson(res, 200, {
            reply: extractReply(callResult),
            tool: selectedTool.name,
          })
        } catch (error) {
          writeJson(res, 500, {
            error:
              error instanceof Error ? error.message : 'Unexpected error contacting MCP endpoint.',
          })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mcpProxyPlugin()],
})
