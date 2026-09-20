import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { providerApiPlugin } from './server/providers/vitePlugin.ts'
import { apiSettingsPlugin } from './server/settings/vitePlugin.ts'
import { multimodalApiPlugin } from './server/multimodal/vitePlugin.ts'
import {
  artifactApiPlugin,
  artifactStoreFromEnv,
} from './server/artifacts/vitePlugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const artifactStore = artifactStoreFromEnv(env)

  return {
    test: {
      // Real paid-provider experiments live here and use dedicated configs.
      // The normal check must remain deterministic and must never spend API quota.
      exclude: ['.tmp-multimodal/**', '**/node_modules/**', '**/.git/**'],
    },
    plugins: [
      react(),
      providerApiPlugin(env),
      apiSettingsPlugin(env),
      artifactApiPlugin(env, artifactStore),
      multimodalApiPlugin(env, artifactStore),
    ],
  }
})
