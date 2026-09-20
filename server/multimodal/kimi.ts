import type { IncomingMessage } from 'node:http'
import {
  ANALYSIS_MODE_CONFIDENCE_CAP,
  type AnalysisMode,
} from '../../src/contracts/multimodalAnalysis.ts'
import type { GeminiMediaPart, PreparedMedia } from './media.ts'
import {
  callC01ContextResearch,
  callP02TextBreakdown,
  downstreamTextConfigFromEnv,
  type DownstreamTextConfig,
} from './downstreamText.ts'
import {
  MM01_RESPONSE_SCHEMA,
  P02_RESPONSE_SCHEMA,
  P02_SYSTEM_PROMPT,
  parseGeminiJsonCandidates,
} from './gemini.ts'
import { MM01_SYSTEM_PROMPT } from '../../src/prompts/mm01SystemPrompt.ts'
import {
  executeMultimodalPipeline,
  multimodalContextText,
  type EvidenceAvailability,
  type ModelCallResult,
  sanitizedReportedModel,
  type MultimodalSourceRequest,
} from './modelCore.ts'

const DEFAULT_API_BASE_URL = 'https://api.moonshot.cn/v1'
const BUILTIN_API_HOSTS = ['api.moonshot.cn', 'api.moonshot.cn'] as const
const DEFAULT_MODEL = 'kimi-k3'
const DEFAULT_MAX_REQUEST_BYTES = 18 * 1024 * 1024

export interface KimiConfig {
  apiKey: string
  apiBaseUrl: string
  model: string
  timeoutMs: number
  reasoningEffort?: 'low' | 'high' | 'max'
  allowedApiHosts?: string[]
  maxRequestBytes?: number
}

interface KimiResponse {
  model?: string
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string
      reasoning_content?: string
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cached_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  error?: { message?: string }
}

type KimiFailureCode =
  | 'KIMI_TIMEOUT'
  | 'KIMI_BLOCKED'
  | 'KIMI_UPSTREAM_FAILED'
  | 'KIMI_INVALID_OUTPUT'
  | 'KIMI_REQUEST_TOO_LARGE'
  | 'KIMI_UNSUPPORTED_MEDIA'

export class KimiServiceError extends Error {
  override name = 'KimiServiceError'
  readonly code: KimiFailureCode

  constructor(code: KimiFailureCode, message: string) {
    super(message)
    this.code = code
  }
}

function normalizeAllowedHost(rawHost: string): string {
  const candidate = rawHost.trim().toLowerCase()
  if (!candidate || candidate.includes('*')) {
    throw new Error('KIMI_API_ALLOWED_HOSTS 仅支持精确主机名，不支持通配符')
  }
  let url: URL
  try {
    url = new URL(`https://${candidate}`)
  } catch {
    throw new Error('KIMI_API_ALLOWED_HOSTS 包含无效主机名')
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.hostname.includes('.') ||
    !/^[a-z0-9.-]+$/.test(url.hostname) ||
    url.hostname.startsWith('.') ||
    url.hostname.endsWith('.') ||
    url.hostname.includes('..')
  ) {
    throw new Error('KIMI_API_ALLOWED_HOSTS 包含不安全的主机名')
  }
  return url.host.toLowerCase()
}

export function parseKimiAllowedApiHosts(rawValue?: string): string[] {
  if (!rawValue?.trim()) return []
  return [...new Set(rawValue.split(',').map(normalizeAllowedHost))]
}

export function validateKimiApiBaseUrl(
  rawUrl: string,
  additionalAllowedHosts: string[] = [],
): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('KIMI_API_BASE_URL 不是有效 URL')
  }
  if (url.protocol !== 'https:') throw new Error('KIMI_API_BASE_URL 必须使用 HTTPS')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('KIMI_API_BASE_URL 不允许账号信息、查询参数或片段')
  }
  const allowedHosts = new Set([
    ...BUILTIN_API_HOSTS,
    ...additionalAllowedHosts.map(normalizeAllowedHost),
  ])
  if (!allowedHosts.has(url.host.toLowerCase())) {
    throw new Error('KIMI_API_BASE_URL 主机不在显式 allowlist 中')
  }
  if (url.pathname === '/') url.pathname = '/v1'
  return url.toString().replace(/\/$/, '')
}

