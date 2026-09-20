import type { IncomingMessage } from 'node:http'
import {
  callGemini,
  geminiConfigForRequest,
  geminiConfigFromEnv,
  type GeminiConfig,
} from '../multimodal/gemini.ts'
import type { PreparedMedia } from '../multimodal/media.ts'
import {
  parseImageAnalysisPack,
  type ImageAnalysisPack,
} from '../../src/contracts/imageAnalysis.ts'
import type { Platform } from '../../src/contracts/multimodalAnalysis.ts'

export interface ImageAnalysisSourceRequest {
  sourceUrl?: string
  imageUrl?: string
  imageUrls?: string[]
  platform?: Platform
  marketId: string
  marketLanguages: string[]
  title: string
  caption: string
}

export interface ImageAnalysisResult {
  analysis: ImageAnalysisPack
  diagnostics: {
    provider: 'gemini'
    profile: 'im01'
    model: string
    mediaMode: PreparedMedia['mode']
    imageCount: number
    elapsedMs: number
    usage?: Awaited<ReturnType<typeof callGemini>>['usage']
    reportedModel?: string
    warnings: string[]
  }
}

const confidenceSchema = { type: 'string', enum: ['high', 'medium', 'low'] } as const
const boxSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['xPct', 'yPct', 'wPct', 'hPct'],
  properties: {
    xPct: { type: 'number' },
    yPct: { type: 'number' },
    wPct: { type: 'number' },
    hPct: { type: 'number' },
  },
} as const

const IM01_SYSTEM_PROMPT = `你是 AI Creative Workflow 图片广告多模态分析模块 IM01。
你的唯一职责是识别原图事实、OCR、版式、空间位置、视觉风格、图文关系、广告语义和风险表层。
不要改写，不要生成新广告，不要判断 Demo App 卖点，不要写生图提示词。

硬约束：
1. 所有可见文字必须逐块 OCR；不要把不同位置的文字合并成一条。
2. 所有主要视觉对象和文字块必须给出 0-100 百分比坐标 xPct/yPct/wPct/hPct。位置不确定时给估计值并降低 confidence。
3. 必须区分事实观察、图文推断、广告语义解读和不可验证猜测。
4. 原品牌、原 App 名、logo、CTA、价格、具体数字承诺、敏感身份标签、名人/IP、水印等必须进入 riskAndCleanup。
5. 不要因为后续要洗稿而提前删除敏感或品牌信息；IM01 是内部识别层，必须完整标出。`

