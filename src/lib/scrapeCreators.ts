/** Dev-only proxy to ScrapeCreators (see vite.config.ts). */

import {
  buildStorySummary,
  inferMaterialTheme,
  transcriptToPlain,
} from './storyFromTranscript'
import { runtimeApiHeaders } from './apiAccess'

export type ScrapeHost = 'tiktok' | 'instagram' | 'facebook'

export function detectScrapeHost(url: string): ScrapeHost {
  const u = url.toLowerCase()
  if (u.includes('instagram.com')) return 'instagram'
  if (
    u.includes('facebook.com') ||
    u.includes('fb.watch') ||
    u.includes('fb.com')
  ) {
    return 'facebook'
  }
  return 'tiktok'
}

export type TranscriptStatus = 'ok' | 'missing' | 'failed' | 'skipped'

export interface ScrapedPost {
  host: ScrapeHost
  title: string
  caption: string
  author: string
  likes: number
  views: number
  isVideo: boolean
  mediaUrl: string
  mediaUrls: string[]
  /** Distinct source video assets (not CDN fallbacks for one video). */
  videoUrls: string[]
  /** Distinct source still-image assets. */
  imageUrls: string[]
  thumbnailUrl: string
  durationSeconds?: number
  transcript: string
  transcriptStatus: TranscriptStatus
  theme: string
  /** 50–200 字故事拆解 */
  story: string
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function num(...vals: unknown[]): number {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) {
      return Number(v)
    }
  }
  return 0
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function absoluteMediaUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  const raw = value.trim()
  const candidate = raw.startsWith('//') ? `https:${raw}` : raw
  try {
    const url = new URL(candidate)
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

function urlFromAddress(value: unknown): string {
  if (typeof value === 'string') return absoluteMediaUrl(value)
  const address = obj(value)
  const list = Array.isArray(address.url_list)
    ? address.url_list
    : Array.isArray(address.urlList)
      ? address.urlList
      : []
  // TikTok's `uri` is commonly an opaque video ID (for example v14044...),
  // while url_list contains the downloadable CDN addresses. Never promote an
  // opaque provider identifier into the server-side media downloader.
  return [address.url, ...list, address.uri]
    .map(absoluteMediaUrl)
    .find(Boolean) ?? ''
}

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values.map(absoluteMediaUrl).filter(Boolean))]
}

function seconds(value: unknown): number | undefined {
  const n = num(value)
  if (n <= 0) return undefined
  return n > 1_000 ? n / 1_000 : n
}

function clipTitle(text: string, author: string): string {
  const line = text.split(/\n/)[0]?.trim() || text.trim()
  const short = line.slice(0, 72) + (line.length > 72 ? '…' : '')
  if (short) return short
  return author ? `@${author} 热帖` : '已识别热帖'
}

