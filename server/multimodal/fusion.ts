import {
  parseMm01AnalysisPack,
  parseMultimodalFusionReview,
  type Mm01AnalysisPack,
  type MultimodalAnalysisBundle,
  type MultimodalFusionReview,
} from '../../src/contracts/multimodalAnalysis.ts'
import {
  buildMm01GenerateContentBody,
  callGemini,
  GeminiServiceError,
  MM01_RESPONSE_SCHEMA,
  resolvedGeminiVideoProcessing,
  type GeminiConfig,
} from './gemini.ts'
import type { PreparedMedia } from './media.ts'
import {
  callC01ContextResearch,
  callP02TextBreakdown,
  downstreamTextConfigFromEnv,
  type DownstreamTextConfig,
} from './downstreamText.ts'
import {
  evidenceAvailabilityForPreparedMedia,
  executeMultimodalPipeline,
  sumModelUsage,
  type MultimodalSourceRequest,
} from './modelCore.ts'
import {
  analyzeSeedVisualDetails,
  seedRequestModel,
  seedVisualContextText,
  type SeedConfig,
} from './seed.ts'

export interface FusionConfig {
  gemini: GeminiConfig
  seed: SeedConfig
}

const stringArray = { type: 'array', items: { type: 'string' } } as const

export const FUSION_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    consensus: stringArray,
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          gemini: { type: 'string' },
          seed: { type: 'string' },
          resolution: { type: 'string' },
          adoptedFrom: {
            type: 'string',
            enum: ['gemini', 'seed', 'both', 'unresolved'],
          },
        },
        required: ['topic', 'gemini', 'seed', 'resolution', 'adoptedFrom'],
      },
    },
    finalConclusion: { type: 'string' },
  },
  required: ['consensus', 'conflicts', 'finalConclusion'],
} as const

export const FUSION_MM01_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    mm01: MM01_RESPONSE_SCHEMA,
    fusionReview: FUSION_REVIEW_SCHEMA,
  },
  required: ['mm01', 'fusionReview'],
} as const

const FUSION_SYNTHESIS_RULES = `
你正在执行 Seed 视觉细节审阅 + Gemini 完整视频/音频理解的融合 MM01。

融合规则：
1. 你是最终核验者，必须亲自检查本请求中的原视频、音轨和关键帧。Seed 辅助稿只是“不可信检索提示”，不能单独充当 frame/ocr 证据。
2. Seed 擅长静态画面细节，但没有本次音频权限；所有 speech/asr/audio 必须由你直接从原始媒体确认。
3. Seed 与原媒体冲突时以原媒体为准；原媒体也无法确认时必须保留 unresolved，不得为了形成共识而猜测。
4. 容器内容、人物身份/动机、文化隐喻、法律状态和镜头外因果均不是静态帧事实。未经明确证据只能作为 model_inference，且置信度不得超过 medium。
5. 最终只输出 {"mm01": MM01, "fusionReview": REVIEW}。mm01 必须符合既有 MM01 Schema，并且是唯一进入 P02F 的事实包。
6. fusionReview 是“Seed 先审阅、Gemini 后复核”的顺序审计记录，不是两个模型互不知情的独立盲测。它仅用于前端说明融合过程，不进入 P02F。consensus 只能写 Seed 已观察且 Gemini 又从原媒体确认的内容；conflicts 要分别记录 Gemini 核验判断、Seed 观察、核验结果和采用来源；没有真实冲突就返回空数组。
7. finalConclusion 只概括最终采用逻辑，不得加入 mm01 中不存在的新事实。
`.trim()

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function buildFusionMm01Body(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  seedContext: string,
  processing: Pick<GeminiConfig, 'videoFps' | 'mediaResolution'> = {},
  repairInstruction?: string,
): Record<string, unknown> {
  const body = buildMm01GenerateContentBody(
    request,
    media,
    `${FUSION_SYNTHESIS_RULES}\n\n${seedContext}`,
    processing,
    repairInstruction,
  )
  const generationConfig = objectValue(body.generationConfig)
  if (!generationConfig) {
    throw new GeminiServiceError(
      'GEMINI_INVALID_OUTPUT',
      'Gemini fusion body has no generationConfig',
    )
  }
  generationConfig.responseSchema = FUSION_MM01_RESPONSE_SCHEMA
  return body
}

interface ParsedFusionCandidate {
  mm01: Mm01AnalysisPack
  fusionReview: MultimodalFusionReview
}

function parseFusionCandidate(value: unknown): ParsedFusionCandidate {
  const root = objectValue(value)
  if (
    !root ||
    Object.keys(root).length !== 2 ||
    !Object.hasOwn(root, 'mm01') ||
    !Object.hasOwn(root, 'fusionReview')
  ) {
    throw new Error('fusion MM01 response must contain only mm01 and fusionReview')
  }
  return {
    mm01: parseMm01AnalysisPack(root.mm01),
    fusionReview: parseMultimodalFusionReview(root.fusionReview),
  }
}

