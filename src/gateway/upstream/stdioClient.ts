import { Client } from '@modelcontextprotocol/sdk/client'
import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio'
import type { StdioServerConfig } from '../../config/servers'
import { GATEWAY_CLIENT_INFO } from '../constants'

export const createStdioClient = async (config: StdioServerConfig): Promise<Client> => {
  const params: StdioServerParameters = {
    command: config.command,
    args: config.args,
    ...(config.env ? { env: config.env } : {}),
  }

  const client = new Client(GATEWAY_CLIENT_INFO)
  await client.connect(new StdioClientTransport(params))
  return client
}