import type { IncomingMessage } from 'node:http'
import { MM01_SYSTEM_PROMPT } from '../../src/prompts/mm01SystemPrompt.ts'
import {
  ANALYSIS_MODE_CONFIDENCE_CAP,
  type P02FormattedPromptCompilerOutput,
} from '../../src/contracts/multimodalAnalysis.ts'
import type { GeminiMediaPart, PreparedMedia } from './media.ts'
import {
  callC01ContextResearch,
  callP02TextBreakdown,
  downstreamTextConfigFromEnv,
  type DownstreamTextConfig,
} from './downstreamText.ts'
import {
  analysisModeForPreparedMedia,
  evidenceAvailabilityForPreparedMedia,
  executeMultimodalPipeline,
  multimodalContextText,
  type ModelCallResult,
  sanitizedReportedModel,
  type MultimodalSourceRequest,
} from './modelCore.ts'

export type { MultimodalSourceRequest } from './modelCore.ts'
export { analysisModeForPreparedMedia } from './modelCore.ts'

const DEFAULT_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_API_HOST = 'generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-3.1-pro-preview-thinking'
const DEFAULT_MAX_REQUEST_BYTES = 18 * 1024 * 1024
const DEFAULT_VIDEO_FPS = 2
const DEFAULT_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH'
const MAX_RESPONSE_TEXT_CHARS = 512 * 1024
const MAX_JSON_CANDIDATES = 512

export type GeminiMediaResolution =
  | 'MEDIA_RESOLUTION_LOW'
  | 'MEDIA_RESOLUTION_MEDIUM'
  | 'MEDIA_RESOLUTION_HIGH'

export interface GeminiVideoProcessing {
  fps: number
  mediaResolution: GeminiMediaResolution
}

export interface GeminiConfig {
  apiKey: string
  apiBaseUrl: string
  model: string
  timeoutMs: number
  /** Google accepts x-goog-api-key; compatible native-Gemini gateways may require Bearer auth. */
  authMode?: 'google-api-key' | 'bearer'
  /** Exact additional HTTPS hosts explicitly trusted by the server operator. */
  allowedApiHosts?: string[]
  maxRequestBytes?: number
  /** Google defaults to 1 FPS; short-form ads use a denser, configurable sample. */
  videoFps?: number
  /** Global generateContent media resolution; high helps OCR and small ad details. */
  mediaResolution?: GeminiMediaResolution
}

interface GeminiResponse {
  modelVersion?: string
  model?: string
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    cachedContentTokenCount?: number
  }
}

type GeminiFailureCode =
  | 'GEMINI_TIMEOUT'
  | 'GEMINI_BLOCKED'
  | 'GEMINI_UPSTREAM_FAILED'
  | 'GEMINI_INVALID_OUTPUT'
  | 'GEMINI_REQUEST_TOO_LARGE'

export class GeminiServiceError extends Error {
  override name = 'GeminiServiceError'
  readonly code: GeminiFailureCode