const IM01_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'module',
    'sourceMeta',
    'imageGeometry',
    'visualInventory',
    'ocrBlocks',
    'layoutMap',
    'styleProfile',
    'semanticRead',
    'riskAndCleanup',
    'notes',
    'confidence',
  ],
  properties: {
    module: { type: 'string', enum: ['IM01_IMAGE_ANALYSIS_PACK'] },
    sourceMeta: {
      type: 'object',
      additionalProperties: false,
      required: [
        'platform',
        'sourceUrl',
        'imageUrl',
        'marketId',
        'marketLanguages',
        'title',
        'caption',
      ],
      properties: {
        platform: { type: 'string', enum: ['tiktok', 'meta', 'youtube', 'unknown'] },
        sourceUrl: { type: 'string' },
        imageUrl: { type: 'string' },
        marketId: { type: 'string' },
        marketLanguages: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        caption: { type: 'string' },
      },
    },
    imageGeometry: {
      type: 'object',
      additionalProperties: false,
      required: ['aspectRatio', 'width', 'height', 'safeArea'],
      properties: {
        aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9', 'unknown'] },
        width: { type: 'number' },
        height: { type: 'number' },
        safeArea: { type: 'string' },
      },
    },
    visualInventory: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'type',
          'description',
          'absolutePosition',
          'relativePosition',
          'visualRole',
          'confidence',
        ],
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'person',
              'phone',
              'app_ui',
              'product',
              'logo',
              'background',
              'icon',
              'button',
              'food',
              'object',
              'other',
            ],
          },
          description: { type: 'string' },
          absolutePosition: boxSchema,
          relativePosition: { type: 'string' },
          visualRole: {
            type: 'string',
            enum: ['hook', 'proof', 'context', 'decoration', 'brand_signal', 'cta', 'supporting'],
          },
          confidence: confidenceSchema,
        },
      },
    },
    ocrBlocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'text',
          'language',
          'absolutePosition',
          'relativePosition',
          'fontScale',
          'textRole',
          'verbatimSensitivity',
          'confidence',
        ],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          absolutePosition: boxSchema,
          relativePosition: { type: 'string' },
          fontScale: { type: 'string', enum: ['hero', 'large', 'medium', 'small', 'micro'] },
          textRole: {
            type: 'string',
            enum: [
              'headline',
              'subhead',
              'body',
              'cta',
              'badge',
              'logo_text',
              'app_ui_text',
              'disclaimer',
              'price',
              'claim',
              'unknown',
            ],
          },
          verbatimSensitivity: {
            type: 'string',
            enum: ['safe', 'brand', 'product', 'personal', 'legal_claim', 'sensitive', 'unknown'],
          },
          confidence: confidenceSchema,
        },
      },
    },
    layoutMap: {
      type: 'object',
      additionalProperties: false,
      required: [
        'composition',
        'readingOrder',
        'primaryFocus',
        'secondaryFocus',
        'ctaLocation',
        'phoneUiLocation',
        'textImageRelationship',
      ],
      properties: {
        composition: { type: 'string' },
        readingOrder: { type: 'array', items: { type: 'string' } },
        primaryFocus: { type: 'string' },
        secondaryFocus: { type: 'string' },
        ctaLocation: { type: 'string' },
        phoneUiLocation: { type: 'string' },
        textImageRelationship: { type: 'string' },
      },
    },
    styleProfile: {
      type: 'object',
      additionalProperties: false,
      required: ['visualStyle', 'colorPalette', 'typographyStyle', 'mood', 'platformFeel'],
      properties: {
        visualStyle: { type: 'string' },
        colorPalette: { type: 'array', items: { type: 'string' } },
        typographyStyle: { type: 'string' },
        mood: { type: 'string' },
        platformFeel: { type: 'string' },
      },
    },
    semanticRead: {
      type: 'object',
      additionalProperties: false,
      required: [
        'literalMessage',
        'impliedMessage',
        'userPain',
        'promisedOutcome',
        'emotionalDrivers',
        'targetAudienceSignals',
        'adLoop',
      ],
      properties: {
        literalMessage: { type: 'string' },
        impliedMessage: { type: 'string' },
        userPain: { type: 'string' },
        promisedOutcome: { type: 'string' },
        emotionalDrivers: { type: 'array', items: { type: 'string' } },
        targetAudienceSignals: { type: 'array', items: { type: 'string' } },
        adLoop: {
          type: 'object',
          additionalProperties: false,
          required: ['painHook', 'proofMoment', 'resultPromise', 'cta'],
          properties: {
            painHook: { type: 'string' },
            proofMoment: { type: 'string' },
            resultPromise: { type: 'string' },
            cta: { type: 'string' },
          },
        },
      },
    },
    riskAndCleanup: {
      type: 'object',
      additionalProperties: false,
      required: [
        'sourceBrandSignals',
        'sourceProductSignals',
        'sourceCtaSignals',
        'sensitiveSignals',
        'copyrightSignals',
        'unverifiedClaims',
        'mustNotCarryToPrompt',
        'safeAbstractions',
      ],
      properties: {
        sourceBrandSignals: { type: 'array', items: { type: 'string' } },
        sourceProductSignals: { type: 'array', items: { type: 'string' } },
        sourceCtaSignals: { type: 'array', items: { type: 'string' } },
        sensitiveSignals: { type: 'array', items: { type: 'string' } },
        copyrightSignals: { type: 'array', items: { type: 'string' } },
        unverifiedClaims: { type: 'array', items: { type: 'string' } },
        mustNotCarryToPrompt: { type: 'array', items: { type: 'string' } },
        safeAbstractions: { type: 'array', items: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
    confidence: confidenceSchema,
  },
} as const

function contextText(request: ImageAnalysisSourceRequest, media: PreparedMedia): string {
  return [
    '请分析收到的图片广告，只输出 IM01 JSON。',
    `平台：${request.platform ?? 'unknown'}`,
    `sourceUrl：${request.sourceUrl ?? ''}`,
    `imageUrl：${request.imageUrl ?? request.imageUrls?.[0] ?? ''}`,
    `marketId：${request.marketId}`,
    `marketLanguages：${JSON.stringify(request.marketLanguages)}`,
    `title：${request.title}`,
    `caption：${request.caption}`,
    `内部媒体模式：${media.mode}`,
    `图片数量：${media.keyframeCount}`,
    media.warnings.length > 0 ? `媒体读取提示：${media.warnings.join('；')}` : '',
    '',
    '输出要求：',
    '- module 必须是 IM01_IMAGE_ANALYSIS_PACK。',
    '- sourceMeta 使用输入信息；imageUrl 使用主要图片 URL。',
    '- visualInventory 覆盖主要人物、手机/App UI、logo、按钮、商品、背景和关键对象。',
    '- ocrBlocks 覆盖所有可见文字，包括 logo 字、UI 字、CTA、小字和声明。',
    '- absolutePosition 坐标使用整张图左上角为原点的百分比估算。',
    '- semanticRead 写中文分析，riskAndCleanup 必须列出原品牌/原 CTA/敏感表层。',
  ].filter(Boolean).join('\n')
}

export function buildIm01GenerateContentBody(
  request: ImageAnalysisSourceRequest,
  media: PreparedMedia,
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: IM01_SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [...media.parts, { text: contextText(request, media) }],
      },
    ],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 16_384,
      responseMimeType: 'application/json',
      responseSchema: IM01_RESPONSE_SCHEMA,
    },
  }
}

export async function analyzeImageWithGemini(
  request: ImageAnalysisSourceRequest,
  media: PreparedMedia,
  config: GeminiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageAnalysisResult> {
  if (!config.apiKey) throw new Error('未配置 GEMINI_API_KEY')
  if (media.mode !== 'image_inline') {
    throw new Error('IM01 需要可用图片输入')
  }
  const started = Date.now()
  const result = await callGemini(
    buildIm01GenerateContentBody(request, media),
    config,
    fetchImpl,
  )
  const analysis = parseImageAnalysisPack(result.candidates[0])
  return {
    analysis,
    diagnostics: {
      provider: 'gemini',
      profile: 'im01',
      model: config.model,
      mediaMode: media.mode,
      imageCount: media.keyframeCount,
      elapsedMs: Date.now() - started,
      usage: result.usage,
      reportedModel: result.reportedModel,
      warnings: [...media.warnings],
    },
  }
}

export function imageGeminiConfigForRequest(
  request: Pick<IncomingMessage, 'headers'>,
  env: Record<string, string | undefined> = process.env,
): GeminiConfig {
  return geminiConfigForRequest(request, env)
}

export function imageGeminiConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GeminiConfig {
  return geminiConfigFromEnv(env)
}
