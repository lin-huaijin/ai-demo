import type {
  CrawlSource,
  HotItem,
  IntentFeature,
  Platform,
  ProduceForm,
  TopicTag,
} from '../types'
import type { ForeplayAd } from './foreplay'
import {
  detectScrapeHost,
  scrapePostByUrl,
  type ScrapedPost,
} from './scrapeCreators'
import { buildStorySummary, inferMaterialTheme } from './storyFromTranscript'
import {
  AUTO_MARKET_ID,
  UNKNOWN_MARKET_ID,
  inferLanguageMarket,
  resolveSourceMarket,
  targetMarketForSource,
} from './marketRouting'

export type RecognitionMode = 'live' | 'fallback'
export { AUTO_MARKET_ID, UNKNOWN_MARKET_ID } from './marketRouting'

export function detectPlatform(url: string): Platform {
  const host = detectScrapeHost(url)
  return host === 'tiktok' ? 'tiktok' : 'meta'
}

export function normalizeUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`
    const u = new URL(withProto)
    if (!u.hostname) return null
    return u.toString()
  } catch {
    return null
  }
}

export function extractUrls(text: string): string[] {
  const lines = text.split(/[\n\r]+/)
  const found: string[] = []
  const urlRe = /https?:\/\/[^\s<>"')\]]+/gi
  for (const line of lines) {
    const matches = line.match(urlRe)
    if (matches) {
      for (const m of matches) {
        const n = normalizeUrl(m.replace(/[.,;]+$/, ''))
        if (n) found.push(n)
      }
    } else {
      const n = normalizeUrl(line)
      if (n) found.push(n)
    }
  }
  return [...new Set(found)]
}

function inferSemantics(text: string, platform: Platform, isVideo: boolean) {
  const hay = text.toLowerCase()
  let topicTags: TopicTag[] = ['cross_culture']
  let formatFit: ProduceForm[] = isVideo
    ? ['video', 'chat']
    : ['poster', 'chat']
  let suggestedFeature: IntentFeature = 'live-caption'

  if (/travel|airport|trip|hotel|点餐|问路|机场|旅行/.test(hay)) {
    topicTags = ['travel', 'cross_culture']
    suggestedFeature = 'f2f'
    formatFit = ['video', 'chat']
  } else if (/group|community|invite|群聊|群组|社群|加群|邀请/.test(hay)) {
    topicTags = ['cross_culture']
    suggestedFeature = 'group-tutorial'
    formatFit = isVideo ? ['chat', 'video'] : ['chat', 'poster']
  } else if (/voice clone|own voice|声线|声音克隆|自己的声音|生成语音/.test(hay)) {
    topicTags = ['language_learning']
    suggestedFeature = 'translator'
    formatFit = ['video', 'chat']
  } else if (/pun|谐音|joke|meme|misunderstand|误会|社死/.test(hay)) {
    topicTags = ['language_learning', 'cross_culture']
    suggestedFeature = 'chat'
    formatFit = isVideo ? ['chat', 'video'] : ['chat', 'poster']
  } else if (
    /caption|subtitle|transcribe|live translate|听不懂|字幕|转录|同传|会议|演讲|讲座/.test(
      hay,
    )
  ) {
    topicTags = ['language_learning']
    suggestedFeature = 'live-caption'
    formatFit = ['video', 'poster']
  } else if (/learn|english|language|translate|学外语|翻译|kill a language/.test(hay)) {
    topicTags = ['language_learning']
    suggestedFeature = 'translator'
    formatFit = ['video', 'poster']
  } else if (/dance|challenge|choreo|纯表演/.test(hay)) {
    topicTags = []
    suggestedFeature = 'chat'
    formatFit = ['video']
  } else if (/recipe|cook|bake|air fryer|食谱|做饭/.test(hay)) {
    topicTags = []
    suggestedFeature = 'chat'
    formatFit = ['video', 'poster']
  } else if (platform === 'meta') {
    topicTags = ['cross_culture']
    suggestedFeature = 'chat'
    formatFit = isVideo ? ['chat', 'video'] : ['poster', 'chat']
  }

  return { topicTags, formatFit, suggestedFeature }
}

export function inferMarketIdFromMaterial(text: string): string {
  return inferLanguageMarket(text)?.marketId ?? UNKNOWN_MARKET_ID
}

function buildHotItem(args: {
  url: string
  marketId: string
  title: string
  oneLiner: string
  likes: number
  views: number
  isVideo: boolean
  recognition: RecognitionMode
  recognitionError?: string
  theme?: string
  transcript?: string
  transcriptStatus?: HotItem['transcriptStatus']
  caption?: string
  mediaUrl?: string
  mediaUrls?: string[]
  videoUrls?: string[]
  imageUrls?: string[]
  thumbnailUrl?: string
  mediaKind?: HotItem['mediaKind']
  durationSeconds?: number
  /** Override platform when it isn't derivable from the URL (e.g. Foreplay ads). */
  platform?: Platform
  /** Override dedupe key (defaults to the normalized URL). */
  dedupeKey?: string
  source?: CrawlSource
  idPrefix?: string
  landingUrl?: string
  runningDuration?: number
}): HotItem {
  const platform = args.platform ?? detectPlatform(args.url)
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
  const id = `${args.idPrefix ?? 'link'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const semanticText = `${args.theme ?? ''} ${args.title} ${args.oneLiner} ${args.transcript ?? ''}`
  const automaticVideoMarketIsPending =
    args.isVideo && args.marketId === AUTO_MARKET_ID
  const sourceMarket = resolveSourceMarket(
    automaticVideoMarketIsPending ? '' : args.isVideo ? (args.transcript ?? '') : '',
    automaticVideoMarketIsPending ? '' : `${args.caption ?? ''} ${args.title}`,
  )
  const targetMarket = targetMarketForSource(
    args.marketId,
    sourceMarket.sourceMarketId,
  )
  const { topicTags, formatFit, suggestedFeature } = inferSemantics(
    semanticText,
    platform,
    args.isVideo,
  )

  return {
    id,
    ...sourceMarket,
    ...targetMarket,
    marketSelection: args.marketId === AUTO_MARKET_ID ? 'auto' : 'explicit',
    platform,
    title: args.title,
    likes: args.likes,
    views: args.views,
    source: args.source ?? 'topic_tag',
    topicTags,
    formatFit,
    oneLiner: args.oneLiner,
    suggestedFeature,
    collectedAt: stamp,
    dedupeKey: args.dedupeKey ?? args.url.split('?')[0].toLowerCase(),
    sourceUrl: args.url,
    mediaUrl: args.mediaUrl,
    mediaUrls: args.mediaUrls,
    videoUrls: args.videoUrls,
    imageUrls: args.imageUrls,
    thumbnailUrl: args.thumbnailUrl,
    mediaKind: args.mediaKind,
    durationSeconds: args.durationSeconds,
    caption: args.caption,
    landingUrl: args.landingUrl,
    runningDuration: args.runningDuration,
    recognition: args.recognition,
    recognitionError: args.recognitionError,
    theme: args.theme,
    transcript: args.transcript,
    providerTranscript: args.isVideo ? args.transcript : undefined,
    transcriptStatus: args.transcriptStatus,
    transcriptSource: args.isVideo && args.transcript ? 'provider' : 'none',
  }
}

