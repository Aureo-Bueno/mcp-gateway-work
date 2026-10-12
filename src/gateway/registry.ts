import type { Client } from '@modelcontextprotocol/sdk/client'
import type { Prompt, Resource, ResourceTemplate, Tool } from '@modelcontextprotocol/sdk/types'
import type { ServerConfig } from '../config/servers'
import { createHttpClient } from './upstream/httpClient'
import { createStdioClient } from './upstream/stdioClient'

export interface RegisteredServer {
  name: string
  config: ServerConfig
  client: Client
  tools: Tool[]
  resources: Resource[]
  resourceTemplates: ResourceTemplate[]
  prompts: Prompt[]
}

interface ServerCapabilitiesBundle {
  resources: Resource[]
  resourceTemplates: ResourceTemplate[]
  prompts: Prompt[]
}

const fetchCapabilities = async (client: Client): Promise<ServerCapabilitiesBundle> => {
  const capabilities = client.getServerCapabilities()
  const bundle: ServerCapabilitiesBundle = { resources: [], resourceTemplates: [], prompts: [] }

  if (capabilities?.resources !== undefined) {
    try {
      bundle.resources = (await client.listResources()).resources
    } catch {
      bundle.resources = []
    }
    try {
      bundle.resourceTemplates = (await client.listResourceTemplates()).resourceTemplates
    } catch {
      bundle.resourceTemplates = []
    }
  }

  if (capabilities?.prompts !== undefined) {
    try {
      bundle.prompts = (await client.listPrompts()).prompts
    } catch {
      bundle.prompts = []
    }
  }

  return bundle
}

export interface ConnectFailure {
  name: string
  error: string
}

export interface ConnectResult {
  connected: string[]
  failed: ConnectFailure[]
}

export class ServerRegistry {
  private readonly servers = new Map<string, RegisteredServer>()

  async register(config: ServerConfig): Promise<RegisteredServer> {
    if (this.servers.has(config.name)) {
      throw new Error(`Server "${config.name}" is already registered`)
    }

    const client =
      config.type === 'stdio' ? await createStdioClient(config) : await createHttpClient(config)

    const { tools } = await client.listTools()
    const capabilities = await fetchCapabilities(client)

    const server: RegisteredServer = {
      name: config.name,
      config,
      client,
      tools,
      resources: capabilities.resources,
      resourceTemplates: capabilities.resourceTemplates,
      prompts: capabilities.prompts,
    }
    this.servers.set(config.name, server)
    return server
  }

  async refreshTools(name: string): Promise<Tool[]> {
    const server = this.get(name)
    const { tools } = await server.client.listTools()
    server.tools = tools
    const capabilities = await fetchCapabilities(server.client)
    server.resources = capabilities.resources
    server.resourceTemplates = capabilities.resourceTemplates
    server.prompts = capabilities.prompts
    return tools
  }

  async ping(name: string): Promise<void> {
    const server = this.get(name)
    await server.client.ping()
  }

  get(name: string): RegisteredServer {
    const server = this.servers.get(name)
    if (!server) {
      throw new Error(`Server "${name}" is not registered`)
    }
    return server
  }

  has(name: string): boolean {
    return this.servers.has(name)
  }

  list(): RegisteredServer[] {
    return [...this.servers.values()]
  }

  async unregister(name: string): Promise<boolean> {
    const server = this.servers.get(name)
    if (server === undefined) {
      return false
    }

    await server.client.close().catch(() => {
      /* already closed */
    })
    this.servers.delete(name)
    return true
  }

  async connectAll(configs: ServerConfig[]): Promise<ConnectResult> {
    const result: ConnectResult = { connected: [], failed: [] }

    for (const config of configs) {
      try {
        await this.register(config)
        result.connected.push(config.name)
      } catch (error) {
        result.failed.push({
          name: config.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return result
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      this.list().map((server) =>
        server.client.close().catch(() => {
          /* already closed */
        })
      )
    )
    this.servers.clear()
  }
}

export const registry = new ServerRegistry()