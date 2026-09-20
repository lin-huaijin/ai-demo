import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createLocalArtifactStore } from './store.ts'
import { artifactApiPlugin, artifactStoreFromEnv } from './vitePlugin.ts'

function captureMiddleware(env: Record<string, string | undefined>) {
  const store = createLocalArtifactStore({
    rootDir: resolve(process.cwd(), '.tmp-multimodal', 'artifact-plugin-test'),
    projectId: 'default',
  })
  const plugin = artifactApiPlugin(env, store)
  let middleware:
    | ((request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>)
    | undefined
  const configure = plugin.configureServer
  if (typeof configure !== 'function') throw new Error('missing configureServer hook')
  configure({
    middlewares: {
      use: (handler: typeof middleware) => {
        middleware = handler
      },
    },
  } as never)
  if (!middleware) throw new Error('missing artifact middleware')
  return middleware
}

async function requestMiddleware(
  middleware: ReturnType<typeof captureMiddleware>,
  url: string,
  headers: Record<string, string> = {},
) {
  let text = ''
  const response = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: (body: string) => {
      text = body
    },
  } as unknown as ServerResponse
  await middleware(
    {
      url,
      method: 'GET',
      headers,
      socket: { remoteAddress: '127.0.0.1' },
    } as IncomingMessage,
    response,
    vi.fn(),
  )
  return { status: response.statusCode, body: JSON.parse(text) as Record<string, unknown> }
}

describe('artifact Vite configuration', () => {
  it('enables the local durable archive by default', () => {
    const store = artifactStoreFromEnv({})
    expect(store?.projectId).toBe('default')
    expect(store?.rootDir).toBe(resolve(process.cwd(), '.portfolio-data'))
  })

  it('uses an explicit project and data root', () => {
    const store = artifactStoreFromEnv({
      PORTFOLIO_PROJECT_ID: 'campaign_2026',
      PORTFOLIO_ARTIFACT_ROOT: './private-artifacts',
    })
    expect(store?.projectId).toBe('campaign_2026')
    expect(store?.rootDir).toBe(resolve(process.cwd(), 'private-artifacts'))
  })

  it('stays disabled on ephemeral deployments unless explicitly enabled', () => {
    expect(artifactStoreFromEnv({ VERCEL: '1' })).toBeUndefined()
    expect(
      artifactStoreFromEnv({
        VERCEL: '1',
        PORTFOLIO_ARTIFACTS_ENABLED: 'true',
      }),
    ).toBeDefined()
  })

  it('protects archive data with the existing team access token', async () => {
    const middleware = captureMiddleware({ MULTIMODAL_ACCESS_TOKEN: 'team-secret' })
    const result = await requestMiddleware(middleware, '/api/artifacts')
    expect(result).toMatchObject({
      status: 401,
      body: { code: 'MULTIMODAL_ACCESS_REQUIRED' },
    })
  })

  it('does not allow the URL to escape the configured project', async () => {
    const middleware = captureMiddleware({ MULTIMODAL_ACCESS_TOKEN: 'team-secret' })
    const result = await requestMiddleware(
      middleware,
      '/api/artifacts/projects/other/assets/asset_123',
      { authorization: 'Bearer team-secret' },
    )
    expect(result).toMatchObject({
      status: 404,
      body: { code: 'ARTIFACT_NOT_FOUND' },
    })
  })
})
