import { describe, expect, it, vi } from 'vitest'
import type { ImageAnalysisPack } from '../../src/contracts/imageAnalysis.ts'
import type { PreparedMedia } from '../multimodal/media.ts'
import { analyzeImageRequest } from './api.ts'

function im01Fixture(): ImageAnalysisPack {
  return {
    module: 'IM01_IMAGE_ANALYSIS_PACK',
    sourceMeta: {
      platform: 'meta',
      sourceUrl: 'https://example.test/ad',
      imageUrl: 'https://cdn.example.test/ad.jpg',
      marketId: 'us',
      marketLanguages: ['en-US'],
      title: 'Social app ad',
      caption: '',
    },
    imageGeometry: {
      aspectRatio: '1:1',
      width: 1080,
      height: 1080,
      safeArea: '中心主体安全。',
    },
    visualInventory: [
      {
        id: 'v1',
        type: 'app_ui',
        description: '中央聊天 App 界面。',
        absolutePosition: { xPct: 30, yPct: 20, wPct: 40, hPct: 55 },
        relativePosition: '中央主体。',
        visualRole: 'proof',
        confidence: 'high',
      },
    ],
    ocrBlocks: [
      {
        id: 't1',
        text: 'Find friends',
        language: 'en',
        absolutePosition: { xPct: 20, yPct: 8, wPct: 60, hPct: 10 },
        relativePosition: '顶部标题。',
        fontScale: 'hero',
        textRole: 'headline',
        verbatimSensitivity: 'safe',
        confidence: 'high',
      },
    ],
    layoutMap: {
      composition: '标题 + 中央 App UI + 底部 CTA。',
      readingOrder: ['t1', 'v1'],
      primaryFocus: '聊天 App UI',
      secondaryFocus: '标题',
      ctaLocation: '底部',
      phoneUiLocation: '中央',
      textImageRelationship: '文字承诺社交结果，UI 提供产品证明。',
    },
    styleProfile: {
      visualStyle: '社交 App 静态广告',
      colorPalette: ['white', 'blue'],
      typographyStyle: '无衬线粗体',
      mood: '轻松',
      platformFeel: 'Meta feed',
    },
    semanticRead: {
      literalMessage: '广告鼓励用户使用社交 App 找朋友。',
      impliedMessage: 'App 能降低开启社交的门槛。',
      userPain: '缺少认识新朋友的入口。',
      promisedOutcome: '找到新朋友。',
      emotionalDrivers: ['陪伴感'],
      targetAudienceSignals: ['想扩大社交圈的人'],
      adLoop: {
        painHook: '想找朋友',
        proofMoment: '聊天 UI',
        resultPromise: '获得连接',
        cta: '底部按钮',
      },
    },
    riskAndCleanup: {
      sourceBrandSignals: [],
      sourceProductSignals: ['原 App UI'],
      sourceCtaSignals: [],
      sensitiveSignals: [],
      copyrightSignals: [],
      unverifiedClaims: [],
      mustNotCarryToPrompt: ['原 App UI'],
      safeAbstractions: ['聊天 App 界面'],
    },
    notes: '测试数据。',
    confidence: 'high',
  }
}

describe('image IM01 API', () => {
  it('returns only the image IM01 analysis pack', async () => {
    const analysis = im01Fixture()
    const media: PreparedMedia = {
      parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'abc' } }],
      mode: 'image_inline',
      keyframeCount: 1,
      sourceAudioTrack: 'not_applicable',
      audioInputProvenance: 'none',
      warnings: [],
      cleanup: vi.fn(async () => undefined),
    }
    const prepare = vi.fn(async () => media)
    const analyze = vi.fn(async () => ({
      analysis,
      diagnostics: {
        provider: 'gemini' as const,
        profile: 'im01' as const,
        model: 'gemini-test',
        mediaMode: 'image_inline' as const,
        imageCount: 1,
        elapsedMs: 1,
        warnings: [],
      },
    }))

    const result = await analyzeImageRequest(
      {
        mediaKind: 'image',
        sourceUrl: 'https://example.test/ad',
        imageUrls: ['https://cdn.example.test/ad.jpg'],
        platform: 'meta',
        marketId: 'us',
        marketLanguages: ['en-US'],
        title: 'Social app ad',
      },
      {
        config: {
          apiKey: 'test-key',
          apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-test',
          timeoutMs: 1000,
        },
        prepare,
        analyze,
      },
    )

    expect(result.status).toBe(200)
    expect(result.body.analysis).toEqual(analysis)
    expect(result.body).not.toHaveProperty('multimodalAnalysis')
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrls: ['https://cdn.example.test/ad.jpg'],
      }),
      'image',
      undefined,
    )
    expect(media.cleanup).toHaveBeenCalled()
  })
})