async function scrapeGet(
  path: string,
  url: string,
  extra: Record<string, string> = {},
): Promise<unknown> {
  const qs = new URLSearchParams({ url, ...extra })
  if (path.includes('instagram/post')) qs.set('trim', 'true')
  const res = await fetch(`/api/scrape${path}?${qs.toString()}`, {
    headers: runtimeApiHeaders(
      { accept: 'application/json' },
      'scrapecreators',
    ),
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const msg =
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `HTTP ${res.status}`
    throw new Error(msg)
  }
  if (
    data &&
    typeof data === 'object' &&
    'success' in data &&
    (data as { success: unknown }).success === false
  ) {
    const msg =
      'message' in data &&
      typeof (data as { message: unknown }).message === 'string'
        ? (data as { message: string }).message
        : '识别失败'
    throw new Error(msg)
  }
  return data
}

function extractTranscriptField(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const root = data as Record<string, unknown>

  const direct = firstNonEmpty(root.transcript, root.text)
  if (direct) return transcriptToPlain(direct)

  const arr = root.transcripts
  if (Array.isArray(arr)) {
    const parts = arr
      .map((item) => {
        if (!item || typeof item !== 'object') return ''
        const o = item as Record<string, unknown>
        return firstNonEmpty(o.transcript, o.text)
      })
      .filter(Boolean)
    return transcriptToPlain(parts.join('\n'))
  }

  return ''
}

async function fetchTranscript(
  host: ScrapeHost,
  url: string,
  isVideo: boolean,
): Promise<{ text: string; status: TranscriptStatus }> {
  if (!isVideo) return { text: '', status: 'skipped' }
  try {
    let data: unknown
    if (host === 'tiktok') {
      data = await scrapeGet('/v1/tiktok/video/transcript', url, {
        // The multimodal model will inspect the original audio. Do not
        // silently spend ScrapeCreators AI-fallback credits here.
        use_ai_as_fallback: 'false',
      })
    } else if (host === 'instagram') {
      data = await scrapeGet('/v2/instagram/media/transcript', url)
    } else {
      data = await scrapeGet('/v1/facebook/post/transcript', url)
    }
    const text = extractTranscriptField(data)
    if (!text) return { text: '', status: 'missing' }
    return { text, status: 'ok' }
  } catch {
    return { text: '', status: 'failed' }
  }
}

function parseTikTok(data: unknown, host: ScrapeHost) {
  const root = data as {
    aweme_detail?: Record<string, unknown>
  }
  const a = root.aweme_detail || {}
  const stats = (a.statistics as Record<string, unknown>) || {}
  const authorObj = (a.author as Record<string, unknown>) || {}
  const author = firstNonEmpty(
    authorObj.unique_id,
    authorObj.nickname,
    authorObj.uniqueId,
  )
  const caption = firstNonEmpty(a.desc, a.title)
  const video = obj(a.video)
  const playAddress = firstNonEmpty(
    urlFromAddress(video.play_addr),
    urlFromAddress(video.playAddr),
  )
  const downloadAddress = firstNonEmpty(
    urlFromAddress(video.download_addr),
    urlFromAddress(video.downloadAddr),
  )
  const noWatermark = firstNonEmpty(
    urlFromAddress(video.download_no_watermark_addr),
    urlFromAddress(video.downloadNoWatermarkAddr),
    urlFromAddress(a.download_no_watermark_addr),
    urlFromAddress(a.downloadNoWatermarkAddr),
  )
  const imagePost = obj(a.image_post_info ?? a.imagePostInfo)
  const imageUrls = Array.isArray(imagePost.images)
    ? imagePost.images
        .map((image) => {
          const item = obj(image)
          return firstNonEmpty(
            urlFromAddress(item.display_image),
            urlFromAddress(item.origin_image),
            urlFromAddress(item.thumbnail),
          )
        })
        .filter(Boolean)
    : []
  const videoCandidates = uniqueUrls([
    noWatermark,
    playAddress,
    downloadAddress,
  ])
  // These are alternate CDN renditions of one TikTok video. Keep all as
  // transport fallbacks, but expose one semantic video asset in videoUrls.
  const videoUrls = imageUrls.length > 0 ? [] : videoCandidates.slice(0, 1)
  const mediaUrls =
    imageUrls.length > 0 ? uniqueUrls(imageUrls) : videoCandidates
  const thumbnailUrl = firstNonEmpty(
    urlFromAddress(video.cover),
    urlFromAddress(video.origin_cover),
    urlFromAddress(video.dynamic_cover),
    imageUrls[0],
  )
  const isVideo = videoUrls.length > 0 && imageUrls.length === 0
  return {
    host,
    author,
    caption,
    title: clipTitle(caption, author),
    likes: num(stats.digg_count, stats.diggCount),
    views: num(stats.play_count, stats.playCount),
    isVideo,
    mediaUrl: mediaUrls[0] ?? '',
    mediaUrls,
    videoUrls,
    imageUrls: uniqueUrls(imageUrls),
    thumbnailUrl,
    durationSeconds: seconds(video.duration ?? a.duration),
  }
}

function parseInstagram(data: unknown, host: ScrapeHost) {
  const root = data as Record<string, unknown>
  const media =
    (root.xdt_shortcode_media as Record<string, unknown>) ||
    ((root.data as Record<string, unknown> | undefined)
      ?.xdt_shortcode_media as Record<string, unknown>) ||
    root

  const edges =
    (
      (media.edge_media_to_caption as {
        edges?: { node?: { text?: string } }[]
      })?.edges
    ) || []
  const caption = firstNonEmpty(
    edges[0]?.node?.text,
    media.caption,
    media.title,
    media.accessibility_caption,
  )
  const owner = (media.owner as Record<string, unknown>) || {}
  const author = firstNonEmpty(owner.username, owner.full_name)
  const likes = num(
    (media.edge_media_preview_like as { count?: number })?.count,
    media.like_count,
  )
  const views = num(media.video_play_count, media.video_view_count)
  const sidecar = obj(media.edge_sidecar_to_children)
  const children = Array.isArray(sidecar.edges)
    ? sidecar.edges.map((edge) => obj(obj(edge).node))
    : []
  const rootVideoUrl = firstNonEmpty(media.video_url)
  const videoUrls = uniqueUrls([
    rootVideoUrl,
    ...children.map((node) => firstNonEmpty(node.video_url)),
  ])
  const rootImageUrl =
    children.length === 0 && !rootVideoUrl
      ? firstNonEmpty(media.display_url)
      : ''
  const imageUrls = uniqueUrls([
    rootImageUrl,
    ...children
      .filter((node) => !firstNonEmpty(node.video_url))
      .map((node) => firstNonEmpty(node.display_url)),
  ])
  // Downloadable evidence wins over stale provider type flags. Mixed
  // sidecars retain both videos and independently meaningful stills.
  const isVideo = videoUrls.length > 0
  const mediaUrls = uniqueUrls([...videoUrls, ...imageUrls])
  return {
    host,
    author,
    caption,
    title: clipTitle(caption, author),
    likes,
    views,
    isVideo,
    mediaUrl: mediaUrls[0] ?? '',
    mediaUrls,
    videoUrls,
    imageUrls,
    thumbnailUrl: firstNonEmpty(
      media.thumbnail_src,
      media.display_url,
      mediaUrls[0],
    ),
    durationSeconds: seconds(media.video_duration),
  }
}

function parseFacebook(data: unknown, host: ScrapeHost) {
  const root = data as Record<string, unknown>
  const authorObj = (root.author as Record<string, unknown>) || {}
  const author = firstNonEmpty(authorObj.name, authorObj.id)
  const caption = firstNonEmpty(root.description, root.message, root.text)
  const video = obj(root.video)
  const videoUrl = firstNonEmpty(
    video.hd_url,
    video.sd_url,
    video.browser_native_hd_url,
    video.browser_native_sd_url,
    video.playable_url_quality_hd,
    video.playable_url,
    typeof root.video === 'string' ? root.video : undefined,
  )
  const imageUrl = firstNonEmpty(root.image_url, root.full_picture)
  const videoUrls = uniqueUrls([videoUrl])
  // Facebook full_picture/image_url is normally a video poster, not a mixed
  // media card. Retain it as thumbnail evidence only when video is present.
  const imageUrls = videoUrl ? [] : uniqueUrls([imageUrl])
  const mediaUrls = uniqueUrls([...videoUrls, ...imageUrls])
  return {
    host,
    author,
    caption,
    title: clipTitle(caption, author),
    likes: num(root.like_count, root.likes),
    views: num(root.view_count, root.views),
    isVideo: Boolean(videoUrl),
    mediaUrl: mediaUrls[0] ?? '',
    mediaUrls,
    videoUrls,
    imageUrls,
    thumbnailUrl: firstNonEmpty(video.thumbnail, root.thumbnail, imageUrl),
    durationSeconds: seconds(
      video.length_in_second ?? root.length_in_second,
    ),
  }
}

export function parseScrapeDetails(data: unknown, host: ScrapeHost) {
  if (host === 'tiktok') return parseTikTok(data, host)
  if (host === 'instagram') return parseInstagram(data, host)
  return parseFacebook(data, host)
}

function withStory(
  base: Omit<ScrapedPost, 'transcript' | 'transcriptStatus' | 'theme' | 'story'>,
  transcript: string,
  transcriptStatus: TranscriptStatus,
): ScrapedPost {
  const theme = inferMaterialTheme(base.title, base.caption, transcript)
  const story = buildStorySummary({
    title: base.title,
    caption: base.caption,
    transcript,
    theme,
  })
  return {
    ...base,
    transcript,
    transcriptStatus,
    theme,
    story,
  }
}

export async function scrapePostByUrl(url: string): Promise<ScrapedPost> {
  const host = detectScrapeHost(url)

  let base: Omit<
    ScrapedPost,
    'transcript' | 'transcriptStatus' | 'theme' | 'story'
  >
  const path =
    host === 'tiktok'
      ? '/v2/tiktok/video'
      : host === 'instagram'
        ? '/v1/instagram/post'
        : '/v1/facebook/post'
  base = parseScrapeDetails(await scrapeGet(path, url), host)

  const { text, status } = await fetchTranscript(host, url, base.isVideo)
  return withStory(base, text, status)
}
