import type { IncomingMessage, ServerResponse } from 'node:http'
import { authorizeMultimodalRequest } from '../multimodal/guard.ts'

const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024
const DEFAULT_PROVIDER_RATE_LIMIT_PER_MINUTE = 30
const DEFAULT_PROVIDER_MAX_CONCURRENT = 4
const SCRAPE_PATHS = new Set([
  '/v2/tiktok/video',
  '/v1/instagram/post',
  '/v1/facebook/post',
  '/v1/tiktok/video/transcript',
  '/v2/instagram/media/transcript',
  '/v1/facebook/post/transcript',
])
const FOREPLAY_PATHS = new Set(['/discovery/ads'])
const FOREPLAY_AD_PATH = /^\/ad\/[A-Za-z0-9._-]{1,128}$/

const QUERY_PARAMS_BY_PATH: Record<string, ReadonlySet<string>> = {
  '/v2/tiktok/video': new Set(['url']),
  '/v1/instagram/post': new Set(['url', 'trim']),
  '/v1/facebook/post': new Set(['url']),
  '/v1/tiktok/video/transcript': new Set(['url', 'use_ai_as_fallback']),
  '/v2/instagram/media/transcript': new Set(['url']),
  '/v1/facebook/post/transcript': new Set(['url']),
  '/discovery/ads': new Set([
    'query',
    'niches',
    'display_format',
    'publisher_platform',
    'limit',
    'order',
  ]),
}
interface ProviderCapacityState {
  active: number
  starts: number[]
}

const providerCapacity: ProviderCapacityState = { active: 0, starts: [] }

interface ProviderConfig {
  prefix: string
  baseUrl: string
  allowedPaths: Set<string>
  keyName: 'SCRAPECREATORS_API_KEY' | 'FOREPLAY_API_KEY'
  headers: (key: string) => Record<string, string>
}

const PROVIDERS: Record<'scrape' | 'foreplay', ProviderConfig> = {
  scrape: {
    prefix: '/api/scrape',
    baseUrl: 'https://api.scrapecreators.com',
    allowedPaths: SCRAPE_PATHS,
    keyName: 'SCRAPECREATORS_API_KEY',
    headers: (key) => ({ 'x-api-key': key }),
  },
  foreplay: {
    prefix: '/api/foreplay',
    baseUrl: 'https://public.api.foreplay.co/api',
    allowedPaths: FOREPLAY_PATHS,
    keyName: 'FOREPLAY_API_KEY',
    headers: (key) => ({ authorization: key }),
  },
}

function send(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function acquireProviderCapacity(
  env: Record<string, string | undefined>,
): (() => void) | null {
  const now = Date.now()
  const rateLimit = positiveInteger(
    env.PROVIDER_RATE_LIMIT_PER_MINUTE,
    DEFAULT_PROVIDER_RATE_LIMIT_PER_MINUTE,
  )
  const maxConcurrent = positiveInteger(
    env.PROVIDER_MAX_CONCURRENT,
    DEFAULT_PROVIDER_MAX_CONCURRENT,
  )
  providerCapacity.starts = providerCapacity.starts.filter(
    (time) => now - time < 60_000,
  )
  if (
    providerCapacity.active >= maxConcurrent ||
    providerCapacity.starts.length >= rateLimit
  ) {
    return null
  }
  providerCapacity.active += 1
  providerCapacity.starts.push(now)
  let released = false
  return () => {
    if (released) return
    released = true
    providerCapacity.active = Math.max(0, providerCapacity.active - 1)
  }
}

function appendAllowedQuery(
  target: URL,
  incoming: URL,
  providerPath: string,
): string | null {
  const allowed = FOREPLAY_AD_PATH.test(providerPath)
    ? new Set<string>()
    : QUERY_PARAMS_BY_PATH[providerPath]
  if (!allowed) return '该 Provider 路径没有可用参数策略'
  for (const name of incoming.searchParams.keys()) {
    if (!allowed.has(name)) return `不允许 Provider 查询参数：${name}`
  }
  incoming.searchParams.forEach((value, name) => {
    if (
      providerPath === '/v1/tiktok/video/transcript' &&
      name === 'use_ai_as_fallback'
    ) {
      return
    }
    if (providerPath === '/discovery/ads' && name === 'limit') {
      const parsed = Number(value)
      const clamped = Number.isFinite(parsed)
        ? Math.min(30, Math.max(1, Math.trunc(parsed)))
        : 10
      target.searchParams.set('limit', String(clamped))
      return
    }
    target.searchParams.append(name, value)
  })
  if (providerPath === '/v1/tiktok/video/transcript') {
    target.searchParams.set('use_ai_as_fallback', 'false')
  }
  return null
}

function isAllowedProviderPath(
  kind: keyof typeof PROVIDERS,
  path: string,
  config: ProviderConfig,
): boolean {
  return (
    config.allowedPaths.has(path) ||
    (kind === 'foreplay' && FOREPLAY_AD_PATH.test(path))
  )
}

export async function proxyProviderRequest(
  kind: keyof typeof PROVIDERS,
  request: IncomingMessage,
  response: ServerResponse,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  if (request.method !== 'GET') {
    send(response, 405, { error: '仅支持 GET' })
    return
  }
  const access = authorizeMultimodalRequest(request, env)
  if (!access.allowed) {
    send(response, access.status, {
      error: access.message ?? '服务不可用',
      code: access.code ?? 'MULTIMODAL_ACCESS_REQUIRED',
    })
    return
  }
  const config = PROVIDERS[kind]
  const rawRuntimeKey = request.headers['x-intent-provider-key']
  const runtimeKey = (
    Array.isArray(rawRuntimeKey) ? rawRuntimeKey[0] : rawRuntimeKey
  )?.trim()
  const key =
    (runtimeKey && runtimeKey.length <= 512 ? runtimeKey : '') ||
    env[config.keyName]?.trim()
  if (!key) {
    send(response, 503, { error: `未配置 ${config.keyName}` })
    return
  }
  const incoming = new URL(request.url ?? '/', 'http://localhost')
  const providerPath = incoming.pathname.slice(config.prefix.length) || '/'
  if (!isAllowedProviderPath(kind, providerPath, config)) {
    send(response, 404, { error: '不允许代理该 Provider 路径' })
    return
  }
  const target = new URL(`${config.baseUrl}${providerPath}`)
  const queryError = appendAllowedQuery(target, incoming, providerPath)
  if (queryError) {
    send(response, 400, { error: queryError })
    return
  }
  const releaseCapacity = acquireProviderCapacity(env)
  if (!releaseCapacity) {
    send(response, 429, { error: 'Provider 请求过于频繁，请稍后重试。' })
    return
  }
  try {
    const upstream = await fetchImpl(target, {
      headers: { accept: 'application/json', ...config.headers(key) },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    })
    const declared = Number(upstream.headers.get('content-length') ?? 0)
    if (declared > MAX_PROVIDER_RESPONSE_BYTES) {
      send(response, 502, { error: 'Provider 响应超过大小限制' })
      return
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      send(response, 502, { error: 'Provider 响应超过大小限制' })
      return
    }
    response.statusCode = upstream.status
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(bytes)
  } catch {
    send(response, 502, { error: 'Provider 请求失败，请稍后重试。' })
  } finally {
    releaseCapacity()
  }
}

export function resetProviderCapacityForTests() {
  providerCapacity.active = 0
  providerCapacity.starts = []
}