  constructor(
    code: GeminiFailureCode,
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

const stringArray = { type: 'array', items: { type: 'string' } } as const

const evidenceSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['visual', 'speech', 'text', 'audio', 'emotion', 'inference'],
    },
    fact: { type: 'string' },
    source: {
      type: 'string',
      enum: ['frame', 'ocr', 'asr', 'audio', 'model_inference'],
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['type', 'fact', 'source', 'confidence'],
} as const

const confidenceSchema = { type: 'string', enum: ['high', 'medium', 'low'] } as const

const eventTimelineSchema = {
  type: 'object',
  properties: {
    timeRange: { type: 'string' },
    literalEvent: { type: 'string' },
    visibleEvidenceRefs: stringArray,
    textEvidenceRefs: stringArray,
    speechEvidenceRefs: stringArray,
    audioEvidenceRefs: stringArray,
    inferenceEvidenceRefs: stringArray,
    certainty: confidenceSchema,
  },
  required: [
    'timeRange',
    'literalEvent',
    'visibleEvidenceRefs',
    'textEvidenceRefs',
    'speechEvidenceRefs',
    'audioEvidenceRefs',
    'inferenceEvidenceRefs',
    'certainty',
  ],
} as const

const narrativeMapSchema = {
  type: 'object',
  properties: {
    who: { type: 'string' },
    where: { type: 'string' },
    initialSituation: { type: 'string' },
    problemOrDesire: { type: 'string' },
    escalation: { type: 'string' },
    turningPoint: { type: 'string' },
    outcome: { type: 'string' },
    impliedMeaning: { type: 'string' },
    audienceTakeaway: { type: 'string' },
    unknowns: stringArray,
    evidenceRefs: stringArray,
  },
  required: [
    'who',
    'where',
    'initialSituation',
    'problemOrDesire',
    'escalation',
    'turningPoint',
    'outcome',
    'impliedMeaning',
    'audienceTakeaway',
    'unknowns',
    'evidenceRefs',
  ],
} as const

const attentionEntrySchema = {
  type: 'object',
  properties: {
    segmentId: { type: 'string' },
    timeRange: { type: 'string' },
    role: {
      type: 'string',
      enum: ['hook', 'setup', 'conflict', 'peak', 'reveal', 'proof', 'cta', 'filler', 'unknown'],
    },
    importanceScore: { type: 'integer', minimum: 1, maximum: 5 },
    reason: { type: 'string' },
    evidenceRefs: stringArray,
    reuseType: {
      type: 'string',
      enum: ['keep_structure', 'replace_detail', 'drop', 'unknown'],
    },
    risk: stringArray,
  },
  required: [
    'segmentId',
    'timeRange',
    'role',
    'importanceScore',
    'reason',
    'evidenceRefs',
    'reuseType',
    'risk',
  ],
} as const

const contextGapSchema = {
  type: 'object',
  properties: {
    gap: { type: 'string' },
    entities: stringArray,
    neededFor: {
      type: 'string',
      enum: [
        'understand_joke_or_plot',
        'understand_location_or_event',
        'understand_cultural_rule',
        'understand_symbol_or_object',
        'risk_review',
        'unknown',
      ],
    },
    evidenceRefs: stringArray,
    searchQueries: stringArray,
  },
  required: ['gap', 'entities', 'neededFor', 'evidenceRefs', 'searchQueries'],
} as const

const interpretationCandidateSchema = {
  type: 'object',
  properties: {
    claim: { type: 'string' },
    supportingEvidenceRefs: stringArray,
    contradictingEvidenceRefs: stringArray,
    confidence: confidenceSchema,
    reasoningLimits: { type: 'string' },
  },
  required: [
    'claim',
    'supportingEvidenceRefs',
    'contradictingEvidenceRefs',
    'confidence',
    'reasoningLimits',
  ],
} as const

const crossModalChecksSchema = {
  type: 'object',
  properties: {
    captionVsVideo: { type: 'string', enum: ['consistent', 'conflict', 'unknown'] },
    asrVsOcr: { type: 'string', enum: ['consistent', 'conflict', 'unknown'] },
    audioVsEmotion: { type: 'string', enum: ['consistent', 'conflict', 'unknown'] },
    notes: { type: 'string' },
  },
  required: ['captionVsVideo', 'asrVsOcr', 'audioVsEmotion', 'notes'],
} as const

export const MM01_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    module: { type: 'string', enum: ['MM01_MULTIMODAL_ANALYSIS_PACK'] },
    targetNextPrompt: { type: 'string', enum: ['C01'] },
    sourceMeta: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['tiktok', 'meta', 'youtube', 'unknown'],
        },
        sourceUrl: { type: 'string' },
        marketId: { type: 'string' },
        marketLanguages: stringArray,
        title: { type: 'string' },
        caption: { type: 'string' },
        durationSec: { type: 'number', minimum: 0 },
      },
      required: [
        'platform',
        'sourceUrl',
        'marketId',
        'marketLanguages',
        'title',
        'caption',
        'durationSec',
      ],
    },
    modalityStatus: {
      type: 'object',
      properties: {
        videoFrames: { type: 'string', enum: ['ok', 'partial', 'failed'] },
        ocr: {
          type: 'string',
          enum: ['ok', 'partial', 'missing', 'failed'],
        },
        asr: {
          type: 'string',
          enum: ['ok', 'partial', 'missing', 'failed'],
        },
        audio: {
          type: 'string',
          enum: ['ok', 'partial', 'missing', 'failed'],
        },
        analysisMode: {
          type: 'string',
          enum: ['full_video', 'compressed_video', 'audio_frames', 'text_fallback'],
        },
        confidenceCap: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: [
        'videoFrames',
        'ocr',
        'asr',
        'audio',
        'analysisMode',
        'confidenceCap',
      ],
    },
    cleanedInputsForP02: {
      type: 'object',
      properties: {
        transcriptStatus: {
          type: 'string',
          enum: ['ok', 'partial', 'missing', 'failed'],
        },
        rawTranscript: { type: 'string' },
        visualDescription: { type: 'string' },
        ocrText: { type: 'string' },
        audioDescription: { type: 'string' },
        sceneSegmentsText: { type: 'string' },
      },
      required: [
        'transcriptStatus',
        'rawTranscript',
        'visualDescription',
        'ocrText',
        'audioDescription',
        'sceneSegmentsText',
      ],
    },
    sceneSegments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          segmentId: { type: 'string' },
          timeRange: { type: 'string' },
          sceneFunctionGuess: {
            type: 'string',
            enum: [
              'hook',
              'setup',
              'conflict',
              'escalation',
              'reveal',
              'proof',
              'cta',
              'unknown',
            ],
          },
          visual: {
            type: 'object',
            properties: {
              people: { type: 'string' },
              setting: { type: 'string' },
              productOrObject: { type: 'string' },
              camera: { type: 'string' },
              style: { type: 'string' },
            },
            required: ['people', 'setting', 'productOrObject', 'camera', 'style'],
          },
          ocr: {
            type: 'object',
            properties: {
              texts: stringArray,
              textRoleGuess: {
                type: 'string',
                enum: [
                  'hook',
                  'subtitle',
                  'product_claim',
                  'discount',
                  'cta',
                  'unknown',
                ],
              },
            },
            required: ['texts', 'textRoleGuess'],
          },
          asr: {
            type: 'object',
            properties: {
              speech: { type: 'string' },
              language: { type: 'string' },
              speakerGuess: { type: 'string' },
            },
            required: ['speech', 'language', 'speakerGuess'],
          },
          audio: {
            type: 'object',
            properties: {
              musicMood: { type: 'string' },
              sfx: stringArray,
              voiceTone: { type: 'string' },
            },
            required: ['musicMood', 'sfx', 'voiceTone'],
          },
          emotion: {
            type: 'object',
            properties: {
              viewerEmotionGuess: { type: 'string' },
              characterEmotion: { type: 'string' },
            },
            required: ['viewerEmotionGuess', 'characterEmotion'],
          },
          evidence: { type: 'array', items: evidenceSchema },
        },
        required: [
          'segmentId',
          'timeRange',
          'sceneFunctionGuess',
          'visual',
          'ocr',
          'asr',
          'audio',
          'emotion',
          'evidence',
        ],
      },
    },
    globalUnderstanding: {
      type: 'object',
      properties: {
        topicGuess: { type: 'string' },
        actionReasonGuess: {
          type: 'object',
          properties: {
            intendedAction: { type: 'string' },
            persuasionReason: { type: 'string' },
          },
          required: ['intendedAction', 'persuasionReason'],
        },
        persuasionStrategyGuess: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'direct_showcase',
              'human_experience',
              'contrast',
              'surprise_humor',
              'symbolism',
              'culture_meme',
              'physical_process',
              'quality_transfer',
              'atypical_object',
              'unknown',
            ],
          },
        },
        localStyleSignals: {
          type: 'object',
          properties: {
            casting: { type: 'string' },
            environment: { type: 'string' },
            composition: { type: 'string' },
            colorTone: { type: 'string' },
            textOverlayStyle: { type: 'string' },
            productPresentation: { type: 'string' },
            risk: stringArray,
          },
          required: [
            'casting',
            'environment',
            'composition',
            'colorTone',
            'textOverlayStyle',
            'productPresentation',
            'risk',
          ],
        },
      },
      required: [
        'topicGuess',
        'actionReasonGuess',
        'persuasionStrategyGuess',
        'localStyleSignals',
      ],
    },
    eventTimeline: { type: 'array', items: eventTimelineSchema },
    narrativeMap: narrativeMapSchema,
    attentionMap: { type: 'array', items: attentionEntrySchema },
    contextGaps: { type: 'array', items: contextGapSchema },
    interpretationCandidates: {
      type: 'array',
      items: interpretationCandidateSchema,
    },
    crossModalChecks: crossModalChecksSchema,
    qualityFlags: {
      type: 'object',
      properties: {
        missingCriticalInfo: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['asr', 'ocr', 'videoFrames', 'audio'],
          },
        },
        needsHumanReview: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['missingCriticalInfo', 'needsHumanReview', 'reason'],
    },
  },
  required: [
    'module',
    'targetNextPrompt',
    'sourceMeta',
    'modalityStatus',
    'cleanedInputsForP02',
    'sceneSegments',
    'globalUnderstanding',
    'eventTimeline',
    'narrativeMap',
    'attentionMap',
    'contextGaps',
    'interpretationCandidates',
    'crossModalChecks',
    'qualityFlags',
  ],
} as const

