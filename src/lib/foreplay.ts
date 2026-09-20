import { runtimeApiHeaders } from './apiAccess'

/** Server-side proxy to the Foreplay Discovery ad library. */

export interface ForeplayAdCard {
  id?: string
  video?: string
  image?: string
  thumbnail?: string
  full_transcription?: string
}

export interface ForeplayAd {
  id: string
  ad_id?: string
  brand_id?: string
  name?: string
  headline?: string
  description?: string
  cta_title?: string
  display_format?: string
  is_video: boolean
  live?: boolean
  link_url?: string
  foreplay_url?: string
  publisher_platform?: string[]
  categories?: string[]
  niches?: string[]
  product_category?: string
  market_target?: string
  languages?: string[]
  emotional_drivers?: Record<string, number>
  started_running?: number
  running_duration?: number
  video_duration?: number
  thumbnail?: string
  image?: string
  video?: string
  full_transcription?: string
  cards?: ForeplayAdCard[]
}

export interface ForeplaySearchParams {
  query?: string
  niche?: string
  displayFormat?: '' | 'video' | 'image'
  publisherPlatform?: string
  limit?: number
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function normalizeCard(raw: unknown): ForeplayAdCard | null {
  const card = (raw ?? {}) as Record<string, unknown>
  const normalized = {
    id: str(card.id),
    video: str(card.video),
    image: str(card.image),
    thumbnail: str(card.thumbnail),
    full_transcription: str(card.full_transcription),
  }
  return normalized.video || normalized.image || normalized.thumbnail
    ? normalized
    : null
}

export function normalizeForeplayAd(raw: unknown): ForeplayAd {
  const a = (raw ?? {}) as Record<string, unknown>
  const cardSources = [a.cards, a.carousel_cards, a.dco_cards]
    .filter(Array.isArray)
    .flat() as unknown[]
  const cards = cardSources
    .map(normalizeCard)
    .filter((card): card is ForeplayAdCard => card !== null)
  const displayFormat = str(a.display_format)
  const isVideo =
    a.type === 'video' ||
    displayFormat?.toLowerCase() === 'video' ||
    Boolean(a.video) ||
    cards.some((card) => Boolean(card.video))
  return {
    id: String(a.id ?? a.ad_id ?? Math.random().toString(36).slice(2)),
    ad_id: str(a.ad_id),
    brand_id: str(a.brand_id),
    name: str(a.name),
    headline: str(a.headline),
    description: str(a.description),
    cta_title: str(a.cta_title),
    display_format: displayFormat,
    is_video: isVideo,
    live: typeof a.live === 'boolean' ? a.live : undefined,
    link_url: str(a.link_url),
    foreplay_url: str(a.foreplay_url),
    publisher_platform: Array.isArray(a.publisher_platform)
      ? (a.publisher_platform as string[])
      : undefined,
    categories: Array.isArray(a.categories)
      ? (a.categories as string[])
      : undefined,
    niches: Array.isArray(a.niches) ? (a.niches as string[]) : undefined,
    product_category: str(a.product_category),
    market_target: str(a.market_target),
    languages: Array.isArray(a.languages) ? (a.languages as string[]) : undefined,
    emotional_drivers:
      a.emotional_drivers && typeof a.emotional_drivers === 'object'
        ? (a.emotional_drivers as Record<string, number>)
        : undefined,
    started_running:
      typeof a.started_running === 'number' ? a.started_running : undefined,
    running_duration:
      typeof a.running_duration === 'number' ? a.running_duration : undefined,
    video_duration:
      typeof a.video_duration === 'number' ? a.video_duration : undefined,
    thumbnail: str(a.thumbnail),
    image: str(a.image),
    video: str(a.video),
    full_transcription: str(a.full_transcription),
    cards,
  }
}

/** Search the Foreplay Discovery ad library by keyword / niche / format / platform. */
export async function searchForeplayAds(
  params: ForeplaySearchParams,
): Promise<ForeplayAd[]> {
  const qs = new URLSearchParams()
  const query = params.query?.trim()
  const niche = params.niche?.trim()
  if (query) qs.set('query', query)
  if (niche) qs.set('niches', JSON.stringify([niche]))
  if (params.displayFormat) qs.set('display_format', params.displayFormat)
  if (params.publisherPlatform) {
    qs.set('publisher_platform', params.publisherPlatform)
  }
  qs.set('limit', String(params.limit ?? 10))
  qs.set('order', 'newest')

  const res = await fetch(`/api/foreplay/discovery/ads?${qs.toString()}`, {
    headers: runtimeApiHeaders({ accept: 'application/json' }, 'foreplay'),
  })
  const data: unknown = await res.json().catch(() => null)

  const meta =
    data && typeof data === 'object'
      ? (data as { metadata?: { success?: boolean; message?: string } }).metadata
      : undefined
  if (!res.ok || meta?.success === false) {
    const errMsg =
      (data as { error?: { message?: string } })?.error?.message ||
      meta?.message ||
      `HTTP ${res.status}`
    throw new Error(errMsg)
  }

  const list =
    data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)
      ? (data as { data: unknown[] }).data
      : []
  return list.map(normalizeForeplayAd)
}
