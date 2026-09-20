import type { Platform } from '../../src/contracts/multimodalAnalysis.ts'
import {
  analyzeImageWithGemini,
  imageGeminiConfigFromEnv,
  type ImageAnalysisResult,
  type ImageAnalysisSourceRequest,
} from './gemini.ts'
import {
  prepareMedia,
  type PrepareMediaOptions,
  type PreparedMedia,
} from '../multimodal/media.ts'
import type { GeminiConfig } from '../multimodal/gemini.ts'

const PLATFORMS = new Set<Platform>(['tiktok', 'meta', 'youtube', 'unknown'])

export interface ImageApiResult {
  status: number
  body: Record<string, unknown>
}

export interface AnalyzeImageDependencies {
  config?: GeminiConfig
  prepare?: typeof prepareMedia
  prepareOptions?: PrepareMediaOptions
  analyze?: typeof analyzeImageWithGemini
  fetchImpl?: typeof fetch
  onError?: (error: unknown) => void
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error('请求字段类型不正确')
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error('请求文本过长')
  return normalized || undefined
}

function optionalUrl(value: unknown, maxLength: number): string | undefined {
  const normalized = optionalString(value, maxLength)
  if (!normalized) return undefined
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('URL 字段格式不正确')
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password
  ) {
    throw new Error('URL 字段只允许无账号信息的 HTTP(S) 地址')
  }
  return url.toString()
}

function optionalUrls(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('图片 URL 字段必须是 URL 数组')
  if (value.length > 10) throw new Error('每个图片 URL 数组最多 10 项')
  const urls = value
    .map((item) => optionalUrl(item, 16_384))
    .filter((item): item is string => Boolean(item))
  return urls.length > 0 ? [...new Set(urls)] : undefined
}

function marketLanguages(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('marketLanguages 必须是最多 10 项的字符串数组')
  }
  const values = value.map((entry) => {
    const parsed = optionalString(entry, 64)
    if (!parsed) throw new Error('marketLanguages 不允许空项')
    return parsed
  })
  if (new Set(values).size !== values.length) {
    throw new Error('marketLanguages 不允许重复项')
  }
  return values
}

export function parseImageAnalysisRequest(
  value: unknown,
): ImageAnalysisSourceRequest {
  const data = record(value)
  if (!data) throw new Error('请求体必须是 JSON 对象')

  const platform = data.platform
  if (
    platform !== undefined &&
    (typeof platform !== 'string' || !PLATFORMS.has(platform as Platform))
  ) {
    throw new Error('platform 必须是 tiktok / meta / youtube / unknown')
  }

  const imageUrls =
    optionalUrls(data.imageUrls) ??
    optionalUrls(data.mediaUrls) ??
    (data.imageUrl || data.mediaUrl
      ? [
          optionalUrl(data.imageUrl ?? data.mediaUrl, 16_384),
        ].filter((url): url is string => Boolean(url))
      : undefined)

  if (!imageUrls?.length) {
    throw new Error('图片 IM01 需要 imageUrl / imageUrls / mediaUrl / mediaUrls')
  }

  return {
    sourceUrl: optionalUrl(data.sourceUrl, 4_096),
    imageUrl: imageUrls[0],
    imageUrls,
    platform: (platform as Platform | undefined) ?? 'unknown',
    marketId: optionalString(data.marketId, 128) ?? '',
    marketLanguages: marketLanguages(data.marketLanguages),
    title: optionalString(data.title, 2_000) ?? '',
    caption: optionalString(data.caption, 20_000) ?? '',
  }
}

function safeImageFailure(error: unknown): ImageApiResult {
  const message = error instanceof Error ? error.message : ''
  if (message === '未配置 GEMINI_API_KEY') {
    return {
      status: 503,
      body: {
        error: '未配置 GEMINI_API_KEY；图片 IM01 已跳过。',
        code: 'IM01_NOT_CONFIGURED',
      },
    }
  }
  if (message === 'IM01 需要可用图片输入') {
    return {
      status: 422,
      body: {
        error: 'IM01 未取得可用图片输入，请检查图片 URL 是否可下载。',
        code: 'IM01_MEDIA_UNAVAILABLE',
      },
    }
  }
  return {
    status: 502,
    body: {
      error: '图片 IM01 分析失败，请稍后重试。',
      code: 'IM01_ANALYSIS_FAILED',
    },
  }
}

export async function analyzeImageRequest(
  rawRequest: unknown,
  dependencies: AnalyzeImageDependencies = {},
): Promise<ImageApiResult> {
  const config = dependencies.config ?? imageGeminiConfigFromEnv()
  if (!config.apiKey) {
    return {
      status: 503,
      body: {
        error: '未配置 GEMINI_API_KEY；图片 IM01 已跳过。',
        code: 'IM01_NOT_CONFIGURED',
      },
    }
  }

  let request: ImageAnalysisSourceRequest
  try {
    request = parseImageAnalysisRequest(rawRequest)
  } catch (error) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : '请求不合法' },
    }
  }

  let media: PreparedMedia
  try {
    const prepare = dependencies.prepare ?? prepareMedia
    const imageUrl = request.imageUrl ?? request.imageUrls?.[0]
    if (!imageUrl) throw new Error('IM01 需要可用图片输入')
    const imageUrls = request.imageUrls ?? [imageUrl]
    media = await prepare(
      {
        mediaUrl: imageUrl,
        mediaUrls: imageUrls,
        imageUrls,
      },
      imageUrls.length > 1 ? 'carousel' : 'image',
      dependencies.prepareOptions,
    )
  } catch (error) {
    dependencies.onError?.(error)
    return {
      status: 422,
      body: {
        error: '图片下载或预处理失败，请检查图片 URL 是否可访问。',
        code: 'IM01_MEDIA_PREPARE_FAILED',
      },
    }
  }

  try {
    const analyze = dependencies.analyze ?? analyzeImageWithGemini
    const result: ImageAnalysisResult = await analyze(
      request,
      media,
      config,
      dependencies.fetchImpl,
    )
    return {
      status: 200,
      body: {
        analysis: result.analysis,
        diagnostics: result.diagnostics,
      },
    }
  } catch (error) {
    dependencies.onError?.(error)
    return safeImageFailure(error)
  } finally {
    await media.cleanup().catch((error) => dependencies.onError?.(error))
  }
}