export const P02_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string' },
    tags: stringArray,
    subtitleBody: { type: 'string' },
    sourceFactSummary: { type: 'string' },
    evidenceBeats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['visual', 'speech', 'text', 'audio', 'emotion', 'inference'],
          },
          fact: { type: 'string', description: '对应 MM01 证据事实；服务端会按引用回填原文' },
          evidence: {
            type: 'string',
            description: '必须以 P02F 中存在的稳定引用 [MM01-E###] 开头，再说明时间段和来源',
          },
        },
        required: ['type', 'fact', 'evidence'],
      },
    },
    keyMoments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timeRange: { type: 'string' },
          role: {
            type: 'string',
            enum: [
              'hook',
              'setup',
              'conflict',
              'peak',
              'reveal',
              'proof',
              'cta',
              'filler',
              'unknown',
            ],
          },
          fact: { type: 'string' },
          whyImportant: { type: 'string' },
          evidenceRefs: stringArray,
        },
        required: ['timeRange', 'role', 'fact', 'whyImportant', 'evidenceRefs'],
      },
    },
    sourceVsContextBoundary: {
      type: 'object',
      properties: {
        videoFacts: stringArray,
        externalContextUsed: stringArray,
        contextSupportedInferences: stringArray,
      },
      required: ['videoFacts', 'externalContextUsed', 'contextSupportedInferences'],
    },
    narrativeMechanics: {
      type: 'object',
      properties: {
        audienceReason: { type: 'string' },
        narrativeEngine: { type: 'string' },
        payoffLogic: { type: 'string' },
        preservedSignals: stringArray,
        replaceableSurface: stringArray,
        forbiddenSurface: stringArray,
        evidenceRefs: stringArray,
      },
      required: [
        'audienceReason',
        'narrativeEngine',
        'payoffLogic',
        'preservedSignals',
        'replaceableSurface',
        'forbiddenSurface',
        'evidenceRefs',
      ],
    },
    riskRefs: stringArray,
    uncertaintyNotes: { type: 'string' },
    riskAnnotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          atomicRiskKind: {
            type: 'string',
            enum: [
              'base_core',
              'aggressive_variant',
              'dangerous_combination',
              'absolute_claim',
              'high_risk_carrier',
            ],
          },
          handlingAppliesTo: { type: 'string' },
          evidenceRefs: stringArray,
          riskType: {
            type: 'string',
            enum: [
              'sensitive_topic',
              'factual_uncertainty',
              'unsafe_depiction',
              'prohibited_behavior',
              'brand_copyright',
              'identity_privacy',
            ],
          },
          riskScope: {
            type: 'string',
            enum: ['topic', 'claim', 'behavior', 'visual_carrier', 'wording'],
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          recommendedHandling: {
            type: 'string',
            enum: ['retain', 'qualify', 'verify', 'transform', 'remove'],
          },
        },
        required: [
          'content',
          'atomicRiskKind',
          'handlingAppliesTo',
          'evidenceRefs',
          'riskType',
          'riskScope',
          'confidence',
          'recommendedHandling',
        ],
      },
    },
    factualUncertainties: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          evidenceStatus: {
            type: 'string',
            enum: ['direct', 'inferred', 'external_context_only'],
          },
          allowedWording: { type: 'string' },
          verificationNeeded: { type: 'boolean' },
        },
        required: [
          'claim',
          'evidenceStatus',
          'allowedWording',
          'verificationNeeded',
        ],
      },
    },
    story: { type: 'string' },
    coreHook: { type: 'string' },
    storyCharCount: { type: 'integer' },
    transcriptUsed: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string' },
  },
  required: [
    'theme',
    'tags',
    'subtitleBody',
    'sourceFactSummary',
    'evidenceBeats',
    'keyMoments',
    'sourceVsContextBoundary',
    'narrativeMechanics',
    'riskRefs',
    'uncertaintyNotes',
    'riskAnnotations',
    'factualUncertainties',
    'story',
    'coreHook',
    'storyCharCount',
    'transcriptUsed',
    'confidence',
    'notes',
  ],
} as const