function parseReasoningEffort(
  value?: string,
): NonNullable<KimiConfig['reasoningEffort']> {
  const normalized = value?.trim().toLowerCase() || 'max'
  if (['low', 'high', 'max'].includes(normalized)) {
    return normalized as NonNullable<KimiConfig['reasoningEffort']>
  }
  throw new Error('KIMI_REASONING_EFFORT 仅支持 low / high / max')
}

export function kimiConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): KimiConfig {
  const allowedApiHosts = parseKimiAllowedApiHosts(env.KIMI_API_ALLOWED_HOSTS)
  const apiBaseUrl = validateKimiApiBaseUrl(
    env.KIMI_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
    allowedApiHosts,
  )
  const requestLimit = Number(env.KIMI_REQUEST_MAX_BYTES)
  return {
    apiKey: env.KIMI_API_KEY?.trim() ?? '',
    apiBaseUrl,
    model: env.KIMI_MULTIMODAL_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.KIMI_TIMEOUT_MS) || 300_000,
    reasoningEffort: parseReasoningEffort(env.KIMI_REASONING_EFFORT),
    allowedApiHosts,
    maxRequestBytes:
      Number.isFinite(requestLimit) && requestLimit > 0
        ? requestLimit
        : DEFAULT_MAX_REQUEST_BYTES,
  }
}

function runtimeKimiKey(request: Pick<IncomingMessage, 'headers'>): string {
  const raw = request.headers['x-intent-kimi-key']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.length <= 512 ? normalized : ''
}

/** Per-request keys override the server default and exist only in this call stack. */
export function kimiConfigForRequest(
  request: Pick<IncomingMessage, 'headers'>,
  env: Record<string, string | undefined> = process.env,
): KimiConfig {
  const config = kimiConfigFromEnv(env)
  return { ...config, apiKey: runtimeKimiKey(request) || config.apiKey }
}

function strictJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictJsonSchema)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const result = Object.fromEntries(
    Object.entries(source).map(([key, nested]) => [key, strictJsonSchema(nested)]),
  ) as Record<string, unknown>
  if (source.type === 'object') result.additionalProperties = false
  return result
}

type KimiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } }

function projectPart(part: GeminiMediaPart): KimiContentPart | null {
  if ('text' in part) return { type: 'text', text: part.text }
  const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
  if (part.inlineData.mimeType.startsWith('image/')) {
    return { type: 'image_url', image_url: { url: dataUrl } }
  }
  if (part.inlineData.mimeType.startsWith('video/')) {
    return { type: 'video_url', video_url: { url: dataUrl } }
  }
  return null
}

function orderedKimiParts(parts: GeminiMediaPart[]): KimiContentPart[] {
  const projected = parts
    .map((part) => ({ source: part, projected: projectPart(part) }))
    .filter(
      (entry): entry is { source: GeminiMediaPart; projected: KimiContentPart } =>
        Boolean(entry.projected),
    )
  const videos = projected.filter(
    (entry) =>
      'inlineData' in entry.source && entry.source.inlineData.mimeType.startsWith('video/'),
  )
  const rest = projected.filter((entry) => !videos.includes(entry))
  return [...videos, ...rest].map((entry) => entry.projected)
}

export interface KimiMediaProjection {
  media: PreparedMedia
  availability: EvidenceAvailability
  analysisMode: AnalysisMode
}

/**
 * Kimi Chat has no documented standalone audio content type. Only a video that
 * the local preparer positively marked as audio-free may remain a `video_url`;
 * otherwise the adapter falls back to extracted still frames.
 */
