import type { Prompt, Resource, ResourceTemplate } from '@modelcontextprotocol/sdk/types'
import type { CatalogPrompt, CatalogTool, WireTool } from '../types/index'
import { RESOURCE_URI_PREFIX, TOOL_SEPARATOR } from './constants'
import type { RegisteredServer } from './registry'
import { registry } from './registry'

const toCatalogTool = (server: RegisteredServer, tool: RegisteredServer['tools'][number]): CatalogTool => ({
  name: `${server.name}${TOOL_SEPARATOR}${tool.name}`,
  description: tool.description,
  inputSchema: tool.inputSchema,
  server: server.name,
  originalName: tool.name,
})

export const buildCatalog = (): CatalogTool[] => {
  const catalog: CatalogTool[] = []
  for (const server of registry.list()) {
    for (const tool of server.tools) {
      catalog.push(toCatalogTool(server, tool))
    }
  }
  return catalog
}

export const toWireTool = (tool: CatalogTool): WireTool => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
})

export const findCatalogTool = (prefixedName: string): CatalogTool | undefined =>
  buildCatalog().find((tool) => tool.name === prefixedName)

export const exposeResourceUri = (server: string, uri: string): string =>
  `${RESOURCE_URI_PREFIX}${encodeURIComponent(server)}/${uri}`

export const parseExposedResourceUri = (
  exposed: string
): { server: string; uri: string } | undefined => {
  if (!exposed.startsWith(RESOURCE_URI_PREFIX)) {
    return undefined
  }
  const rest = exposed.slice(RESOURCE_URI_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) {
    return undefined
  }
  return { server: decodeURIComponent(rest.slice(0, slash)), uri: rest.slice(slash + 1) }
}

export const listWireResources = (): Resource[] => {
  const resources: Resource[] = []
  for (const server of registry.list()) {
    for (const resource of server.resources) {
      resources.push({
        uri: exposeResourceUri(server.name, resource.uri),
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })
    }
  }
  return resources
}

export const listWireResourceTemplates = (): ResourceTemplate[] => {
  const templates: ResourceTemplate[] = []
  for (const server of registry.list()) {
    for (const template of server.resourceTemplates) {
      templates.push({
        uriTemplate: exposeResourceUri(server.name, template.uriTemplate),
        name: template.name,
        description: template.description,
        mimeType: template.mimeType,
      })
    }
  }
  return templates
}

const toCatalogPrompt = (server: RegisteredServer, prompt: Prompt): CatalogPrompt => ({
  name: `${server.name}${TOOL_SEPARATOR}${prompt.name}`,
  server: server.name,
  originalName: prompt.name,
  description: prompt.description,
  arguments: prompt.arguments,
})

export const buildPromptCatalog = (): CatalogPrompt[] => {
  const catalog: CatalogPrompt[] = []
  for (const server of registry.list()) {
    for (const prompt of server.prompts) {
      catalog.push(toCatalogPrompt(server, prompt))
    }
  }
  return catalog
}

export const listWirePrompts = (): Prompt[] =>
  buildPromptCatalog().map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments,
  }))

export const findCatalogPrompt = (prefixedName: string): CatalogPrompt | undefined =>
  buildPromptCatalog().find((prompt) => prompt.name === prefixedName)