export { MM01_SYSTEM_PROMPT }

export const P02_SYSTEM_PROMPT = `
你是同事链路中的 P02 视频事实拆解器。你只会收到服务端本地确定性编译的 P02F 文本，不会收到媒体文件。

硬性规则：
1. 只能依据 P02F 中保留的 MM01 视频证据和带真实来源的 C01 搜索语境包；不得补写未出现的画面、对白、OCR、声音、人物身份、品牌、地点或因果。
2. 输出字段必须严格符合 Schema。tags 必须 3-8 个且不重复；evidenceBeats 必须 3-5 个，并至少含一个 visual/speech/text/audio 直接模态证据；keyMoments 必须 1-8 个且至少包含 hook。每个 evidenceBeats、keyMoments 和 narrativeMechanics.evidenceRefs 必须选择 P02F 中真实存在的 [MM01-E###] 引用；不得重复伪造引用，type 必须一致，fact 必须原样复制（包括三层证据标记）。服务端会按引用回填 MM01 原事实，因此不得改写、拼接或新增视频事实。
3. story 必须完整复述事实，按 Unicode 字符计数严格为 50-200 个字符；storyCharCount 必须等于 story 去掉首尾空白后的实际字符数。
4. coreHook 必须有证据且最多 40 个字符。
5. subtitleBody 只能来自可用 transcript；transcript 缺失/失败时必须为空且 transcriptUsed=false，不得输出 speech evidence。否则 transcriptUsed 必须与 subtitleBody 是否非空完全一致。
6. confidence 不得超过 P02F 中的 confidenceCap。推断要标 inference，不得伪装为事实。
7. 必须在 sourceVsContextBoundary 中区分 videoFacts、externalContextUsed、contextSupportedInferences；外部语境只能解释 MM01 已观察到的实体、地点、行为或符号，不能单独写成视频事实。
8. 必须输出 narrativeMechanics：用通用语言抽象 audienceReason、narrativeEngine、payoffLogic、preservedSignals、replaceableSurface、forbiddenSurface、evidenceRefs。它描述“观众为什么看、叙事/笑点/情绪如何运转、结尾为什么成立”，不能写成某个固定案例模板。
9. narrativeMechanics 只能来自 keyMoments、evidenceBeats、sourceVsContextBoundary 和证据支持的推断；不得只保留地点、道具、时间字幕等表层元素。replaceableSurface 写可替换表层，forbiddenSurface 写因安全、版权、品牌、真实人物、冒犯或违规而不可继承的表层。
10. 必须输出 riskAnnotations 与 factualUncertainties。风险必须区分敏感主题、事实不确定、危险表现、禁止行为、版权品牌和身份隐私，并标明作用于 topic、claim、behavior、visual_carrier 还是 wording；evidenceRefs 仍只能使用有效 MM01-E###。
11. P02 是内部理解稿：首要目标是把原素材在画面、内容、语境和文化暗线上的真实创意含义讲透。风险标注只记录边界，不得提前消毒、弱化、泛化或广告化。
12. 敏感、粗俗、禁忌、地下、冒犯或违法边缘语境如果是原素材笑点、冲突或 payoff 的成立条件，必须准确写明其叙事作用；现实事实未验证时用“疑似 / 暗示 / 支持 / 不能证明”等限定，而不是回避核心含义。
13. 具体词、短语、声音、动作或道具若是误会、双关、反转或 payoff 的事实触发点，必须原样进入 preservedSignals 与 base_core 风险原子项，不得泛化为“某个词/敏感表达/风险表层”。riskAnnotations 是理解层 annotation，不得让 theme/story/sourceFactSummary/narrativeMechanics 变模糊。
14. 优先选择证据引用多、跨模态冲突少、时间因果链闭合、语境适用边界清楚的解释。
15. 不得输出卖点匹配、改写方案、制作脚本或投放建议。

只返回一个严格符合响应 Schema 的 JSON 值，不要返回 Markdown、解释或额外字段。`.trim()

