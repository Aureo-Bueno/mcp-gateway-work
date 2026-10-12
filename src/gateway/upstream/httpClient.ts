import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp'
import type { HttpServerConfig } from '../../config/servers'
import { GATEWAY_CLIENT_INFO } from '../constants'

export const createHttpClient = async (config: HttpServerConfig): Promise<Client> => {
  const client = new Client(GATEWAY_CLIENT_INFO)
  const transport = new StreamableHTTPClientTransport(
    new URL(config.url),
    config.headers === undefined ? undefined : { requestInit: { headers: config.headers } }
  )
  await client.connect(transport)
  return client
}