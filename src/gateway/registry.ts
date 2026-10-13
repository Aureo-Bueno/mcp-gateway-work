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

/** A persisted server that is not connected right now and will be retried. */
export interface FailedServer {
  name: string
  config: ServerConfig
  error: string
  attempts: number
  lastAttemptAt: string
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class ServerRegistry {
  private readonly servers = new Map<string, RegisteredServer>()
  private readonly failed = new Map<string, FailedServer>()
  private readonly connecting = new Map<string, Promise<RegisteredServer>>()

  async register(config: ServerConfig): Promise<RegisteredServer> {
    if (this.servers.has(config.name)) {
      throw new Error(`Server "${config.name}" is already registered`)
    }

    const client =
      config.type === 'stdio' ? await createStdioClient(config) : await createHttpClient(config)

    let tools: Tool[]
    let capabilities: ServerCapabilitiesBundle
    try {
      tools = (await client.listTools()).tools
      capabilities = await fetchCapabilities(client)
    } catch (error) {
      await client.close().catch(() => {
        /* already closed */
      })
      throw error
    }

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
    this.failed.delete(config.name)
    return server
  }

  /**
   * Like {@link register}, but a failure is remembered so the server can be
   * retried later (see {@link retryFailed}). Use it for servers that are already
   * persisted; concurrent calls for the same name share one attempt.
   */
  async connect(config: ServerConfig): Promise<RegisteredServer> {
    const inFlight = this.connecting.get(config.name)
    if (inFlight !== undefined) {
      return inFlight
    }

    const attempt = (async (): Promise<RegisteredServer> => {
      const existing = this.servers.get(config.name)
      if (existing !== undefined) {
        await existing.client.close().catch(() => {
          /* already closed */
        })
        this.servers.delete(config.name)
      }

      try {
        return await this.register(config)
      } catch (error) {
        const previous = this.failed.get(config.name)
        this.failed.set(config.name, {
          name: config.name,
          config,
          error: errorMessage(error),
          attempts: (previous?.attempts ?? 0) + 1,
          lastAttemptAt: new Date().toISOString(),
        })
        throw error
      }
    })()

    this.connecting.set(config.name, attempt)
    try {
      return await attempt
    } finally {
      this.connecting.delete(config.name)
    }
  }

  /** Closes the current session (if any) and opens a new one with the same config. */
  async reconnect(name: string): Promise<RegisteredServer> {
    const config = this.servers.get(name)?.config ?? this.failed.get(name)?.config
    if (config === undefined) {
      throw new Error(`Server "${name}" is not registered`)
    }
    return this.connect(config)
  }

  /** Tries again every server that failed to connect. */
  async retryFailed(): Promise<ConnectResult> {
    const result: ConnectResult = { connected: [], failed: [] }
    for (const entry of [...this.failed.values()]) {
      try {
        await this.connect(entry.config)
        result.connected.push(entry.name)
      } catch (error) {
        result.failed.push({ name: entry.name, error: errorMessage(error) })
      }
    }
    return result
  }

  getFailure(name: string): FailedServer | undefined {
    return this.failed.get(name)
  }

  listFailed(): FailedServer[] {
    return [...this.failed.values()]
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
    // Let an in-flight (re)connect settle first, otherwise it could re-add the
    // server right after it was removed.
    await this.connecting.get(name)?.catch(() => undefined)

    const wasFailed = this.failed.delete(name)
    const server = this.servers.get(name)
    if (server === undefined) {
      return wasFailed
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
        await this.connect(config)
        result.connected.push(config.name)
      } catch (error) {
        result.failed.push({ name: config.name, error: errorMessage(error) })
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
    this.failed.clear()
  }
}

export const registry = new ServerRegistry()