export function parseGeminiAuthMode(
  rawValue?: string,
): NonNullable<GeminiConfig['authMode']> {
  const value = rawValue?.trim().toLowerCase()
  if (!value || value === 'google-api-key') return 'google-api-key'
  if (value === 'bearer') return 'bearer'
  throw new Error('GEMINI_API_AUTH_MODE 仅支持 google-api-key 或 bearer')
}

function normalizeAllowedHost(rawHost: string): string {
  const candidate = rawHost.trim().toLowerCase()
  if (!candidate || candidate.includes('*')) {
    throw new Error('GEMINI_API_ALLOWED_HOSTS 仅支持精确主机名，不支持通配符')
  }
  let url: URL
  try {
    url = new URL(`https://${candidate}`)
  } catch {
    throw new Error('GEMINI_API_ALLOWED_HOSTS 包含无效主机名')
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
    throw new Error('GEMINI_API_ALLOWED_HOSTS 包含不安全的主机名')
  }
  return url.host.toLowerCase()
}

export function parseAllowedApiHosts(rawValue?: string): string[] {
  if (!rawValue?.trim()) return []
  return [...new Set(rawValue.split(',').map(normalizeAllowedHost))]
}

export function validateGeminiApiBaseUrl(
  rawUrl: string,
  additionalAllowedHosts: string[] = [],
): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('GEMINI_API_BASE_URL 不是有效 URL')
  }
  if (url.protocol !== 'https:') throw new Error('GEMINI_API_BASE_URL 必须使用 HTTPS')
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('GEMINI_API_BASE_URL 不允许账号信息、查询参数或片段')
  }
  const allowedHosts = new Set([
    DEFAULT_API_HOST,
    ...additionalAllowedHosts.map(normalizeAllowedHost),
  ])
  if (!allowedHosts.has(url.host.toLowerCase())) {
    throw new Error('GEMINI_API_BASE_URL 主机不在显式 allowlist 中')
  }
  return url.toString().replace(/\/$/, '')
}