function mediaKindFromAssets(
  videoUrls: string[],
  imageUrls: string[],
): NonNullable<HotItem['mediaKind']> {
  if (videoUrls.length > 1 || (videoUrls.length > 0 && imageUrls.length > 0)) {
    return 'mixed'
  }
  if (videoUrls.length === 1) return 'video'
  if (imageUrls.length > 1) return 'carousel'
  if (imageUrls.length === 1) return 'image'
  return 'text'
}

function fromScraped(
  url: string,
  marketId: string,
  post: ScrapedPost,
): HotItem {
  const withAuthor =
    post.author && !post.title.includes(post.author)
      ? `${post.title} · @${post.author}`
      : post.title
  return buildHotItem({
    url,
    marketId,
    title: withAuthor,
    oneLiner: post.story,
    likes: post.likes,
    views: post.views,
    isVideo: post.isVideo,
    recognition: 'live',
    theme: post.theme,
    transcript: post.transcript || undefined,
    transcriptStatus: post.transcriptStatus,
    caption: post.caption,
    mediaUrl: post.mediaUrl || undefined,
    mediaUrls: post.mediaUrls,
    videoUrls: post.videoUrls,
    imageUrls: post.imageUrls,
    thumbnailUrl: post.thumbnailUrl || undefined,
    mediaKind: mediaKindFromAssets(post.videoUrls, post.imageUrls),
    durationSeconds: post.durationSeconds,
  })
}

/** 识别失败时的兜底：仍可手工改文案后重拆解 */
function fallbackFromUrl(url: string, marketId: string, error: string): HotItem {
  const platform = detectPlatform(url)
  let pathHint = ''
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (path && path.length > 3) pathHint = decodeURIComponent(path).slice(0, 28)
  } catch {
    /* ignore */
  }
  const title = pathHint
    ? `识别失败 · ${pathHint}`
    : `识别失败 · ${platform === 'tiktok' ? 'TikTok' : 'Meta'}`
  const theme = inferMaterialTheme(title, '', '')
  const oneLiner = buildStorySummary({
    title,
    caption: '',
    transcript: '',
    theme,
  })
  return buildHotItem({
    url,
    marketId,
    title,
    oneLiner,
    likes: 0,
    views: 0,
    isVideo: true,
    recognition: 'fallback',
    recognitionError: error,
    theme,
    transcriptStatus: 'failed',
  })
}