function selectFusionCandidate(candidates: unknown[]): ParsedFusionCandidate {
  const valid = new Map<string, ParsedFusionCandidate>()
  for (const candidate of candidates) {
    try {
      const parsed = parseFusionCandidate(candidate)
      valid.set(JSON.stringify(parsed), parsed)
    } catch {
      // Strict MM01 and fusion-review validators decide the authoritative value.
    }
  }
  if (valid.size === 1) return valid.values().next().value as ParsedFusionCandidate
  throw new GeminiServiceError(
    'GEMINI_INVALID_OUTPUT',
    valid.size > 1
      ? 'Gemini returned ambiguous fusion MM01 candidates'
      : 'Gemini returned no contract-valid fusion MM01 candidate',
  )
}

export function fusionModelLabel(config: FusionConfig): string {
  return `${config.gemini.model} + ${seedRequestModel(config.seed)}`
}

/**
 * Seed first records visual details from the full video when available plus
 * timestamped frames; any frame-only fallback is declared explicitly. Gemini
 * then sees the original full media plus that untrusted aid and independently
 * verifies the final MM01. The verified result continues through required C01,
 * local deterministic P02F, and downstream text-model P02.
 */
export async function analyzeWithFusion(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  config: FusionConfig,
  fetchImpl: typeof fetch = fetch,
  downstreamConfig: DownstreamTextConfig = downstreamTextConfigFromEnv(),
): Promise<MultimodalAnalysisBundle> {
  if (!config.gemini.apiKey) throw new Error('未配置 GEMINI_API_KEY')
  if (!config.seed.apiKey) throw new Error('未配置 SEED_API_KEY')
  const geminiVideo = resolvedGeminiVideoProcessing(config.gemini)

  let fusionReview: MultimodalFusionReview | undefined
  const fusionDiagnostics: NonNullable<
    MultimodalAnalysisBundle['diagnostics']['fusion']
  > = {
    strategy: 'seed_visual_then_gemini_verification',
    seedInputMode: 'keyframes_only',
    seedVideoFps: config.seed.videoFps,
    seedFrameCount: 0,
    seedObservationCount: 0,
    seedSequenceCount: 0,
  }
  const modelTrace: NonNullable<
    MultimodalAnalysisBundle['diagnostics']['models']
  > = [
    {
      role: 'visual_detail',
      provider: 'seed',
      model: seedRequestModel(config.seed),
    },
    {
      role: 'multimodal_synthesis',
      provider: 'gemini',
      model: config.gemini.model,
    },
    {
      role: 'context_research',
      provider: 'downstream',
      model: downstreamConfig.c01Model,
    },
    { role: 'p02', provider: 'downstream', model: downstreamConfig.p02Model },
  ]

  const result = await executeMultimodalPipeline({
    provider: 'fusion',
    profile: 'fusion',
    model: fusionModelLabel(config),
    request,
    media,
    policy: {
      availability: evidenceAvailabilityForPreparedMedia(media),
      enforceUnavailableModalities: true,
      requireAudioEvidence: true,
    },
    callMm01: async (repairInstruction) => {
      const seedResult = await analyzeSeedVisualDetails(
        media,
        config.seed,
        fetchImpl,
      )
      if (seedResult.reportedModel) modelTrace[0].model = seedResult.reportedModel
      fusionDiagnostics.seedFrameCount = seedResult.frameCount
      fusionDiagnostics.seedObservationCount = seedResult.report.observations.length
      fusionDiagnostics.seedSequenceCount =
        seedResult.report.sequenceObservations.length
      fusionDiagnostics.seedInputMode = seedResult.inputMode
      const geminiCall = await callGemini(
        buildFusionMm01Body(
          request,
          media,
          seedVisualContextText(seedResult.report),
          config.gemini,
          repairInstruction,
        ),
        config.gemini,
        fetchImpl,
      )
      if (geminiCall.reportedModel) modelTrace[1].model = geminiCall.reportedModel
      const parsed = selectFusionCandidate(geminiCall.candidates)
      fusionReview = parsed.fusionReview
      return {
        candidates: [parsed.mm01],
        usage: sumModelUsage(seedResult.usage, geminiCall.usage),
        reportedModel: geminiCall.reportedModel,
        callCount: 2,
      }
    },
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
      new GeminiServiceError('GEMINI_INVALID_OUTPUT', `Gemini fusion ${detail}`),
    modelCalls: 3,
    models: modelTrace,
    fusion: fusionDiagnostics,
    geminiVideo: {
      fps: geminiVideo.fps,
      mediaResolution: geminiVideo.mediaResolution,
    },
  })

  if (!fusionReview) {
    throw new GeminiServiceError(
      'GEMINI_INVALID_OUTPUT',
      'Gemini fusion did not return a review',
    )
  }
  return { ...result, fusionReview }
}