export function geminiConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GeminiConfig {
  const allowedApiHosts = parseAllowedApiHosts(env.GEMINI_API_ALLOWED_HOSTS)
  const apiBaseUrl = validateGeminiApiBaseUrl(
    env.GEMINI_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
    allowedApiHosts,
  )
  const requestLimit = Number(env.GEMINI_REQUEST_MAX_BYTES)
  const rawVideoFps = env.GEMINI_VIDEO_FPS?.trim()
  const videoFps = rawVideoFps ? Number(rawVideoFps) : DEFAULT_VIDEO_FPS
  if (!Number.isFinite(videoFps) || videoFps <= 0 || videoFps > 24) {
    throw new Error('GEMINI_VIDEO_FPS 必须大于 0 且不超过 24')
  }
  const rawMediaResolution =
    env.GEMINI_MEDIA_RESOLUTION?.trim().toUpperCase() ||
    DEFAULT_MEDIA_RESOLUTION
  if (
    rawMediaResolution !== 'MEDIA_RESOLUTION_LOW' &&
    rawMediaResolution !== 'MEDIA_RESOLUTION_MEDIUM' &&
    rawMediaResolution !== 'MEDIA_RESOLUTION_HIGH'
  ) {
    throw new Error(
      'GEMINI_MEDIA_RESOLUTION 仅支持 MEDIA_RESOLUTION_LOW、MEDIA_RESOLUTION_MEDIUM 或 MEDIA_RESOLUTION_HIGH',
    )
  }
  return {
    apiKey: env.GEMINI_API_KEY?.trim() ?? '',
    apiBaseUrl,
    model:
      env.GEMINI_MULTIMODAL_MODEL?.trim() ||
      env.GEMINI_MODEL?.trim() ||
      DEFAULT_MODEL,
    timeoutMs: Number(env.GEMINI_TIMEOUT_MS) || 300_000,
    authMode: parseGeminiAuthMode(env.GEMINI_API_AUTH_MODE),
    allowedApiHosts,
    maxRequestBytes:
      Number.isFinite(requestLimit) && requestLimit > 0
        ? requestLimit
        : DEFAULT_MAX_REQUEST_BYTES,
    videoFps,
    mediaResolution: rawMediaResolution,
  }
}

function runtimeGeminiKey(request: Pick<IncomingMessage, 'headers'>): string {
  const raw = request.headers['x-intent-gemini-key']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.length <= 512 ? normalized : ''
}

/** Per-request keys override the server default and exist only in this call stack. */
export function geminiConfigForRequest(
  request: Pick<IncomingMessage, 'headers'>,
  env: Record<string, string | undefined> = process.env,
): GeminiConfig {
  const config = geminiConfigFromEnv(env)
  return { ...config, apiKey: runtimeGeminiKey(request) || config.apiKey }
}

export function resolvedGeminiVideoProcessing(
  config: Pick<GeminiConfig, 'videoFps' | 'mediaResolution'> = {},
): GeminiVideoProcessing {
  const fps = config.videoFps ?? DEFAULT_VIDEO_FPS
  if (!Number.isFinite(fps) || fps <= 0 || fps > 24) {
    throw new Error('Gemini video FPS 必须大于 0 且不超过 24')
  }
  const mediaResolution =
    config.mediaResolution ?? DEFAULT_MEDIA_RESOLUTION
  if (
    mediaResolution !== 'MEDIA_RESOLUTION_LOW' &&
    mediaResolution !== 'MEDIA_RESOLUTION_MEDIUM' &&
    mediaResolution !== 'MEDIA_RESOLUTION_HIGH'
  ) {
    throw new Error('Gemini media resolution 配置无效')
  }
  return { fps, mediaResolution }
}

function orderedMediaParts(
  parts: GeminiMediaPart[],
  videoFps = DEFAULT_VIDEO_FPS,
): GeminiMediaPart[] {
  const wholeMedia = parts.filter(
    (part) =>
      'inlineData' in part &&
      (part.inlineData.mimeType.startsWith('video/') ||
        part.inlineData.mimeType.startsWith('audio/')),
  )
  const evidenceParts = parts.filter((part) => !wholeMedia.includes(part))
  return [
    ...wholeMedia.map((part) =>
      'inlineData' in part && part.inlineData.mimeType.startsWith('video/')
        ? { ...part, videoMetadata: { fps: videoFps } }
        : part,
    ),
    ...evidenceParts,
  ]
}

