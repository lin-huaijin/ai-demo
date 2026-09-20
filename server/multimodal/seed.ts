import type { IncomingMessage } from 'node:http'
import {
  ANALYSIS_MODE_CONFIDENCE_CAP,
  type P02FormattedPromptCompilerOutput,
} from '../../src/contracts/multimodalAnalysis.ts'
import {
  P02_SYSTEM_PROMPT,
  parseGeminiJsonCandidates,
} from './gemini.ts'
import { MM01_SYSTEM_PROMPT } from '../../src/prompts/mm01SystemPrompt.ts'
import type { GeminiMediaPart, PreparedMedia } from './media.ts'
import {
  callC01ContextResearch,
  callP02TextBreakdown,
  downstreamTextConfigFromEnv,
  type DownstreamTextConfig,
} from './downstreamText.ts'
import {
  analysisModeForPreparedMedia,
  executeMultimodalPipeline,
  multimodalContextText,
  type ModelCallResult,
  type ModelTokenUsage,
  sanitizedReportedModel,
  type MultimodalSourceRequest,
} from './modelCore.ts'

const DEFAULT_API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEFAULT_API_HOST = 'ark.cn-beijing.volces.com'
const DEFAULT_MODEL = 'doubao-seed-2-1-pro-260628'
const DEFAULT_VIDEO_FPS = 2
const DEFAULT_MAX_REQUEST_BYTES = 18 * 1024 * 1024
const MAX_RESPONSE_TEXT_CHARS = 512 * 1024
const MAX_VISUAL_REPORT_CHARS = 256 * 1024
const MAX_VISUAL_FIELD_CHARS = 2_000
const MAX_VISUAL_LIST_ITEMS = 24
const MAX_VISUAL_LIST_ITEM_CHARS = 1_000
const MAX_SEQUENCE_OBSERVATIONS = 80

export interface SeedConfig {
  apiKey: string
  apiBaseUrl: string
  model: string
  /** Optional Ark inference endpoint ID; when present it is the request model ID. */
  inferenceEndpointId?: string
  videoFps: number
  timeoutMs: number
  allowedApiHosts?: string[]
  maxRequestBytes?: number
}

type SeedFailureCode =
  | 'SEED_TIMEOUT'
  | 'SEED_BLOCKED'
  | 'SEED_INCOMPLETE'
  | 'SEED_UPSTREAM_FAILED'
  | 'SEED_INVALID_OUTPUT'
  | 'SEED_REQUEST_TOO_LARGE'
  | 'SEED_UNSUPPORTED_MEDIA'

export class SeedServiceError extends Error {
  override name = 'SeedServiceError'
  readonly code: SeedFailureCode

  constructor(code: SeedFailureCode, message: string) {
    super(message)
    this.code = code
  }
}

interface SeedResponsesEnvelope {
  model?: string
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string; refusal?: string }>
  }>
  status?: string
  error?: { message?: string }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
  }
}

export interface SeedVisualFrame {
  frameId: string
  timeLabel: string
  mimeType: string
  data: string
}

export interface SeedVisualVideo {
  mimeType: string
  data: string
}

export interface SeedMediaProjection {
  media: PreparedMedia
  frames: SeedVisualFrame[]
  videos: SeedVisualVideo[]
}

export interface SeedVisualObservation {
  frameId: string
  people: string
  actions: string
  objects: string
  setting: string
  composition: string
  camera: string
  lighting: string
  color: string
  visibleText: string[]
  uncertainties: string[]
}

export interface SeedVisualDetailReport {
  module: 'SEED_VISUAL_DETAIL_REPORT'
  observations: SeedVisualObservation[]
  sequenceObservations: Array<{
    timeRange: string
    motionOrActions: string
    cameraOrTransition: string
    visibleText: string[]
    uncertainties: string[]
  }>
}

export type SeedVisualInputMode =
  | 'video_and_keyframes'
  | 'video_only'
  | 'keyframes_only'
  | 'images'

