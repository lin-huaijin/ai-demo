import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

const DEFAULT_RATE_LIMIT_PER_MINUTE = 12
const DEFAULT_MAX_CONCURRENT = 2

interface AccessPolicy {
  deployed: boolean
  enabled: boolean
  requiresAccessToken: boolean
  expectedToken: string
}
export interface AccessDecision {
  allowed: boolean
  status: number
  code?:
    | 'MULTIMODAL_ACCESS_REQUIRED'
    | 'MULTIMODAL_ACCESS_DISABLED'
    | 'MULTIMODAL_LOCAL_ONLY'
    | 'MULTIMODAL_UNTRUSTED_REQUEST'
  message?: string
  requiresAccessToken: boolean
}

interface CapacityState {
  active: number
  starts: number[]
}

const capacity: CapacityState = { active: 0, starts: [] }

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function accessPolicy(
  env: Record<string, string | undefined> = process.env,
): AccessPolicy {
  const expectedToken = env.MULTIMODAL_ACCESS_TOKEN?.trim() ?? ''
  const deployed = Boolean(env.VERCEL) || env.NODE_ENV === 'production'
  return {
    deployed,
    enabled: !deployed || Boolean(expectedToken),
    requiresAccessToken: Boolean(expectedToken) || deployed,
    expectedToken,
  }
}

function bearerToken(request: IncomingMessage): string {
  const raw = request.headers.authorization
  if (typeof raw !== 'string') return ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket?.remoteAddress?.toLowerCase() ?? ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address.startsWith('127.') ||
    address.startsWith('::ffff:127.')
  )
}

function isSameOriginJsonRequest(request: IncomingMessage): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? 'GET')) return true
  const contentType = request.headers['content-type']
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return false
  }
  const rawOrigin = request.headers.origin
  if (typeof rawOrigin !== 'string') return true // native clients do not send Origin
  const host = request.headers.host?.toLowerCase()
  try {
    const origin = new URL(rawOrigin)
    return Boolean(host) && origin.host.toLowerCase() === host
  } catch {
    return false
  }
}

/**
 * Production is fail-closed: a deployment must define a server-side shared
 * access token. The browser asks an authorized teammate for that token at
 * runtime; it is never compiled into the public bundle or persisted.
 */
export function authorizeMultimodalRequest(
  request: IncomingMessage,
  env: Record<string, string | undefined> = process.env,
): AccessDecision {
  const policy = accessPolicy(env)
  if (!policy.enabled) {
    return {
      allowed: false,
      status: 503,
      code: 'MULTIMODAL_ACCESS_DISABLED',
      message: '线上多模态服务尚未配置访问保护，当前已安全关闭。',
      requiresAccessToken: true,
    }
  }
  if (!policy.expectedToken) {
    if (!isLoopbackRequest(request)) {
      return {
        allowed: false,
        status: 403,
        code: 'MULTIMODAL_LOCAL_ONLY',
        message: '未配置团队口令时，多模态接口只允许本机访问。',
        requiresAccessToken: false,
      }
    }
    if (!isSameOriginJsonRequest(request)) {
      return {
        allowed: false,
        status: 403,
        code: 'MULTIMODAL_UNTRUSTED_REQUEST',
        message: '本地多模态写请求必须使用同源 application/json。',
        requiresAccessToken: false,
      }
    }
    return { allowed: true, status: 200, requiresAccessToken: false }
  }
  if (!constantTimeEqual(bearerToken(request), policy.expectedToken)) {
    return {
      allowed: false,
      status: 401,
      code: 'MULTIMODAL_ACCESS_REQUIRED',
      message: '需要有效的团队访问口令。',
      requiresAccessToken: true,
    }
  }
  return { allowed: true, status: 200, requiresAccessToken: true }
}

export function multimodalAccessSummary(
  request: IncomingMessage,
  env: Record<string, string | undefined> = process.env,
) {
  const decision = authorizeMultimodalRequest(request, env)
  return {
    enabled: decision.code !== 'MULTIMODAL_ACCESS_DISABLED',
    authorized: decision.allowed,
    requiresAccessToken: decision.requiresAccessToken,
  }
}

/** Best-effort per-process guard; the shared token remains the primary gate. */
export function acquireMultimodalCapacity(
  env: Record<string, string | undefined> = process.env,
): (() => void) | null {
  const now = Date.now()
  const rateLimit = positiveInteger(
    env.MULTIMODAL_RATE_LIMIT_PER_MINUTE,
    DEFAULT_RATE_LIMIT_PER_MINUTE,
  )
  const maxConcurrent = positiveInteger(
    env.MULTIMODAL_MAX_CONCURRENT,
    DEFAULT_MAX_CONCURRENT,
  )
  capacity.starts = capacity.starts.filter((time) => now - time < 60_000)
  if (capacity.active >= maxConcurrent || capacity.starts.length >= rateLimit) {
    return null
  }
  capacity.active += 1
  capacity.starts.push(now)
  let released = false
  return () => {
    if (released) return
    released = true
    capacity.active = Math.max(0, capacity.active - 1)
  }
}

export function resetMultimodalCapacityForTests() {
  capacity.active = 0
  capacity.starts = []
}