export function buildMm01GenerateContentBody(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  supplementalContext?: string,
  processing: Pick<GeminiConfig, 'videoFps' | 'mediaResolution'> = {},
  repairInstruction?: string,
): Record<string, unknown> {
  const analysisMode = analysisModeForPreparedMedia(media)
  const confidenceCap = ANALYSIS_MODE_CONFIDENCE_CAP[analysisMode]
  const videoProcessing = resolvedGeminiVideoProcessing(processing)
  const parts: GeminiMediaPart[] = [
    ...orderedMediaParts(media.parts, videoProcessing.fps),
    ...(supplementalContext?.trim()
      ? [{ text: supplementalContext.trim() }]
      : []),
    { text: multimodalContextText(request, media, analysisMode, confidenceCap) },
    ...(repairInstruction?.trim()
      ? [{ text: repairInstruction.trim() }]
      : []),
  ]
  return {
    systemInstruction: { parts: [{ text: MM01_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // Gemini 3 reasoning is optimized for the provider default of 1.0.
      temperature: 1,
      maxOutputTokens: 32_768,
      responseMimeType: 'application/json',
      responseSchema: MM01_RESPONSE_SCHEMA,
      mediaResolution: videoProcessing.mediaResolution,
    },
  }
}

export function buildP02GenerateContentBody(
  handoff: P02FormattedPromptCompilerOutput,
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: P02_SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: handoff.p02FormattedPrompt }],
      },
    ],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 8_192,
      responseMimeType: 'application/json',
      responseSchema: P02_RESPONSE_SCHEMA,
    },
  }
}

function extractResponseTexts(response: GeminiResponse): string[] {
  const texts: string[] = []
  const seen = new Set<string>()
  const parts = (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && part.text?.trim())
    .map((part) => part.text!.trim())
  // Compatible gateways sometimes put a draft/explanation in one part and
  // the schema-bound final answer in the last part. Prefer the last part,
  // then fall back to the complete joined stream when JSON was split.
  for (const text of [...parts].reverse()) {
    if (!seen.has(text)) {
      seen.add(text)
      texts.push(text)
    }
  }
  const joined = parts.join('').trim()
  if (joined && !seen.has(joined)) {
    seen.add(joined)
    texts.push(joined)
  }
  if (texts.length > 0) return texts
  if (response.promptFeedback?.blockReason) {
    throw new GeminiServiceError('GEMINI_BLOCKED', 'Gemini blocked the request')
  }
  throw new GeminiServiceError('GEMINI_INVALID_OUTPUT', 'Gemini returned no JSON content')
}

function embeddedJsonObjects(text: string): string[] {
  const objects: string[] = []
  const starts: number[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"' && starts.length > 0) {
      inString = true
      continue
    }
    if (char === '{') {
      starts.push(index)
    }
    else if (char === '}') {
      const start = starts.pop()
      if (start !== undefined) {
        objects.push(text.slice(start, index + 1))
        if (objects.length > MAX_JSON_CANDIDATES) {
          throw new GeminiServiceError(
            'GEMINI_INVALID_OUTPUT',
            'Gemini returned too many JSON candidates',
          )
        }
      }
    }
  }
  return objects
}

function jsonParseFailure(text: string, fenced: boolean, candidateCount: number): GeminiServiceError {
  const first = text.slice(0, 1) || 'empty'
  const last = text.slice(-1) || 'empty'
  return new GeminiServiceError(
    'GEMINI_INVALID_OUTPUT',
    `Gemini returned invalid JSON (chars=${text.length}, fenced=${fenced}, candidates=${candidateCount}, first=${JSON.stringify(first)}, last=${JSON.stringify(last)})`,
  )
}

/**
 * Return every independently parseable root object from a gateway text.
 * Ordering deliberately prefers the last embedded object because compatible
 * gateways commonly emit analysis/drafts before the schema-bound final JSON.
 * Contract validation still decides whether any candidate is authoritative.
 */
export function parseGeminiJsonCandidates(text: string): unknown[] {
  const trimmed = text.trim()
  if (trimmed.length > MAX_RESPONSE_TEXT_CHARS) {
    throw new GeminiServiceError(
      'GEMINI_INVALID_OUTPUT',
      'Gemini response text exceeds the configured limit',
    )
  }
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const direct = (fence?.[1] ?? trimmed).trim()
  const serializedCandidates = [direct, ...embeddedJsonObjects(direct).reverse()]
  const seen = new Set<string>()
  const parsed: unknown[] = []
  for (const candidate of serializedCandidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    try {
      parsed.push(JSON.parse(candidate) as unknown)
    } catch {
      // A wrapper or prose fragment is expected here; only independently valid
      // JSON values proceed to the strict MM01/P02 validators.
    }
  }
  if (parsed.length > 0) return parsed
  throw jsonParseFailure(direct, Boolean(fence), 0)
}

