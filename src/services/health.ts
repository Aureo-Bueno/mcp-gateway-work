export interface UpstreamHealth {
  name: string
  healthy: boolean
  latencyMs: number | null
  checkedAt: string
  error?: string
}

const state = new Map<string, UpstreamHealth>()

export const recordHealth = (health: UpstreamHealth): void => {
  state.set(health.name, health)
}

export const getHealth = (name: string): UpstreamHealth | undefined => state.get(name)

export const listHealth = (): UpstreamHealth[] => [...state.values()]

export const removeHealth = (name: string): void => {
  state.delete(name)
}