function normalizeAllowedHost(rawHost: string): string {
  const candidate = rawHost.trim().toLowerCase()
  if (!candidate || candidate.includes('*')) {
    throw new Error('SEED_API_ALLOWED_HOSTS 仅支持精确主机名，不支持通配符')
  }
  let url: URL
  try {
    url = new URL(`https://${candidate}`)
  } catch {
    throw new Error('SEED_API_ALLOWED_HOSTS 包含无效主机名')
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
    throw new Error('SEED_API_ALLOWED_HOSTS 包含不安全的主机名')
  }
  return url.host.toLowerCase()
}

export function parseSeedAllowedApiHosts(rawValue?: string): string[] {
  if (!rawValue?.trim()) return []
  return [...new Set(rawValue.split(',').map(normalizeAllowedHost))]
}

export function validateSeedApiBaseUrl(
  rawUrl: string,
  additionalAllowedHosts: string[] = [],
): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('SEED_API_BASE_URL 不是有效 URL')
  }
  if (url.protocol !== 'https:') throw new Error('SEED_API_BASE_URL 必须使用 HTTPS')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('SEED_API_BASE_URL 不允许账号信息、查询参数或片段')
  }
  const allowedHosts = new Set([
    DEFAULT_API_HOST,
    ...additionalAllowedHosts.map(normalizeAllowedHost),
  ])
  if (!allowedHosts.has(url.host.toLowerCase())) {
    throw new Error('SEED_API_BASE_URL 主机不在显式 allowlist 中')
  }
  return url.toString().replace(/\/$/, '')
}

export function seedConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SeedConfig {
  const allowedApiHosts = parseSeedAllowedApiHosts(env.SEED_API_ALLOWED_HOSTS)
  const apiBaseUrl = validateSeedApiBaseUrl(
    env.SEED_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
    allowedApiHosts,
  )
  const requestLimit = Number(env.SEED_REQUEST_MAX_BYTES)
  const inferenceEndpointId = env.SEED_INFERENCE_ENDPOINT_ID?.trim()
  const configuredVideoFps = env.SEED_VIDEO_FPS?.trim()
  const videoFps = configuredVideoFps
    ? Number(configuredVideoFps)
    : DEFAULT_VIDEO_FPS
  if (!Number.isFinite(videoFps) || videoFps < 0.2 || videoFps > 5) {
    throw new Error('SEED_VIDEO_FPS 必须是 0.2 到 5 之间的数字')
  }
  return {
    apiKey: env.SEED_API_KEY?.trim() || env.ARK_API_KEY?.trim() || '',
    apiBaseUrl,
    model: env.SEED_MULTIMODAL_MODEL?.trim() || DEFAULT_MODEL,
    ...(inferenceEndpointId ? { inferenceEndpointId } : {}),
    videoFps,
    timeoutMs: Number(env.SEED_TIMEOUT_MS) || 300_000,
    allowedApiHosts,
    maxRequestBytes:
      Number.isFinite(requestLimit) && requestLimit > 0
        ? requestLimit
        : DEFAULT_MAX_REQUEST_BYTES,
  }
}

function runtimeSeedKey(request: Pick<IncomingMessage, 'headers'>): string {
  const raw = request.headers['x-intent-seed-key']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.length <= 512 ? normalized : ''
}

/** Per-request keys override the server default and remain in this call stack. */
export function seedConfigForRequest(
  request: Pick<IncomingMessage, 'headers'>,
  env: Record<string, string | undefined> = process.env,
): SeedConfig {
  const config = seedConfigFromEnv(env)
  return { ...config, apiKey: runtimeSeedKey(request) || config.apiKey }
}

function timestampLabel(text: string): string | undefined {
  const match = /^\s*关键帧时间：\s*(.+?)\s*$/.exec(text)
  return match?.[1]?.trim()
}

