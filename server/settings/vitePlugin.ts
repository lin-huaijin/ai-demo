import type { Plugin } from 'vite'
import { apiSettingsStatusResult } from './status.ts'

export function apiSettingsPlugin(
  env: Record<string, string | undefined>,
): Plugin {
  return {
    name: 'portfolio-api-settings-status',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        if (path !== '/api/settings/status') {
          next()
          return
        }
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.setHeader('cache-control', 'no-store')
        response.setHeader('x-content-type-options', 'nosniff')
        if (request.method !== 'GET') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: '仅支持 GET' }))
          return
        }
        const result = apiSettingsStatusResult(env)
        response.statusCode = result.status
        response.end(JSON.stringify(result.body))
      })
    },
  }
}
