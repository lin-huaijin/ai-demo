import type { Platform, SourceMediaKind } from '../../src/contracts/multimodalAnalysis.ts'
import {
  analyzeWithGemini,
  GeminiServiceError,
  geminiConfigFromEnv,
  type GeminiConfig,
  type MultimodalSourceRequest,
} from './gemini.ts'
import { KimiServiceError } from './kimi.ts'
import { SeedServiceError } from './seed.ts'
import {
  assertRequiredAudioInput,
  Mm01AudioEvidenceError,
  Mm01CoverageError,
} from './modelCore.ts'
import { DownstreamTextServiceError } from './downstreamText.ts'
import {
  prepareMedia,
  type PreparedMedia,
  type PrepareMediaOptions,
} from './media.ts'
import {
  multimodalRuntimeFromEnv,
  type MultimodalRuntime,
} from './profiles.ts'
import type { LocalArtifactStore } from '../artifacts/index.ts'
import type { ArtifactReference } from '../artifacts/types.ts'

const MEDIA_KINDS = new Set<SourceMediaKind>([
  'video',
  'image',
  'carousel',
  'mixed',
  'text',
])
const PLATFORMS = new Set<Platform>(['tiktok', 'meta', 'youtube', 'unknown'])

export interface ApiResult {
  status: number
  body: Record<string, unknown>
}

export interface MultimodalAccessSummary {
  enabled: boolean
  authorized: boolean
  requiresAccessToken: boolean
}

