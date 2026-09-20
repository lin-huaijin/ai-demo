import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { providerRewriteTarget } from '../../api/provider.ts'

function request(url: string) {
  return { url } as IncomingMessage
}

describe('Vercel provider routing', () => {
  it('places explicit multi-segment provider rewrites before the SPA fallback', () => {
    const config = JSON.parse(
      readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'),
    ) as {
      rewrites: Array<{ source: string; destination: string }>
    }

    expect(config.rewrites).toEqual([
      {
        source: '/api/scrape/:path*',
        destination: '/api/provider?__provider=scrape&__path=:path*',
      },
      {
        source: '/api/foreplay/:path*',
        destination: '/api/provider?__provider=foreplay&__path=:path*',
      },
      { source: '/(.*)', destination: '/index.html' },
    ])
  })

  it('uses one static Function entry instead of raw catch-all filenames', () => {
    expect(existsSync(path.join(process.cwd(), 'api/provider.ts'))).toBe(true)
    expect(
      existsSync(path.join(process.cwd(), 'api/scrape/[...path].ts')),
    ).toBe(false)
    expect(
      existsSync(path.join(process.cwd(), 'api/foreplay/[...path].ts')),
    ).toBe(false)
  })

  it('restores ScrapeCreators and Foreplay paths without leaking route params', () => {
    expect(
      providerRewriteTarget(
        request(
          '/api/provider?__provider=scrape&__path=v2/tiktok/video&url=https%3A%2F%2Fexample.com%2Fvideo',
        ),
      ),
    ).toEqual({
      provider: 'scrape',
      url: '/api/scrape/v2/tiktok/video?url=https%3A%2F%2Fexample.com%2Fvideo',
    })
    expect(
      providerRewriteTarget(
        request(
          '/api/provider?__provider=foreplay&__path=discovery/ads&query=travel&limit=10',
        ),
      ),
    ).toEqual({
      provider: 'foreplay',
      url: '/api/foreplay/discovery/ads?query=travel&limit=10',
    })
    expect(
      providerRewriteTarget(
        request('/api/provider?__provider=unknown&__path=v1/example'),
      ),
    ).toBeNull()
  })
})
