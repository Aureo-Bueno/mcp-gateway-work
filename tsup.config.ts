import type { Plugin } from 'esbuild'
import { defineConfig } from 'tsup'

type PluginBuild = Parameters<Plugin['setup']>[0]

// The MCP SDK's package `exports` map resolves subpaths without a file
// extension (e.g. "./*" -> "./dist/esm/*"), which Node's ESM loader cannot
// resolve at runtime. These imports stay external (never bundled, so native and
// dynamic-require dependencies keep working); we only rewrite the specifier to
// its real ".js" file so our own source can stay free of extensions.
const SDK_SUBPATH_REWRITES: Record<string, string> = {
  '@modelcontextprotocol/sdk/client/stdio': '@modelcontextprotocol/sdk/client/stdio.js',
  '@modelcontextprotocol/sdk/client/streamableHttp':
    '@modelcontextprotocol/sdk/client/streamableHttp.js',
  '@modelcontextprotocol/sdk/server/mcp': '@modelcontextprotocol/sdk/server/mcp.js',
  '@modelcontextprotocol/sdk/server/stdio': '@modelcontextprotocol/sdk/server/stdio.js',
  '@modelcontextprotocol/sdk/types': '@modelcontextprotocol/sdk/types.js',
}

const sdkExtensionPlugin: Plugin = {
  name: 'sdk-extension',
  setup(build: PluginBuild) {
    build.onResolve({ filter: /^@modelcontextprotocol\/sdk/ }, (args) => ({
      path: SDK_SUBPATH_REWRITES[args.path] ?? args.path,
      external: true,
    }))
  },
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
    'echo-server': 'tests/fixtures/echo-server.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: [/^@modelcontextprotocol\/sdk/],
  esbuildPlugins: [sdkExtensionPlugin],
})