/** Seed receives visual video/keyframes/images; no audio capability is implied. */
export function projectMediaForSeed(media: PreparedMedia): SeedMediaProjection {
  const sourceWasVideo = media.mode.startsWith('video_')
  const parts: GeminiMediaPart[] = []
  const frames: SeedVisualFrame[] = []
  const videos: SeedVisualVideo[] = []
  let pendingLabel: string | undefined
  let frameIndex = 0
  for (const part of media.parts) {
    if ('text' in part) {
      pendingLabel = timestampLabel(part.text)
      continue
    }
    if (part.inlineData.mimeType.startsWith('video/')) {
      videos.push({
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      })
      parts.push(part)
      pendingLabel = undefined
      continue
    }
    if (!part.inlineData.mimeType.startsWith('image/')) {
      pendingLabel = undefined
      continue
    }
    frameIndex += 1
    const frameId = `frame_${String(frameIndex).padStart(3, '0')}`
    const timeLabel = pendingLabel || (sourceWasVideo ? '时间未知' : `图片 ${frameIndex}`)
    // Keep the canonical timestamp marker after Seed adds its stable frame ID.
    // The coverage gate extracts this marker from the exact media projection
    // that was sent upstream, so frames-only fallback must not rename it.
    parts.push({ text: `Seed 视觉帧 ${frameId}；关键帧时间：${timeLabel}` }, part)
    frames.push({
      frameId,
      timeLabel,
      mimeType: part.inlineData.mimeType,
      data: part.inlineData.data,
    })
    pendingLabel = undefined
  }
  const warnings = [
    ...media.warnings,
    'Seed 2.1 Pro 视觉适配器可接收可配置采样率的全时长视频与时间标注关键帧/图片，但不把内嵌音轨视为已验证音频能力；audio/asr 仍标记为缺失。',
  ]
  return {
    frames,
    videos,
    media: {
      ...media,
      parts,
      mode: videos.length > 0
        ? frames.length > 0
          ? 'video_inline_keyframes'
          : 'video_inline'
        : sourceWasVideo
          ? 'video_frames'
          : frames.length > 0
            ? 'image_inline'
            : 'text_only',
      keyframeCount: frames.length,
      warnings,
    },
  }
}

type SeedInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_video'; video_url: string; fps: number }

function seedVideoContent(
  videos: SeedVisualVideo[],
  videoFps: number,
): SeedInputContent[] {
  return videos.map((video) => ({
    type: 'input_video',
    video_url: `data:${video.mimeType};base64,${video.data}`,
    fps: videoFps,
  }))
}

function seedFrameContent(frames: SeedVisualFrame[]): SeedInputContent[] {
  return frames.flatMap((frame) => [
    {
      type: 'input_text' as const,
      text: `视觉帧 ${frame.frameId}，时间标签 ${frame.timeLabel}。`,
    },
    {
      type: 'input_image' as const,
      image_url: `data:${frame.mimeType};base64,${frame.data}`,
    },
  ])
}

export function seedRequestModel(
  config: Pick<SeedConfig, 'model' | 'inferenceEndpointId'>,
): string {
  return config.inferenceEndpointId?.trim() || config.model
}

export function buildSeedMm01Body(
  request: MultimodalSourceRequest,
  projection: SeedMediaProjection,
  config: Pick<SeedConfig, 'model' | 'inferenceEndpointId' | 'videoFps'>,
  repairInstruction?: string,
): Record<string, unknown> {
  const analysisMode = analysisModeForPreparedMedia(projection.media)
  const confidenceCap = ANALYSIS_MODE_CONFIDENCE_CAP[analysisMode]
  return {
    model: seedRequestModel(config),
    input: [
      {
        role: 'user',
        content: [
          ...seedVideoContent(projection.videos, config.videoFps),
          ...seedFrameContent(projection.frames),
          {
            type: 'input_text',
            text: [
              MM01_SYSTEM_PROMPT,
              `本次适配器只授权使用按 ${config.videoFps} fps 采样的全时长视频画面、关键帧与 OCR。即使视频容器带内嵌音轨，也不得声称听到音频、口播、音乐或环境音；audio/asr 必须标记 missing/failed。`,
              multimodalContextText(
                request,
                projection.media,
                analysisMode,
                confidenceCap,
                {
                  visual:
                    projection.frames.length > 0 || projection.videos.length > 0,
                  audio: false,
                  asr: false,
                },
              ),
              repairInstruction?.trim() || '',
            ].join('\n\n'),
          },
        ],
      },
    ],
    max_output_tokens: 32_768,
  }
}