export interface AnalyzeDependencies {
  runtime?: MultimodalRuntime
  /** Legacy Gemini-only injection retained for focused unit tests. */
  config?: GeminiConfig
  prepare?: typeof prepareMedia
  prepareOptions?: PrepareMediaOptions
  analyze?: typeof analyzeWithGemini
  artifactStore?: Pick<
    LocalArtifactStore,
    | 'beginRun'
    | 'copyDownloadedMedia'
    | 'persistPreparedMedia'
    | 'completeRun'
    | 'failRun'
  >
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
  if (!Array.isArray(value)) throw new Error('媒体 URL 字段必须是 URL 数组')
  if (value.length > 10) throw new Error('每个媒体 URL 数组最多 10 项')
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

export function parseAnalysisRequest(value: unknown): MultimodalSourceRequest {
  const data = record(value)
  if (!data) throw new Error('请求体必须是 JSON 对象')
  const mediaKind = data.mediaKind
  if (
    typeof mediaKind !== 'string' ||
    !MEDIA_KINDS.has(mediaKind as SourceMediaKind)
  ) {
    throw new Error('mediaKind 必须是 video / image / carousel / mixed / text')
  }
  const platform = data.platform
  if (
    platform !== undefined &&
    (typeof platform !== 'string' || !PLATFORMS.has(platform as Platform))
  ) {
    throw new Error('platform 必须是 tiktok / meta / youtube / unknown')
  }
  const duration = data.durationSeconds
  if (
    duration !== undefined &&
    (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)
  ) {
    throw new Error('durationSeconds 必须是非负数')
  }

  return {
    sourceUrl: optionalUrl(data.sourceUrl, 4_096),
    mediaUrl: optionalUrl(data.mediaUrl, 16_384),
    mediaUrls: optionalUrls(data.mediaUrls),
    videoUrls: optionalUrls(data.videoUrls),
    imageUrls: optionalUrls(data.imageUrls),
    mediaKind: mediaKind as SourceMediaKind,
    platform: platform as Platform | undefined,
    marketId: optionalString(data.marketId, 128) ?? '',
    marketLanguages: marketLanguages(data.marketLanguages),
    title: optionalString(data.title, 2_000) ?? '',
    caption: optionalString(data.caption, 20_000) ?? '',
    providerTranscript: optionalString(data.providerTranscript, 80_000),
    durationSeconds: duration as number | undefined,
  }
}

function textOnlyMedia(mediaKind: SourceMediaKind): PreparedMedia {
  return {
    parts: [],
    mode: 'text_only',
    keyframeCount: 0,
    sourceAudioTrack: mediaKind === 'video' || mediaKind === 'mixed'
      ? 'unknown'
      : 'not_applicable',
    audioInputProvenance: 'none',
    warnings: ['媒体读取失败，已使用文本证据安全降级'],
    cleanup: async () => undefined,
  }
}

export function multimodalStatus(
  runtimeOrConfig: MultimodalRuntime | GeminiConfig = multimodalRuntimeFromEnv(),
  access: MultimodalAccessSummary = {
    enabled: true,
    authorized: true,
    requiresAccessToken: false,
  },
): ApiResult {
  const runtime: MultimodalRuntime = 'provider' in runtimeOrConfig
    ? runtimeOrConfig
    : {
        profile: 'gemini',
        provider: 'gemini',
        model: runtimeOrConfig.model,
        apiKey: runtimeOrConfig.apiKey,
        capabilities: {
          videoInline: true,
          sceneKeyframes: !process.env.VERCEL || Boolean(process.env.FFMPEG_BIN),
          audio: true,
          asr: true,
          image: true,
          strictJsonSchema: true,
        },
        analyze: (request, media) =>
          analyzeWithGemini(request, media, runtimeOrConfig),
      }
  return {
    status: 200,
    body: {
      configured:
        access.authorized &&
        Boolean(runtime.apiKey) &&
        (runtime.downstream?.configured ?? false),
      provider: access.authorized ? runtime.provider : '',
      profile: access.authorized ? runtime.profile : '',
      model: access.authorized ? runtime.model : '',
      ...access,
      capabilities: runtime.capabilities,
      downstream: runtime.downstream ?? {
        configured: false,
        c01Model: '',
        p02Model: '',
      },
      pipeline: {
        mm01: true,
        contextResearch: true,
        p02FormattedPrompt: true,
        p02: true,
        modelCalls: runtime.profile === 'fusion' ? 4 : 3,
      },
    },
  }
}

function safeCoverageFailureMessage(error: Mm01CoverageError): string {
  const { evaluation } = error
  if (evaluation.durationSec <= 0 || !evaluation.thresholds) {
    return '无法验证 MM01 的完整时间轴覆盖，为避免误判，P02 未执行。请重试或检查视频可读性。'
  }

  const reasons = new Set(error.evaluation.reasonCodes)
  const issues: string[] = []
  if (reasons.has('text_fallback') || reasons.has('visual_unavailable')) {
    issues.push('未取得可验证的视频画面')
  }
  if (reasons.has('coverage_ratio_below_threshold')) {
    issues.push('有效画面覆盖低于门槛')
  }
  if (reasons.has('head_gap_exceeds_threshold')) issues.push('未充分触达片头')
  if (reasons.has('tail_gap_exceeds_threshold')) issues.push('未充分触达片尾')
  if (reasons.has('max_gap_exceeds_threshold')) issues.push('时间轴存在过大盲区')
  if (reasons.has('scene_span_exceeds_threshold')) issues.push('场景分段过粗')
  if (reasons.has('interval_out_of_bounds')) issues.push('场景时间戳超出视频时长')
  if (reasons.has('no_direct_evidence')) issues.push('没有可溯源的画面/OCR 直接证据')

  const summary =
    `MM01 有效画面时间轴覆盖 ${(evaluation.coverageRatio * 100).toFixed(1)}%` +
    `（${evaluation.coveredSec.toFixed(1)} / ${evaluation.durationSec.toFixed(1)} 秒，` +
    `最低要求 ${(evaluation.thresholds.minimumCoverageRatio * 100).toFixed(0)}%）`
  const detail = issues.length > 0 ? `：${issues.join('；')}` : ''
  return `${summary}${detail}。为避免误判，P02 未执行。请重试或对长视频进行分段分析。`
}

function safeModelFailure(error: unknown): ApiResult {
  const code =
    error instanceof Mm01AudioEvidenceError
      ? error.code
      : error instanceof Mm01CoverageError
      ? error.code
      : error instanceof GeminiServiceError
      ? error.code
      : error instanceof KimiServiceError
        ? error.code
        : error instanceof SeedServiceError
          ? error.code
        : error instanceof DownstreamTextServiceError
          ? error.code
        : 'MULTIMODAL_ANALYSIS_FAILED'
  const unsupportedMedia =
    code === 'KIMI_UNSUPPORTED_MEDIA' || code === 'SEED_UNSUPPORTED_MEDIA'
  const audioEvidenceMissing = error instanceof Mm01AudioEvidenceError
  const message = audioEvidenceMissing
    ? error.failure === 'audio_input_missing'
      ? '原视频音轨未能完整送达多模态模型；为避免漏掉口播、BGM、音效和环境音，MM01 与 P02 已中止。请重试或检查 FFmpeg 与素材大小。'
      : '模型没有形成可用的音频分析；为避免只凭画面进入下游，P02 已中止。请重试本次多模态分析。'
    : unsupportedMedia
    ? code === 'SEED_UNSUPPORTED_MEDIA'
      ? 'Seed 2.1 Pro 未取得可用关键帧或图片；为避免仅凭文本猜测，本次未调用模型。'
      : 'Kimi K3 未取得可用视频画面；为避免仅凭标题或字幕猜测，本次未调用模型。'
    : error instanceof Mm01CoverageError
      ? safeCoverageFailureMessage(error)
    : code === 'GEMINI_TIMEOUT' || code === 'KIMI_TIMEOUT' || code === 'SEED_TIMEOUT'
      ? '多模态分析超时，请稍后重试。'
      : code === 'SEED_INCOMPLETE'
        ? 'Seed 2.1 Pro 输出未完成或被截断，请重试。'
      : code === 'GEMINI_BLOCKED' || code === 'KIMI_BLOCKED' || code === 'SEED_BLOCKED'
        ? '素材未通过模型安全检查。'
        : code === 'GEMINI_INVALID_OUTPUT' || code === 'KIMI_INVALID_OUTPUT' || code === 'SEED_INVALID_OUTPUT'
          ? '模型输出未通过 MM01/P02 结构校验，请重试。'
          : code === 'DOWNSTREAM_NOT_CONFIGURED'
            ? '未配置下游搜索/文本模型；C01 必须联网检索，当前无法继续拆解。'
            : code === 'DOWNSTREAM_INVALID_CONFIG'
              ? '下游搜索/文本模型配置无效，请检查服务端 API 基址、模型与超时设置。'
              : code === 'DOWNSTREAM_INPUT_TOO_LARGE'
                ? 'C01/P02 输入超过安全上限，请缩短素材或减少上下文后重试。'
                : code === 'DOWNSTREAM_RESPONSE_TOO_LARGE'
                  ? '下游搜索/文本模型响应超过安全上限，请重试。'
                  : code === 'DOWNSTREAM_SEARCH_EVIDENCE_MISSING'
                    ? 'C01 未返回可验证的真实搜索调用或来源引用，P02 已中止。'
            : code === 'DOWNSTREAM_TIMEOUT'
              ? '下游搜索/文本模型超时，请稍后重试。'
              : code === 'DOWNSTREAM_INVALID_OUTPUT'
                ? '下游搜索/文本模型输出未通过 C01/P02 结构校验，请重试。'
          : code === 'GEMINI_REQUEST_TOO_LARGE' || code === 'KIMI_REQUEST_TOO_LARGE' || code === 'SEED_REQUEST_TOO_LARGE'
            ? '素材请求超过模型单次处理上限，请使用压缩素材。'
            : '多模态分析失败，请稍后重试。'
  return {
    status:
      unsupportedMedia || audioEvidenceMissing || code === 'DOWNSTREAM_INPUT_TOO_LARGE'
        ? 422
        : code === 'DOWNSTREAM_NOT_CONFIGURED' || code === 'DOWNSTREAM_INVALID_CONFIG'
          ? 503
          : 502,
    body: { error: message, code },
  }
}

export async function analyzeSourceRequest(
  rawRequest: unknown,
  dependencies: AnalyzeDependencies = {},
): Promise<ApiResult> {
  let runtime = dependencies.runtime
  if (!runtime && (dependencies.config || dependencies.analyze)) {
    const legacyConfig = dependencies.config ?? geminiConfigFromEnv()
    runtime = {
          profile: 'gemini' as const,
          provider: 'gemini' as const,
          model: legacyConfig.model,
          apiKey: legacyConfig.apiKey,
          capabilities: {
            videoInline: true,
            sceneKeyframes: !process.env.VERCEL || Boolean(process.env.FFMPEG_BIN),
            audio: true,
            asr: true,
            image: true,
            strictJsonSchema: true,
          },
          analyze: (request: MultimodalSourceRequest, media: PreparedMedia) =>
            (dependencies.analyze ?? analyzeWithGemini)(request, media, legacyConfig),
        }
  }
  runtime ??= multimodalRuntimeFromEnv()
  if (!runtime.apiKey) {
    return {
      status: 503,
      body: {
        error: `未配置 ${runtime.model} API Key；素材抓取仍可使用，但多模态分析已安全跳过。`,
        code: 'MULTIMODAL_NOT_CONFIGURED',
        profile: runtime.profile,
      },
    }
  }
  if (runtime.downstream && !runtime.downstream.configured) {
    return {
      status: 503,
      body: {
        error: '未配置下游搜索/文本模型 API Key；为避免先消耗 MM01 额度后在 C01 断链，本次尚未调用任何模型。',
        code: 'DOWNSTREAM_NOT_CONFIGURED',
        profile: runtime.profile,
      },
    }
  }

  let request: MultimodalSourceRequest
  try {
    request = parseAnalysisRequest(rawRequest)
  } catch (error) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : '请求不合法' },
    }
  }

  const artifactStore = dependencies.artifactStore
  let artifact: ArtifactReference | undefined
  let artifactWarning: string | undefined
  if (artifactStore) {
    try {
      artifact = await artifactStore.beginRun({
        sourceUrl: request.sourceUrl,
        mediaUrl:
          request.mediaUrl ?? request.videoUrls?.[0] ?? request.imageUrls?.[0],
        title: request.title,
        platform: request.platform,
        requestedModel: runtime.model,
        profile: runtime.profile,
        metadata: {
          mediaKind: request.mediaKind,
          marketId: request.marketId,
          durationSeconds: request.durationSeconds,
        },
      })
    } catch (error) {
      artifactWarning = '本次分析已继续，但本地档案初始化失败。'
      dependencies.onError?.(error)
    }
  }

  let media: PreparedMedia
  try {
    const input = {
      mediaUrl: request.mediaUrl,
      mediaUrls: request.mediaUrls,
      videoUrls: request.videoUrls,
      imageUrls: request.imageUrls,
    }
    const prepare = dependencies.prepare ?? prepareMedia
    const basePrepareOptions =
      runtime.provider === 'kimi'
        ? { ...dependencies.prepareOptions, stripAudioTrack: true }
        : dependencies.prepareOptions
    const existingCapture = basePrepareOptions?.onDownloadedMedia
    const prepareOptions = artifact && artifactStore
      ? {
          ...basePrepareOptions,
          onDownloadedMedia: async (
            downloaded: Parameters<NonNullable<PrepareMediaOptions['onDownloadedMedia']>>[0],
          ) => {
            await existingCapture?.(downloaded)
            await artifactStore.copyDownloadedMedia(artifact!, {
              filePath: downloaded.path,
              mimeType: downloaded.mimeType,
              role: downloaded.label,
            })
          },
        }
      : basePrepareOptions
    media = prepareOptions
      ? await prepare(input, request.mediaKind, prepareOptions)
      : await prepare(input, request.mediaKind)
  } catch {
    media = textOnlyMedia(request.mediaKind)
  }

  if (
    artifact &&
    media.warnings.some((warning) => warning.includes('本地档案副本保存失败'))
  ) {
    artifactWarning = '分析已完成，但原始素材的本地档案副本未能保存。'
  }

  if (artifact && artifactStore) {
    try {
      await artifactStore.persistPreparedMedia(artifact, media)
    } catch (error) {
      artifactWarning = '多模态分析已继续，但部分媒体证据未能写入本地档案。'
      dependencies.onError?.(error)
    }
  }

  try {
    if (runtime.capabilities.audio) {
      assertRequiredAudioInput(request, media)
    }
    const analysis = await runtime.analyze(request, media)
    if (artifact && artifactStore) {
      try {
        artifact = await artifactStore.completeRun(artifact, {
          analysis,
          status: artifactWarning ? 'partial' : 'complete',
          requestedModel: runtime.model,
          reportedModel:
            analysis.diagnostics.reportedModels
              ?.map((entry) => entry.model)
              .join(' → ') || analysis.diagnostics.model,
          usage: analysis.diagnostics.usage,
          metadata: {
            provider: analysis.diagnostics.provider,
            profile: analysis.diagnostics.profile,
            mediaMode: analysis.diagnostics.mediaMode,
            elapsedMs: analysis.diagnostics.elapsedMs,
            modelCalls: analysis.diagnostics.modelCalls,
            durationSeconds: analysis.diagnostics.durationSeconds,
            keyframeCount: analysis.diagnostics.keyframeCount,
            sourceAudioTrack: analysis.diagnostics.sourceAudioTrack,
            audioInputProvenance: analysis.diagnostics.audioInputProvenance,
          },
          warning: artifactWarning,
        })
      } catch (error) {
        artifact = {
          ...artifact,
          status: 'partial',
          warning: '分析已完成，但最终档案索引更新失败。',
        }
        dependencies.onError?.(error)
      }
    }
    return {
      status: 200,
      body: {
        analysis,
        ...(artifact ? { artifact } : {}),
        ...(artifactWarning ? { artifactWarning } : {}),
      },
    }
  } catch (error) {
    dependencies.onError?.(error)
    if (artifact && artifactStore) {
      try {
        artifact = await artifactStore.failRun(artifact, error)
      } catch (archiveError) {
        artifact = {
          ...artifact,
          status: 'partial',
          warning: '模型失败信息未能完整写入本地档案。',
        }
        dependencies.onError?.(archiveError)
      }
    }
    const failure = safeModelFailure(error)
    return {
      ...failure,
      body: {
        ...failure.body,
        ...(artifact ? { artifact } : {}),
        ...(artifactWarning ? { artifactWarning } : {}),
      },
    }
  } finally {
    await media.cleanup().catch((error) => dependencies.onError?.(error))
  }
}
