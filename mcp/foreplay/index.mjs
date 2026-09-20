#!/usr/bin/env node
/**
 * Local MCP wrapper around the Foreplay Ad Library REST API.
 *
 * Exposes clean, typed tools so local agents can
 * search competitor ads by keyword / niche / format instead of scraping a URL.
 *
 * Auth: set FOREPLAY_API_KEY in the environment. The key is sent in the
 * `Authorization` header (no "Bearer" prefix), matching the Foreplay REST API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE_URL = process.env.FOREPLAY_BASE_URL || 'https://public.api.foreplay.co'
const API_KEY = process.env.FOREPLAY_API_KEY || ''

/** Fields we surface by default — rich enough for a breakdown pipeline, small enough for context. */
function trimAd(ad) {
  if (!ad || typeof ad !== 'object') return ad
  const isVideo =
    ad.type === 'video' ||
    String(ad.display_format || '').toLowerCase() === 'video' ||
    Boolean(ad.video)
  return {
    id: ad.id,
    ad_id: ad.ad_id,
    brand_id: ad.brand_id,
    name: ad.name,
    headline: ad.headline,
    description: ad.description,
    cta_title: ad.cta_title,
    cta_type: ad.cta_type,
    display_format: ad.display_format,
    is_video: isVideo,
    live: ad.live,
    link_url: ad.link_url,
    publisher_platform: ad.publisher_platform,
    categories: ad.categories,
    niches: ad.niches,
    product_category: ad.product_category,
    market_target: ad.market_target,
    languages: ad.languages,
    persona: ad.persona,
    emotional_drivers: ad.emotional_drivers,
    started_running: ad.started_running,
    running_duration: ad.running_duration,
    video_duration: ad.video_duration,
    thumbnail: ad.thumbnail,
    image: ad.image,
    video: ad.video,
    full_transcription: ad.full_transcription,
  }
}

function buildQuery(params) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      // Foreplay expects JSON-encoded arrays for fields like `niches`.
      qs.set(key, JSON.stringify(value))
    } else {
      qs.set(key, String(value))
    }
  }
  return qs.toString()
}

async function foreplayGet(path, params, { raw = false } = {}) {
  if (!API_KEY) {
    throw new Error(
      'FOREPLAY_API_KEY is not set. Add it to the MCP server env in ~/.cursor/mcp.json.',
    )
  }
  const qs = buildQuery(params)
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: API_KEY, accept: 'application/json' },
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Foreplay returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok || json?.metadata?.success === false) {
    const msg =
      json?.error?.message || json?.metadata?.message || `HTTP ${res.status}`
    throw new Error(`Foreplay API error: ${msg}`)
  }
  const data = Array.isArray(json?.data) ? json.data : []
  const ads = raw ? data : data.map(trimAd)
  return {
    count: json?.metadata?.count ?? ads.length,
    cursor: json?.metadata?.cursor ?? null,
    creditsRemaining: res.headers.get('x-credits-remaining'),
    creditCost: res.headers.get('x-credit-cost'),
    data: ads,
  }
}

function ok(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function fail(err) {
  const message = err instanceof Error ? err.message : String(err)
  return { isError: true, content: [{ type: 'text', text: message }] }
}

const server = new McpServer({ name: 'foreplay', version: '0.1.0' })

server.registerTool(
  'foreplay_search_ads',
  {
    title: 'Search Foreplay Discovery ads',
    description:
      'Search the Foreplay Discovery ad library (200M+ ads) by keyword, niche, product category, format (image/video), platform, market and more. Each ad includes creative URLs (image/video), transcript, emotional drivers and persona. Use this to source competitor creatives instead of scraping a single URL.',
    inputSchema: {
      query: z.string().optional().describe('Free-text keyword, e.g. "skincare".'),
      niches: z
        .array(z.string())
        .optional()
        .describe('Niche filters, e.g. ["accessories"].'),
      product_category: z.string().optional(),
      display_format: z
        .enum(['video', 'image'])
        .optional()
        .describe('Restrict to video or image ads.'),
      publisher_platform: z
        .string()
        .optional()
        .describe('e.g. facebook, instagram, tiktok, youtube.'),
      market_target: z.enum(['b2c', 'b2b']).optional(),
      languages: z.string().optional().describe('e.g. "en".'),
      live: z.boolean().optional().describe('Only currently-running ads.'),
      order: z.string().optional().describe('e.g. "newest".'),
      limit: z.number().int().min(1).max(50).optional().default(10),
      offset: z.number().int().min(0).optional(),
      cursor: z.string().optional().describe('Cursor from a previous response for pagination.'),
      raw: z.boolean().optional().describe('Return full ad objects instead of the trimmed set.'),
    },
  },
  async ({ raw, ...params }) => {
    try {
      return ok(await foreplayGet('/api/discovery/ads', params, { raw }))
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'foreplay_swipefile_ads',
  {
    title: 'Get Foreplay Swipe File ads',
    description:
      "Retrieve ads saved in the authenticated user's Foreplay swipe file, with the same filters as Discovery (format, platform, niche, date range, etc.).",
    inputSchema: {
      start_date: z.string().optional().describe('e.g. "2024-11-12 00:00:00".'),
      end_date: z.string().optional(),
      live: z.boolean().optional(),
      display_format: z.enum(['video', 'image']).optional(),
      publisher_platform: z.string().optional(),
      niches: z.array(z.string()).optional(),
      market_target: z.enum(['b2c', 'b2b']).optional(),
      languages: z.string().optional(),
      order: z.string().optional().default('saved_newest'),
      limit: z.number().int().min(1).max(50).optional().default(10),
      offset: z.number().int().min(0).optional(),
      raw: z.boolean().optional(),
    },
  },
  async ({ raw, ...params }) => {
    try {
      return ok(await foreplayGet('/api/swipefile/ads', params, { raw }))
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'foreplay_spyder_brands',
  {
    title: 'List Foreplay Spyder brands',
    description:
      'List the brands tracked in the authenticated user\'s Foreplay Spyder. Returns brand ids/names usable to fetch that brand\'s ads.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().default(10),
      offset: z.number().int().min(0).optional(),
    },
  },
  async (params) => {
    try {
      return ok(await foreplayGet('/api/spyder/brands', params, { raw: true }))
    } catch (e) {
      return fail(e)
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
