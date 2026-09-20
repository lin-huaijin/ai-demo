import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  proxyProviderRequest,
  resetProviderCapacityForTests,
} from './proxy.ts'

function request(
  url: string,
  authorization = 'Bearer team-secret',
  providerKey?: string,
) {
  return {
    method: 'GET',
    url,
    headers: {
      authorization,
      ...(providerKey ? { 'x-intent-provider-key': providerKey } : {}),
    },
  } as IncomingMessage
}

function response() {
  let body = Buffer.alloc(0)
  const target = {
    statusCode: 0,
    setHeader() {},
    end(value?: string | Uint8Array) {
      body = value === undefined ? Buffer.alloc(0) : Buffer.from(value)
    },
  } as unknown as ServerResponse
  return { target, body: () => body.toString('utf8') }
}

describe('production provider proxy', () => {
  beforeEach(() => resetProviderCapacityForTests())

  it('requires the runtime team token before spending provider credits', async () => {
    const res = response()
    await proxyProviderRequest(
      'scrape',
      request('/api/scrape/v2/tiktok/video', ''),
      res.target,
      { NODE_ENV: 'production', MULTIMODAL_ACCESS_TOKEN: 'team-secret' },
    )
    expect(res.target.statusCode).toBe(401)
  })

  it('allows only documented read endpoints and keeps the provider key server-side', async () => {
    const res = response()
    const fetchMock = vi.fn(async (
      _url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.['x-api-key']).toBe('provider-key')
      expect(headers?.authorization).toBeUndefined()
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    await proxyProviderRequest(
      'scrape',
      request('/api/scrape/v2/tiktok/video?url=https%3A%2F%2Fexample.com'),
      res.target,
      {
        NODE_ENV: 'production',
        MULTIMODAL_ACCESS_TOKEN: 'team-secret',
        SCRAPECREATORS_API_KEY: 'provider-key',
      },
      fetchMock,
    )
    expect(res.target.statusCode).toBe(200)
    expect(JSON.parse(res.body())).toEqual({ ok: true })
  })

  it('uses a session-only provider key without exposing it in the URL', async () => {
    const res = response()
    const fetchMock = vi.fn(async (
      url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      expect(String(url)).not.toContain('session-provider-key')
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.['x-api-key']).toBe(
        'session-provider-key',
      )
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    await proxyProviderRequest(
      'scrape',
      request(
        '/api/scrape/v2/tiktok/video?url=https%3A%2F%2Fexample.com',
        'Bearer team-secret',
        'session-provider-key',
      ),
      res.target,
      {
        NODE_ENV: 'production',
        MULTIMODAL_ACCESS_TOKEN: 'team-secret',
      },
      fetchMock,
    )

    expect(res.target.statusCode).toBe(200)
  })

  it('rejects unknown query parameters instead of forwarding them', async () => {
    const res = response()
    const fetchMock = vi.fn() as typeof fetch
    await proxyProviderRequest(
      'scrape',
      request('/api/scrape/v2/tiktok/video?url=x&unexpected=true'),
      res.target,
      {
        NODE_ENV: 'production',
        MULTIMODAL_ACCESS_TOKEN: 'team-secret',
        SCRAPECREATORS_API_KEY: 'provider-key',
      },
      fetchMock,
    )
    expect(res.target.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clamps Foreplay limits and forces the paid transcript fallback off', async () => {
    const seen: URL[] = []
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      seen.push(new URL(String(url)))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const foreplay = response()
    await proxyProviderRequest(
      'foreplay',
      request('/api/foreplay/discovery/ads?query=test&limit=999&order=newest'),
      foreplay.target,
      {
        NODE_ENV: 'production',
        MULTIMODAL_ACCESS_TOKEN: 'team-secret',
        FOREPLAY_API_KEY: 'foreplay-key',
      },
      fetchMock,
    )
    const transcript = response()
    await proxyProviderRequest(
      'scrape',
      request(
        '/api/scrape/v1/tiktok/video/transcript?url=x&use_ai_as_fallback=true',
      ),
      transcript.target,
      {
        NODE_ENV: 'production',
        MULTIMODAL_ACCESS_TOKEN: 'team-secret',
        SCRAPECREATORS_API_KEY: 'scrape-key',
      },
      fetchMock,
    )
    expect(seen[0]?.searchParams.get('limit')).toBe('30')
    expect(seen[1]?.searchParams.get('use_ai_as_fallback')).toBe('false')
  })

  it('applies an independent per-minute provider request budget', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{}', { status: 200 }),
    ) as typeof fetch
    const env = {
      NODE_ENV: 'production',
      MULTIMODAL_ACCESS_TOKEN: 'team-secret',
      SCRAPECREATORS_API_KEY: 'provider-key',
      PROVIDER_RATE_LIMIT_PER_MINUTE: '1',
    }
    const first = response()
    await proxyProviderRequest(
      'scrape',
      request('/api/scrape/v2/tiktok/video?url=x'),
      first.target,
      env,
      fetchMock,
    )
    const second = response()
    await proxyProviderRequest(
      'scrape',
      request('/api/scrape/v2/tiktok/video?url=y'),
      second.target,
      env,
      fetchMock,
    )
    expect(first.target.statusCode).toBe(200)
    expect(second.target.statusCode).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows only a path-safe Foreplay ad id for signed-media refresh', async () => {
    const seen: URL[] = []
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      seen.push(new URL(String(url)))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const ok = response()
    await proxyProviderRequest(
      'foreplay',
      request('/api/foreplay/ad/ad_123-abc'),
      ok.target,
      {
        NODE_ENV: 'production',
        MULTIMODAL_ACCESS_TOKEN: 'team-secret',
        FOREPLAY_API_KEY: 'foreplay-key',
      },
      fetchMock,
    )
    expect(ok.target.statusCode).toBe(200)
    expect(seen[0]?.pathname).toBe('/api/ad/ad_123-abc')

    const blocked = response()
    await proxyProviderRequest(
      'foreplay',
      request('/api/foreplay/ad/ad_123/duplicates'),
      blocked.target,
      {
        NODE_ENV: 'production',
        MULTIMODAL_ACCESS_TOKEN: 'team-secret',
        FOREPLAY_API_KEY: 'foreplay-key',
      },
      fetchMock,
    )
    expect(blocked.target.statusCode).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