export function parseGeminiJsonText(text: string): unknown {
  const candidates = parseGeminiJsonCandidates(text)
  if (candidates.length !== 1) {
    const trimmed = text.trim()
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    const direct = (fence?.[1] ?? trimmed).trim()
    throw jsonParseFailure(direct, Boolean(fence), candidates.length)
  }
  return candidates[0]
}

function requestHeaders(config: GeminiConfig): Record<string, string> {
  return config.authMode === 'bearer'
    ? {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      }
    : {
        'content-type': 'application/json',
        'x-goog-api-key': config.apiKey,
      }
}

export async function callGemini(
  body: Record<string, unknown>,
  config: GeminiConfig,
  fetchImpl: typeof fetch,
): Promise<ModelCallResult> {
  const apiBaseUrl = validateGeminiApiBaseUrl(
    config.apiBaseUrl,
    config.allowedApiHosts,
  )
  const endpoint = `${apiBaseUrl}/models/${encodeURIComponent(config.model)}:generateContent`
  const requestBody = JSON.stringify(body)
  const maxRequestBytes = config.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES
  if (!Number.isFinite(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new GeminiServiceError(
      'GEMINI_REQUEST_TOO_LARGE',
      'Gemini request byte limit is invalid',
    )
  }
  if (Buffer.byteLength(requestBody, 'utf8') > maxRequestBytes) {
    throw new GeminiServiceError(
      'GEMINI_REQUEST_TOO_LARGE',
      'Gemini request exceeds the configured byte limit',
    )
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: requestHeaders(config),
      body: requestBody,
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    if (/timeout|aborted|aborterror/i.test(error instanceof Error ? error.message : '')) {
      throw new GeminiServiceError('GEMINI_TIMEOUT', 'Gemini request timed out')
    }
    throw new GeminiServiceError('GEMINI_UPSTREAM_FAILED', 'Gemini request failed')
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null
  if (!response.ok) {
    throw new GeminiServiceError('GEMINI_UPSTREAM_FAILED', 'Gemini upstream rejected the request')
  }
  if (!data) {
    throw new GeminiServiceError('GEMINI_INVALID_OUTPUT', 'Gemini returned an invalid envelope')
  }
  const parsed: unknown[] = []
  const seen = new Set<string>()
  let lastParseError: GeminiServiceError | undefined
  for (const text of extractResponseTexts(data)) {
    try {
      for (const candidate of parseGeminiJsonCandidates(text)) {
        const fingerprint = JSON.stringify(candidate)
        if (!seen.has(fingerprint)) {
          seen.add(fingerprint)
          parsed.push(candidate)
        }
      }
    } catch (error) {
      if (error instanceof GeminiServiceError) lastParseError = error
    }
  }
  if (parsed.length > 0) {
    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount,
          outputTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
          cachedInputTokens: data.usageMetadata.cachedContentTokenCount,
        }
      : undefined
    return {
      candidates: parsed,
      usage,
      reportedModel: sanitizedReportedModel(data.modelVersion ?? data.model),
    }
  }
  throw lastParseError ?? new GeminiServiceError(
    'GEMINI_INVALID_OUTPUT',
    'Gemini returned no parseable JSON candidates',
  )
}

/**
 * Execute the branch in order: MM01 Gemini -> required C01 search model ->
 * local P02F -> downstream text-model P02.
 */
export async function analyzeWithGemini(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  config = geminiConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
  downstreamConfig: DownstreamTextConfig = downstreamTextConfigFromEnv(),
): ReturnType<typeof executeMultimodalPipeline> {
  if (!config.apiKey) throw new Error('未配置 GEMINI_API_KEY')
  const videoProcessing = resolvedGeminiVideoProcessing(config)
  return executeMultimodalPipeline({
    provider: 'gemini',
    profile: 'gemini',
    model: config.model,
    request,
    media,
    policy: {
      availability: evidenceAvailabilityForPreparedMedia(media),
      enforceUnavailableModalities: true,
      requireAudioEvidence: true,
    },
    callMm01: (repairInstruction) =>
      callGemini(
        buildMm01GenerateContentBody(
          request,
          media,
          undefined,
          config,
          repairInstruction,
        ),
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
      new GeminiServiceError('GEMINI_INVALID_OUTPUT', `Gemini ${detail}`),
    geminiVideo: {
      fps: videoProcessing.fps,
      mediaResolution: videoProcessing.mediaResolution,
    },
    models: [
      {
        role: 'multimodal_synthesis',
        provider: 'gemini',
        model: config.model,
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