export function buildSeedP02Body(
  handoff: P02FormattedPromptCompilerOutput,
  config: Pick<SeedConfig, 'model' | 'inferenceEndpointId'>,
): Record<string, unknown> {
  return {
    model: seedRequestModel(config),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `${P02_SYSTEM_PROMPT}\n\n${handoff.p02FormattedPrompt}`,
          },
        ],
      },
    ],
    max_output_tokens: 8_192,
  }
}

function seedVisualDetailPrompt(videoFps: number): string {
  return `
你是只看画面的逐帧与时间序列证据记录员。先检查按 ${videoFps} fps 采样的全时长视频画面，再逐一检查每张带 frameId 和时间标签的关键帧。只描述采样中可见内容，不声称看见采样间的每一帧，不解释故事、不推断文化、不识别音频。

硬性规则：
1. 每个输入 frameId 必须且只能输出一次，顺序保持一致。
   如果没有输入 frameId（只有 input_video），observations 必须返回空数组。
2. visibleText 只能记录确实可读的画面文字；看不清就写入 uncertainties，不要补全。
3. 不得根据外貌猜测国籍、种族、宗教、职业或身份。
4. 不得推断容器内物质、人物动机、法律状态、文化隐喻或镜头前后因果。
5. actions 只能描述这一静态帧可支持的动作状态，不得伪造连续过程。
6. sequenceObservations 只依据 ${videoFps} fps 视频采样写可支持的动作变化、运镜、转场和可见文字，按时间顺序覆盖开头、中段、结尾；timeRange 必须是 0.0-2.5s 格式。没有收到 input_video 时必须返回空数组。无法从采样确认连续性时写入 uncertainties。
7. sequenceObservations 仍是视觉记录：不得写对白、音效、音乐、语气或仅靠音轨可知的信息。
8. 只返回一个 JSON 对象，不要 Markdown、思考过程或额外文字。

输出格式：
{"module":"SEED_VISUAL_DETAIL_REPORT","observations":[{"frameId":"frame_001","people":"","actions":"","objects":"","setting":"","composition":"","camera":"","lighting":"","color":"","visibleText":[],"uncertainties":[]}],"sequenceObservations":[{"timeRange":"0.0-2.5s","motionOrActions":"","cameraOrTransition":"","visibleText":[],"uncertainties":[]}]}
`.trim()
}

export function buildSeedVisualDetailBody(
  projection: SeedMediaProjection,
  config: Pick<SeedConfig, 'model' | 'inferenceEndpointId' | 'videoFps'>,
): Record<string, unknown> {
  return {
    model: seedRequestModel(config),
    input: [
      {
        role: 'user',
        content: [
          ...seedVideoContent(projection.videos, config.videoFps),
          ...seedFrameContent(projection.frames),
          { type: 'input_text', text: seedVisualDetailPrompt(config.videoFps) },
        ],
      },
    ],
    max_output_tokens: 16_384,
  }
}

