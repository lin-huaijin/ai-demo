import { describe, expect, it } from 'vitest'
import { parseImageAnalysisPack } from './imageAnalysis.ts'

const validPack = {
  module: 'IM01_IMAGE_ANALYSIS_PACK',
  sourceMeta: {
    platform: 'meta',
    sourceUrl: 'https://example.test/ad',
    imageUrl: 'https://cdn.example.test/ad.jpg',
    marketId: 'us',
    marketLanguages: ['en-US'],
    title: 'Social ad',
    caption: '',
  },
  imageGeometry: {
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    safeArea: '中心安全区。',
  },
  visualInventory: [
    {
      id: 'v1',
      type: 'phone',
      description: '中央手机。',
      absolutePosition: { xPct: 35, yPct: 20, wPct: 30, hPct: 55 },
      relativePosition: '中央。',
      visualRole: 'proof',
      confidence: 'high',
    },
  ],
  ocrBlocks: [
    {
      id: 't1',
      text: 'Chat now',
      language: 'en',
      absolutePosition: { xPct: 25, yPct: 10, wPct: 50, hPct: 8 },
      relativePosition: '顶部。',
      fontScale: 'hero',
      textRole: 'headline',
      verbatimSensitivity: 'safe',
      confidence: 'high',
    },
  ],
  layoutMap: {
    composition: '标题、手机 UI、CTA。',
    readingOrder: ['t1', 'v1'],
    primaryFocus: '手机 UI',
    secondaryFocus: '标题',
    ctaLocation: '底部',
    phoneUiLocation: '中央',
    textImageRelationship: '标题和 UI 互相支撑。',
  },
  styleProfile: {
    visualStyle: '社交 App 广告',
    colorPalette: ['white', 'blue'],
    typographyStyle: '无衬线',
    mood: '轻松',
    platformFeel: 'Meta feed',
  },
  semanticRead: {
    literalMessage: '鼓励聊天。',
    impliedMessage: '降低社交门槛。',
    userPain: '缺少社交入口。',
    promisedOutcome: '找到朋友。',
    emotionalDrivers: ['陪伴'],
    targetAudienceSignals: ['想社交的人'],
    adLoop: {
      painHook: '想聊天',
      proofMoment: '展示 UI',
      resultPromise: '找到朋友',
      cta: '点击按钮',
    },
  },
  riskAndCleanup: {
    sourceBrandSignals: [],
    sourceProductSignals: ['原 UI'],
    sourceCtaSignals: [],
    sensitiveSignals: [],
    copyrightSignals: [],
    unverifiedClaims: [],
    mustNotCarryToPrompt: ['原 UI'],
    safeAbstractions: ['聊天界面'],
  },
  notes: 'ok',
  confidence: 'high',
}

describe('IM01 image analysis contract', () => {
  it('parses a valid image analysis pack', () => {
    expect(parseImageAnalysisPack(validPack).module).toBe(
      'IM01_IMAGE_ANALYSIS_PACK',
    )
  })

  it('rejects impossible percentage coordinates', () => {
    expect(() =>
      parseImageAnalysisPack({
        ...validPack,
        visualInventory: [
          {
            ...validPack.visualInventory[0],
            absolutePosition: { xPct: 101, yPct: 20, wPct: 30, hPct: 55 },
          },
        ],
      }),
    ).toThrow(/between 0 and 100/)
  })
})