export function projectMediaForKimi(media: PreparedMedia): KimiMediaProjection {
  const parts = media.parts.filter(
    (part) =>
      !(
        'inlineData' in part &&
        (part.inlineData.mimeType.startsWith('audio/') ||
          (part.inlineData.mimeType.startsWith('video/') &&
            media.audioTrackRemoved !== true))
      ),
  )
  const removedStandaloneAudio = media.parts.some(
    (part) => 'inlineData' in part && part.inlineData.mimeType.startsWith('audio/'),
  )
  const removedUnverifiedVideo = media.parts.some(
    (part) =>
      'inlineData' in part &&
      part.inlineData.mimeType.startsWith('video/') &&
      media.audioTrackRemoved !== true,
  )
  const hasVideo = parts.some(
    (part) => 'inlineData' in part && part.inlineData.mimeType.startsWith('video/'),
  )
  const hasImage = parts.some(
    (part) => 'inlineData' in part && part.inlineData.mimeType.startsWith('image/'),
  )
  const visual = hasVideo || hasImage
  const sourceWasVideo = media.mode.startsWith('video_')
  const mode: PreparedMedia['mode'] = hasVideo
    ? hasImage
      ? 'video_inline_keyframes'
      : 'video_inline'
    : hasImage
      ? sourceWasVideo
        ? 'video_frames'
        : 'image_inline'
      : 'text_only'
  const warnings = [
    ...media.warnings,
    'Kimi K3 官方 Chat 协议未声明独立音频/ASR 输入；本次只允许可验证画面证据，声音结论必须标为缺失。',
  ]
  if (removedStandaloneAudio) {
    warnings.push('已从 Kimi 请求中移除独立音轨，避免伪造音频能力。')
  }
  if (removedUnverifiedVideo) {
    warnings.push('原视频未能确认已去除音轨，Kimi 本次只使用抽取的关键帧。')
  }
  const projectedMedia = {
    ...media,
    parts,
    mode,
    keyframeCount: sourceWasVideo
      ? media.keyframeCount
      : parts.filter(
          (part) =>
            'inlineData' in part && part.inlineData.mimeType.startsWith('image/'),
        ).length,
    warnings,
  }
  return {
    media: projectedMedia,
    availability: { visual, audio: false, asr: false },
    // The colleague-owned schema has no visual_frames enum. audio_frames is
    // the conservative medium-confidence bucket; audio status remains missing.
    analysisMode: visual ? 'audio_frames' : 'text_fallback',
  }
}

export function buildKimiMm01Body(
  request: MultimodalSourceRequest,
  projection: KimiMediaProjection,
  config: Pick<KimiConfig, 'model' | 'reasoningEffort'>,
  repairInstruction?: string,
): Record<string, unknown> {
  const confidenceCap = ANALYSIS_MODE_CONFIDENCE_CAP[projection.analysisMode]
  const content: KimiContentPart[] = [
    ...orderedKimiParts(projection.media.parts),
    {
      type: 'text',
      text: multimodalContextText(
        request,
        projection.media,
        projection.analysisMode,
        confidenceCap,
        projection.availability,
      ),
    },
    ...(repairInstruction ? [{ type: 'text' as const, text: repairInstruction }] : []),
  ]
  return {
    model: config.model,
    reasoning_effort: config.reasoningEffort ?? 'max',
    messages: [
      { role: 'system', content: MM01_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'mm01_multimodal_analysis_pack',
        strict: true,
        schema: strictJsonSchema(MM01_RESPONSE_SCHEMA),
      },
    },
    max_completion_tokens: 32_768,
    stream: false,
  }
}

export function buildKimiP02Body(
  handoff: { p02FormattedPrompt: string },
  config: Pick<KimiConfig, 'model' | 'reasoningEffort'>,
): Record<string, unknown> {
  return {
    model: config.model,
    reasoning_effort: config.reasoningEffort ?? 'max',
    messages: [
      { role: 'system', content: P02_SYSTEM_PROMPT },
      { role: 'user', content: handoff.p02FormattedPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'p02_video_breakdown',
        strict: true,
        schema: strictJsonSchema(P02_RESPONSE_SCHEMA),
      },
    },
    max_completion_tokens: 8_192,
    stream: false,
  }
}