function responseTexts(data: SeedResponsesEnvelope): string[] {
  const values = [
    data.output_text,
    ...(data.output ?? []).flatMap((item) =>
      (item.content ?? [])
        .filter((content) => content.type === 'output_text')
        .map((content) => content.text),
    ),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
  return [...new Set(values)]
}

function responseRefusals(data: SeedResponsesEnvelope): string[] {
  return [
    ...(data.output ?? []).flatMap((item) =>
      (item.content ?? [])
        .filter((content) => content.type === 'refusal')
        .map((content) => content.refusal),
    ),
  ].filter(
    (value): value is string =>
      typeof value === 'string' && value.trim().length > 0,
  )
}

function finiteUsage(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

export async function callSeed(
  body: Record<string, unknown>,
  config: SeedConfig,
  fetchImpl: typeof fetch,
): Promise<ModelCallResult> {
  const apiBaseUrl = validateSeedApiBaseUrl(config.apiBaseUrl, config.allowedApiHosts)
  const endpoint = `${apiBaseUrl}/responses`
  const requestBody = JSON.stringify(body)
  const maxRequestBytes = config.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES
  if (!Number.isFinite(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new SeedServiceError('SEED_REQUEST_TOO_LARGE', 'Seed request byte limit is invalid')
  }
  if (Buffer.byteLength(requestBody, 'utf8') > maxRequestBytes) {
    throw new SeedServiceError('SEED_REQUEST_TOO_LARGE', 'Seed request exceeds the configured byte limit')
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
      throw new SeedServiceError('SEED_TIMEOUT', 'Seed request timed out')
    }
    throw new SeedServiceError('SEED_UPSTREAM_FAILED', 'Seed request failed')
  }

  const data = (await response.json().catch(() => null)) as SeedResponsesEnvelope | null
  if (!response.ok) {
    throw new SeedServiceError('SEED_UPSTREAM_FAILED', 'Seed upstream rejected the request')
  }
  if (!data) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed returned an invalid envelope')
  }
  if (responseRefusals(data).length > 0) {
    throw new SeedServiceError('SEED_BLOCKED', 'Seed refused the request')
  }
  if (data.status === 'incomplete') {
    throw new SeedServiceError(
      'SEED_INCOMPLETE',
      'Seed returned an incomplete response',
    )
  }
  if (data.status === 'failed') {
    throw new SeedServiceError(
      'SEED_UPSTREAM_FAILED',
      'Seed failed to complete the response',
    )
  }
  const texts = responseTexts(data)
  if (texts.length === 0) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed returned no final output text')
  }
  const candidates: unknown[] = []
  const seen = new Set<string>()
  for (const text of texts) {
    if (text.length > MAX_RESPONSE_TEXT_CHARS) {
      throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed response text exceeds the configured limit')
    }
    try {
      for (const candidate of parseGeminiJsonCandidates(text)) {
        const fingerprint = JSON.stringify(candidate)
        if (!seen.has(fingerprint)) {
          seen.add(fingerprint)
          candidates.push(candidate)
        }
      }
    } catch {
      // Continue: compatible gateways may expose more than one output_text part.
    }
  }
  if (candidates.length === 0) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed returned no parseable JSON value')
  }
  const usage: ModelTokenUsage = {
    inputTokens: finiteUsage(data.usage?.input_tokens),
    outputTokens: finiteUsage(data.usage?.output_tokens),
    totalTokens: finiteUsage(data.usage?.total_tokens),
    cachedInputTokens: finiteUsage(data.usage?.input_tokens_details?.cached_tokens),
  }
  for (const key of Object.keys(usage) as Array<keyof ModelTokenUsage>) {
    if (usage[key] === undefined) delete usage[key]
  }
  return {
    candidates,
    reportedModel: sanitizedReportedModel(data.model),
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(
  value: unknown,
  path: string,
  maxChars = MAX_VISUAL_FIELD_CHARS,
): string {
  if (typeof value !== 'string') {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', `${path} must be a string`)
  }
  if (value.length > maxChars) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      `${path} exceeds the safe character limit`,
    )
  }
  return value
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', `${path} must be a string array`)
  }
  if (value.length > MAX_VISUAL_LIST_ITEMS) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      `${path} exceeds the safe item limit`,
    )
  }
  if (value.some((entry) => entry.length > MAX_VISUAL_LIST_ITEM_CHARS)) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      `${path} contains an oversized item`,
    )
  }
  return value as string[]
}

