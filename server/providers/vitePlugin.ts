import type { Plugin } from 'vite'
import { proxyProviderRequest } from './proxy.ts'

type ProviderKind = 'scrape' | 'foreplay'

export function providerKindForPath(path: string): ProviderKind | null {
  if (path === '/api/scrape' || path.startsWith('/api/scrape/')) return 'scrape'
  if (path === '/api/foreplay' || path.startsWith('/api/foreplay/')) {
    return 'foreplay'
  }
  return null
}

/** Use the same allowlisted, rate-limited proxy locally and on Vercel. */
export function providerApiPlugin(
  env: Record<string, string | undefined>,
): Plugin {
  return {
    name: 'portfolio-provider-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        const provider = providerKindForPath(path)
        if (!provider) {
          next()
          return
        }
        void proxyProviderRequest(provider, request, response, env)
      })
    },
  }
}