async function callKimi(
  body: Record<string, unknown>,
  config: KimiConfig,
  fetchImpl: typeof fetch,
): Promise<ModelCallResult> {
  const apiBaseUrl = validateKimiApiBaseUrl(config.apiBaseUrl, config.allowedApiHosts)
  const endpoint = `${apiBaseUrl}/chat/completions`
  const requestBody = JSON.stringify(body)
  const maxRequestBytes = config.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES
  if (!Number.isFinite(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new KimiServiceError('KIMI_REQUEST_TOO_LARGE', 'Kimi request byte limit is invalid')
  }
  if (Buffer.byteLength(requestBody, 'utf8') > maxRequestBytes) {
    throw new KimiServiceError('KIMI_REQUEST_TOO_LARGE', 'Kimi request exceeds the configured byte limit')
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: requestBody,
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    if (/timeout|aborted|aborterror/i.test(error instanceof Error ? error.message : '')) {
      throw new KimiServiceError('KIMI_TIMEOUT', 'Kimi request timed out')
    }
    throw new KimiServiceError('KIMI_UPSTREAM_FAILED', 'Kimi request failed')
  }

  const data = (await response.json().catch(() => null)) as KimiResponse | null
  if (!response.ok) {
    throw new KimiServiceError('KIMI_UPSTREAM_FAILED', 'Kimi upstream rejected the request')
  }
  const choice = data?.choices?.[0]
  if (!data || !choice) {
    throw new KimiServiceError('KIMI_INVALID_OUTPUT', 'Kimi returned an invalid envelope')
  }
  if (choice.finish_reason === 'content_filter') {
    throw new KimiServiceError('KIMI_BLOCKED', 'Kimi blocked the request')
  }
  if (choice.finish_reason === 'length') {
    throw new KimiServiceError('KIMI_INVALID_OUTPUT', 'Kimi response was truncated')
  }
  const content = choice.message?.content?.trim()
  if (!content) {
    throw new KimiServiceError('KIMI_INVALID_OUTPUT', 'Kimi returned no final JSON content')
  }
  let candidates: unknown[]
  try {
    // Intentionally ignore reasoning_content: only final message.content is authoritative.
    candidates = parseGeminiJsonCandidates(content)
  } catch (error) {
    throw new KimiServiceError(
      'KIMI_INVALID_OUTPUT',
      error instanceof Error ? `Kimi returned invalid JSON: ${error.message}` : 'Kimi returned invalid JSON',
    )
  }
  return {
    candidates,
    reportedModel: sanitizedReportedModel(data.model),
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          cachedInputTokens:
            data.usage.cached_tokens ??
            data.usage.prompt_tokens_details?.cached_tokens,
        }
      : undefined,
  }
}

export async function analyzeWithKimi(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  config = kimiConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
  downstreamConfig: DownstreamTextConfig = downstreamTextConfigFromEnv(),
): ReturnType<typeof executeMultimodalPipeline> {
  if (!config.apiKey) throw new Error('未配置 KIMI_API_KEY')
  const projection = projectMediaForKimi(media)
  if (!projection.availability.visual) {
    throw new KimiServiceError(
      'KIMI_UNSUPPORTED_MEDIA',
      'Kimi requires usable video or image evidence for this strict pipeline',
    )
  }
  return executeMultimodalPipeline({
    provider: 'kimi',
    profile: 'kimi-k3',
    model: config.model,
    request,
    media: projection.media,
    policy: {
      analysisMode: projection.analysisMode,
      availability: projection.availability,
      enforceUnavailableModalities: true,
    },
    callMm01: (repairInstruction) =>
      callKimi(
        buildKimiMm01Body(request, projection, config, repairInstruction),
        config,
        fetchImpl,
      ),
    callC01: (mm01) =>
      callC01ContextResearch(mm01, downstreamConfig, fetchImpl),
    callP02: (handoff, mm01, contextResearch) =>
      callP02TextBreakdown(
        handoff,
        mm01,
        contextResearch,
        downstreamConfig,
        fetchImpl,
      ),
    invalidOutput: (detail) =>
      new KimiServiceError('KIMI_INVALID_OUTPUT', `Kimi ${detail}`),
    models: [
      { role: 'multimodal_synthesis', provider: 'kimi', model: config.model },
      {
        role: 'context_research',
        provider: 'downstream',
        model: downstreamConfig.c01Model,
      },
      { role: 'p02', provider: 'downstream', model: downstreamConfig.p02Model },
    ],
  })
}