export function parseSeedVisualDetailReport(
  value: unknown,
  projection: SeedMediaProjection,
): SeedVisualDetailReport {
  let serializedLength = 0
  try {
    serializedLength = JSON.stringify(value).length
  } catch {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      'Seed visual detail report is not serializable',
    )
  }
  if (serializedLength > MAX_VISUAL_REPORT_CHARS) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      'Seed visual detail report exceeds the safe size limit',
    )
  }
  const root = objectValue(value)
  if (
    !root ||
    root.module !== 'SEED_VISUAL_DETAIL_REPORT' ||
    !Array.isArray(root.observations) ||
    !Array.isArray(root.sequenceObservations)
  ) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed visual detail report has an invalid envelope')
  }
  const allowedRoot = new Set(['module', 'observations', 'sequenceObservations'])
  if (Object.keys(root).some((key) => !allowedRoot.has(key))) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed visual detail report has unexpected fields')
  }
  const frameIds = projection.frames.map(({ frameId }) => frameId)
  const expected = new Set(frameIds)
  const requiredKeys = [
    'frameId',
    'people',
    'actions',
    'objects',
    'setting',
    'composition',
    'camera',
    'lighting',
    'color',
    'visibleText',
    'uncertainties',
  ]
  const observations = root.observations.map((entry, index) => {
    const path = `observations[${index}]`
    const item = objectValue(entry)
    if (!item || Object.keys(item).length !== requiredKeys.length || requiredKeys.some((key) => !Object.hasOwn(item, key))) {
      throw new SeedServiceError('SEED_INVALID_OUTPUT', `${path} has invalid fields`)
    }
    const frameId = requiredString(item.frameId, `${path}.frameId`, 64)
    if (!expected.has(frameId)) {
      throw new SeedServiceError('SEED_INVALID_OUTPUT', `${path}.frameId was not sent to Seed`)
    }
    return {
      frameId,
      people: requiredString(item.people, `${path}.people`),
      actions: requiredString(item.actions, `${path}.actions`),
      objects: requiredString(item.objects, `${path}.objects`),
      setting: requiredString(item.setting, `${path}.setting`),
      composition: requiredString(item.composition, `${path}.composition`),
      camera: requiredString(item.camera, `${path}.camera`),
      lighting: requiredString(item.lighting, `${path}.lighting`),
      color: requiredString(item.color, `${path}.color`),
      visibleText: stringList(item.visibleText, `${path}.visibleText`),
      uncertainties: stringList(item.uncertainties, `${path}.uncertainties`),
    }
  })
  const actualIds = observations.map(({ frameId }) => frameId)
  if (new Set(actualIds).size !== actualIds.length) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed repeated a frameId')
  }
  if (actualIds.length !== frameIds.length || actualIds.some((id, index) => id !== frameIds[index])) {
    throw new SeedServiceError('SEED_INVALID_OUTPUT', 'Seed did not return every frame in input order')
  }
  const sequenceKeys = [
    'timeRange',
    'motionOrActions',
    'cameraOrTransition',
    'visibleText',
    'uncertainties',
  ]
  const sequenceObservations = root.sequenceObservations.map((entry, index) => {
    const path = `sequenceObservations[${index}]`
    const item = objectValue(entry)
    if (
      !item ||
      Object.keys(item).length !== sequenceKeys.length ||
      sequenceKeys.some((key) => !Object.hasOwn(item, key))
    ) {
      throw new SeedServiceError('SEED_INVALID_OUTPUT', `${path} has invalid fields`)
    }
    const timeRange = requiredString(item.timeRange, `${path}.timeRange`, 64)
    const match = /^\s*(\d+(?:\.\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?)\s*s\s*$/i.exec(
      timeRange,
    )
    if (!match || Number(match[2]) <= Number(match[1])) {
      throw new SeedServiceError(
        'SEED_INVALID_OUTPUT',
        `${path}.timeRange must be an increasing seconds range`,
      )
    }
    const duration = projection.media.durationSeconds
    if (duration !== undefined && Number(match[2]) > duration + 0.5) {
      throw new SeedServiceError(
        'SEED_INVALID_OUTPUT',
        `${path}.timeRange exceeds the probed video duration`,
      )
    }
    return {
      timeRange,
      motionOrActions: requiredString(
        item.motionOrActions,
        `${path}.motionOrActions`,
      ),
      cameraOrTransition: requiredString(
        item.cameraOrTransition,
        `${path}.cameraOrTransition`,
      ),
      visibleText: stringList(item.visibleText, `${path}.visibleText`),
      uncertainties: stringList(item.uncertainties, `${path}.uncertainties`),
    }
  })
  if (sequenceObservations.length > MAX_SEQUENCE_OBSERVATIONS) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      'Seed returned too many sequence observations',
    )
  }
  if (projection.videos.length === 0 && sequenceObservations.length > 0) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      'Seed returned sequence observations without an input video',
    )
  }
  if (projection.videos.length > 0 && sequenceObservations.length === 0) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      'Seed omitted continuous-video observations',
    )
  }
  return {
    module: 'SEED_VISUAL_DETAIL_REPORT',
    observations,
    sequenceObservations,
  }
}

