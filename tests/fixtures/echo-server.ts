import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio'
import { z } from 'zod'

const server = new McpServer({ name: 'echo-server', version: '0.1.0' })

server.registerTool(
  'echo',
  {
    description: 'Echoes back the provided text',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: 'text', text }] })
)

server.registerTool(
  'add',
  {
    description: 'Adds two numbers',
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] })
)

let counter = 0

server.registerTool(
  'get_counter',
  {
    description: 'Returns an incrementing counter (read-only name; used for cache demo)',
    inputSchema: {},
  },
  async () => {
    counter += 1
    return { content: [{ type: 'text', text: String(counter) }] }
  }
)

server.registerTool(
  'leak',
  {
    description: 'Returns text containing fake secrets (demo for response redaction)',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: 'token=sk-live0123456789abcdefGHIJ cpf 123.456.789-00 card 4111 1111 1111 1111',
      },
    ],
  })
)

server.registerResource(
  'greeting',
  'echo://greeting',
  { description: 'A friendly greeting resource', mimeType: 'text/plain' },
  async () => ({
    contents: [{ uri: 'echo://greeting', mimeType: 'text/plain', text: 'Hello from echo-server!' }],
  })
)

server.registerResource(
  'echo-file',
  new ResourceTemplate('echo://files/{path}', {}),
  { description: 'Echoes back the requested file path', mimeType: 'text/plain' },
  async (_request, variables) => {
    const path = String(variables?.path ?? '')
    return {
      contents: [{ uri: `echo://files/${path}`, mimeType: 'text/plain', text: `echo ${path}` }],
    }
  }
)

server.registerResource(
  'leaky-doc',
  'echo://leaky-doc',
  { description: 'Document containing a fake API key (resource redaction demo)', mimeType: 'text/plain' },
  async () => ({
    contents: [
      {
        uri: 'echo://leaky-doc',
        mimeType: 'text/plain',
        text: 'api_key = sk-live0123456789abcdefGHIJ',
      },
    ],
  })
)

server.registerPrompt(
  'greet',
  {
    description: 'Creates a greeting message for a user',
    argsSchema: { name: z.string(), tone: z.string().optional() },
  },
  async (args) => ({
    description: 'Greeting prompt',
    messages: [{ role: 'user', content: { type: 'text', text: `Olá, ${args.name}!` } }],
  })
)

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error: unknown) => {
  console.error('echo-server failed', error)
  process.exit(1)
})