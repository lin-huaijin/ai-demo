import type { IncomingMessage, ServerResponse } from 'node:http'
import { proxyProviderRequest } from '../server/providers/proxy.ts'

type Provider = 'scrape' | 'foreplay'

const PROVIDER_PREFIXES: Record<Provider, string> = {
  scrape: '/api/scrape',
  foreplay: '/api/foreplay',
}
export interface ProviderRewriteTarget {
  provider: Provider
  url: string
}

/**
 * Vercel rewrites the public multi-segment provider URL to this one stable
 * Function and carries the original suffix in internal query parameters.
 * Restore the URL shape expected by the shared allowlisted proxy before it
 * validates the provider path and user query.
 */
export function providerRewriteTarget(
  request: Pick<IncomingMessage, 'url'>,
): ProviderRewriteTarget | null {
  const incoming = new URL(request.url ?? '/api/provider', 'http://localhost')
  const provider = incoming.searchParams.get('__provider')
  const rawPath = incoming.searchParams.get('__path')
  if ((provider !== 'scrape' && provider !== 'foreplay') || !rawPath) {
    return null
  }

  const path = rawPath.replace(/^\/+|\/+$/g, '')
  if (!path) return null

  incoming.searchParams.delete('__provider')
  incoming.searchParams.delete('__path')
  const query = incoming.searchParams.toString()
  return {
    provider,
    url: `${PROVIDER_PREFIXES[provider]}/${path}${query ? `?${query}` : ''}`,
  }
}

export default function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const target = providerRewriteTarget(request)
  if (!target) {
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'Provider route not found' }))
    return
  }

  request.url = target.url
  return proxyProviderRequest(target.provider, request, response)
}
