import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  acquireMultimodalCapacity,
  authorizeMultimodalRequest,
  resetMultimodalCapacityForTests,
} from './guard.ts'

function request(
  authorization?: string,
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    headers: authorization ? { authorization } : {},
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as IncomingMessage
}

describe('multimodal access guard', () => {
  it('fails closed in production without a shared access token', () => {
    const result = authorizeMultimodalRequest(request(), {
      NODE_ENV: 'production',
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('MULTIMODAL_ACCESS_DISABLED')
  })

  it('uses a runtime bearer token without exposing the expected value', () => {
    const env = { MULTIMODAL_ACCESS_TOKEN: 'team-secret' }
    expect(authorizeMultimodalRequest(request(), env).allowed).toBe(false)
    expect(
      authorizeMultimodalRequest(request('Bearer team-secret'), env).allowed,
    ).toBe(true)
  })

  it('keeps tokenless development local and rejects cross-site form posts', () => {
    expect(
      authorizeMultimodalRequest(
        request(undefined, { socket: { remoteAddress: '192.168.1.20' } as never }),
        {},
      ),
    ).toMatchObject({ allowed: false, code: 'MULTIMODAL_LOCAL_ONLY' })

    expect(
      authorizeMultimodalRequest(
        request(undefined, {
          method: 'POST',
          headers: {
            host: '127.0.0.1:5173',
            origin: 'https://attacker.example',
            'content-type': 'text/plain',
          },
        }),
        {},
      ),
    ).toMatchObject({ allowed: false, code: 'MULTIMODAL_UNTRUSTED_REQUEST' })

    expect(
      authorizeMultimodalRequest(
        request(undefined, {
          method: 'POST',
          headers: {
            host: '127.0.0.1:5173',
            origin: 'http://127.0.0.1:5173',
            'content-type': 'application/json; charset=utf-8',
          },
        }),
        {},
      ).allowed,
    ).toBe(true)
  })

  it('limits concurrent work per process', () => {
    resetMultimodalCapacityForTests()
    const env = { MULTIMODAL_MAX_CONCURRENT: '1', MULTIMODAL_RATE_LIMIT_PER_MINUTE: '3' }
    const release = acquireMultimodalCapacity(env)
    expect(release).toBeTypeOf('function')
    expect(acquireMultimodalCapacity(env)).toBeNull()
    release?.()
    expect(acquireMultimodalCapacity(env)).toBeTypeOf('function')
    resetMultimodalCapacityForTests()
  })
})