export async function analyzeSeedVisualDetails(
  media: PreparedMedia,
  config = seedConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<{
  report: SeedVisualDetailReport
  frameCount: number
  inputMode: SeedVisualInputMode
  usage?: ModelTokenUsage
  reportedModel?: string
}> {
  if (!config.apiKey) throw new Error('未配置 SEED_API_KEY')
  const projection = projectMediaForSeed(media)
  if (projection.frames.length === 0 && projection.videos.length === 0) {
    throw new SeedServiceError(
      'SEED_UNSUPPORTED_MEDIA',
      'Seed fusion requires an inline video, timestamped keyframes or still images',
    )
  }
  const call = await callSeed(
    buildSeedVisualDetailBody(projection, config),
    config,
    fetchImpl,
  )
  const reports = new Map<string, SeedVisualDetailReport>()
  for (const candidate of call.candidates) {
    try {
      const report = parseSeedVisualDetailReport(candidate, projection)
      reports.set(JSON.stringify(report), report)
    } catch {
      // The strict report parser decides which candidate, if any, is authoritative.
    }
  }
  if (reports.size !== 1) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      reports.size > 1
        ? 'Seed returned ambiguous visual detail reports'
        : 'Seed returned no contract-valid visual detail report',
    )
  }
  return {
    report: reports.values().next().value as SeedVisualDetailReport,
    frameCount: projection.frames.length,
    inputMode:
      projection.videos.length > 0
        ? projection.frames.length > 0
          ? 'video_and_keyframes'
          : 'video_only'
        : media.mode.startsWith('video_')
          ? 'keyframes_only'
          : 'images',
    ...(call.usage ? { usage: call.usage } : {}),
    ...(call.reportedModel ? { reportedModel: call.reportedModel } : {}),
  }
}

export function seedVisualContextText(report: SeedVisualDetailReport): string {
  const context = JSON.stringify({
    kind: 'untrusted_seed_visual_observations',
    trust: 'retrieval_aid_only',
    rules: [
      'Gemini must independently verify every claim against the original media.',
      'Seed output alone cannot become frame, OCR, ASR, speech or audio evidence.',
      'Seed has no authorized audio source in this pipeline.',
      'Identity, culture, container contents, causality and motivation remain inference unless original media proves them.',
      'Conflicts and uncertainty must remain unresolved when original media cannot decide.',
    ],
    report,
  })
  if (context.length > MAX_VISUAL_REPORT_CHARS) {
    throw new SeedServiceError(
      'SEED_INVALID_OUTPUT',
      'Seed visual context exceeds the safe size limit',
    )
  }
  return context
}

/** Run Seed alone as a conservative visual-only MM01 -> C01 -> P02F -> P02 profile. */
export async function analyzeWithSeed(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  config = seedConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
  downstreamConfig: DownstreamTextConfig = downstreamTextConfigFromEnv(),
): ReturnType<typeof executeMultimodalPipeline> {
  if (!config.apiKey) throw new Error('未配置 SEED_API_KEY')
  const projection = projectMediaForSeed(media)
  if (projection.frames.length === 0 && projection.videos.length === 0) {
    throw new SeedServiceError(
      'SEED_UNSUPPORTED_MEDIA',
      'Seed requires an inline video, timestamped keyframes or still images',
    )
  }
  return executeMultimodalPipeline({
    provider: 'seed',
    profile: 'seed-2.1-pro',
    model: seedRequestModel(config),
    request,
    media: projection.media,
    policy: {
      analysisMode: analysisModeForPreparedMedia(projection.media),
      availability: { visual: true, audio: false, asr: false },
      enforceUnavailableModalities: true,
    },
    callMm01: (repairInstruction) =>
      callSeed(
        buildSeedMm01Body(request, projection, config, repairInstruction),
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
      new SeedServiceError('SEED_INVALID_OUTPUT', `Seed ${detail}`),
    models: [
      {
        role: 'visual_detail',
        provider: 'seed',
        model: seedRequestModel(config),
      },
      {
        role: 'context_research',
        provider: 'downstream',
        model: downstreamConfig.c01Model,
      },
      { role: 'p02', provider: 'downstream', model: downstreamConfig.p02Model },
    ],
  })
}
