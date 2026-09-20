import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseScrapeDetails, scrapePostByUrl } from './scrapeCreators'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ScrapeCreators media normalization', () => {
  it('keeps TikTok direct media while treating CDN renditions as fallbacks', () => {
    const post = parseScrapeDetails(
      {
        aweme_detail: {
          desc: 'Airport misunderstanding',
          video: {
            duration: 12_500,
            download_no_watermark_addr: {
              uri: 'v14044g50000opaque-provider-id',
              url_list: ['https://cdn.example/no-watermark.mp4'],
            },
            play_addr: {
              uri: 'v14044g50000another-provider-id',
              url_list: ['https://cdn.example/play.mp4'],
            },
            download_addr: {
              url_list: ['https://cdn.example/download.mp4'],
            },
            cover: { url_list: ['https://cdn.example/cover.jpg'] },
          },
          author: { unique_id: 'creator' },
          statistics: { digg_count: 12, play_count: 34 },
        },
      },
      'tiktok',
    )

    expect(post.mediaUrl).toBe('https://cdn.example/no-watermark.mp4')
    expect(post.mediaUrls).toEqual([
      'https://cdn.example/no-watermark.mp4',
      'https://cdn.example/play.mp4',
      'https://cdn.example/download.mp4',
    ])
    expect(post.videoUrls).toEqual([
      'https://cdn.example/no-watermark.mp4',
    ])
    expect(post.imageUrls).toEqual([])
    expect(post.thumbnailUrl).toBe('https://cdn.example/cover.jpg')
    expect(post.durationSeconds).toBe(12.5)
    expect(post.isVideo).toBe(true)
  })

  it('keeps both videos and stills from an Instagram mixed sidecar', () => {
    const post = parseScrapeDetails(
      {
        display_url: 'https://cdn.example/lead.jpg',
        edge_sidecar_to_children: {
          edges: [
            {
              node: {
                video_url: 'https://cdn.example/card.mp4',
                display_url: 'https://cdn.example/card.jpg',
              },
            },
            { node: { display_url: 'https://cdn.example/still.jpg' } },
          ],
        },
      },
      'instagram',
    )

    expect(post.isVideo).toBe(true)
    expect(post.videoUrls).toEqual(['https://cdn.example/card.mp4'])
    expect(post.imageUrls).toEqual(['https://cdn.example/still.jpg'])
    expect(post.mediaUrls).toEqual([
      'https://cdn.example/card.mp4',
      'https://cdn.example/still.jpg',
    ])
    expect(post.thumbnailUrl).toBe('https://cdn.example/lead.jpg')
  })

  it('does not request ScrapeCreators paid AI transcript fallback', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = String(input)
      if (requestUrl.includes('/transcript')) {
        return new Response(JSON.stringify({ transcript: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          aweme_detail: {
            desc: 'Silent visual story',
            video: {
              play_addr: {
                url_list: ['https://cdn.example/direct.mp4'],
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await scrapePostByUrl('https://www.tiktok.com/@creator/video/123')

    const transcriptRequest = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/transcript'))
    expect(transcriptRequest).toBeDefined()
    const parsed = new URL(transcriptRequest!, 'https://intent.local')
    expect(parsed.searchParams.get('use_ai_as_fallback')).toBe('false')
  })
})