/** 真实识别：帖文元数据 + 字幕 → 主题 / 50–200 字故事 */
export async function recognizePostFromUrl(
  url: string,
  marketId: string,
): Promise<HotItem> {
  try {
    const post = await scrapePostByUrl(url)
    return fromScraped(url, marketId, post)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    return fallbackFromUrl(url, marketId, msg)
  }
}

function pick(...vals: (string | undefined)[]): string {
  for (const v of vals) {
    if (v && v.trim()) return v.trim()
  }
  return ''
}

/** Foreplay ads carry `publisher_platform`; map it onto the demo's Platform. */
function platformFromForeplay(platforms?: string[]): Platform {
  const arr = (platforms ?? []).map((p) => p.toLowerCase())
  return arr.some((p) => p.includes('tiktok')) ? 'tiktok' : 'meta'
}

/**
 * Foreplay Discovery ad → HotItem。Foreplay 每条广告已自带字幕（full_transcription）、
 * 素材直链与情绪信号，无需再单独抓字幕。
 */
export function hotItemFromForeplayAd(
  ad: ForeplayAd,
  marketId: string,
): HotItem {
  const platform = platformFromForeplay(ad.publisher_platform)
  const cardVideos = (ad.cards ?? [])
    .map((card) => card.video)
    .filter(Boolean) as string[]
  const cardImages = (ad.cards ?? [])
    .filter((card) => !card.video)
    .map((card) => card.image)
    .filter(Boolean) as string[]
  const videoUrls = [
    ...new Set([ad.video, ...cardVideos].filter(Boolean) as string[]),
  ]
  // A top-level image next to a video is normally the poster. Independently
  // meaningful mixed-media stills are represented by cards.
  const topLevelImages = videoUrls.length > 0 ? [] : [ad.image]
  const directImageUrls = [
    ...new Set([...topLevelImages, ...cardImages].filter(Boolean) as string[]),
  ]
  const thumbnailUrls = [
    ...new Set(
      [ad.thumbnail, ...(ad.cards ?? []).map((card) => card.thumbnail)].filter(
        Boolean,
      ) as string[],
    ),
  ]
  // is_video is provider metadata; use downloadable assets for routing. When
  // a signed video URL is absent, retain the best still/thumbnail as an image.
  const imageUrls =
    directImageUrls.length > 0
      ? directImageUrls
      : videoUrls.length === 0
        ? thumbnailUrls
        : []
  const isVideo = videoUrls.length > 0
  const brandName = pick(ad.name, ad.brand_id)
  const title = pick(ad.name, ad.headline, ad.description) || 'Foreplay 广告'
  const caption = pick(ad.description, ad.headline)
  const transcript = transcriptToPlainSafe(
    [
      ad.full_transcription,
      ...(ad.cards ?? []).map((card) => card.full_transcription),
    ]
      .filter(Boolean)
      .join('\n'),
  )
  const mediaUrls = [...new Set([...videoUrls, ...imageUrls])]
  const materialUrl = mediaUrls[0] || undefined
  const thumbnail =
    pick(
      ad.thumbnail,
      ...(ad.cards ?? []).map((card) => card.thumbnail),
      imageUrls[0],
    ) || undefined
  const theme =
    pick(ad.product_category, ad.niches?.[0]) ||
    inferMaterialTheme(title, caption, transcript)
  const story = buildStorySummary({ title, caption, transcript, theme })

  const withBrand =
    brandName && !title.includes(brandName) ? `${title} · ${brandName}` : title

  return buildHotItem({
    url: ad.foreplay_url ?? `https://app.foreplay.co/ad/${ad.id}`,
    marketId,
    title: withBrand,
    oneLiner: story,
    likes: 0,
    views: 0,
    isVideo,
    recognition: 'live',
    theme,
    transcript: transcript || undefined,
    transcriptStatus: isVideo ? (transcript ? 'ok' : 'missing') : 'skipped',
    caption,
    mediaUrl: materialUrl,
    mediaUrls,
    videoUrls,
    imageUrls,
    thumbnailUrl: thumbnail,
    mediaKind: mediaKindFromAssets(videoUrls, imageUrls),
    durationSeconds: ad.video_duration,
    platform,
    dedupeKey: `foreplay:${ad.id}`.toLowerCase(),
    source: 'topic_tag',
    idPrefix: 'foreplay',
    landingUrl: ad.link_url,
    runningDuration: ad.running_duration,
  })
}

function transcriptToPlainSafe(raw?: string): string {
  if (!raw) return ''
  return raw.replace(/\s+/g, ' ').trim()
}
