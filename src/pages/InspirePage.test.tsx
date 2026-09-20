import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { HotItem } from '../types'
import type { MultimodalAnalysisBundle } from '../contracts/multimodalAnalysis'

const mockedApp = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}))

vi.mock('../state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state')>()
  return { ...actual, useApp: () => mockedApp.current }
})

import { InspirePage, MultimodalAnalysisPanel } from './InspirePage'
import type { MultimodalServiceStatus } from '../lib/multimodalAnalysis'
import {
  localKeyframeResultNotice,
  multimodalPreprocessingNotice,
} from '../lib/multimodalNotices'

function multimodalStatus(
  overrides: Partial<MultimodalServiceStatus> = {},
): MultimodalServiceStatus {
  return {
    configured: true,
    provider: 'gemini',
    profile: 'gemini',
    model: 'gemini-3.1-pro-preview-thinking',
    enabled: true,
    authorized: true,
    requiresAccessToken: false,
    downstream: {
      configured: true,
      c01Model: 'context-model',
      p02Model: 'breakdown-model',
    },
    capabilities: {
      videoInline: true,
      sceneKeyframes: true,
      audio: true,
      asr: true,
      image: true,
      strictJsonSchema: true,
    },
    pipeline: {
      mm01: true,
      contextResearch: true,
      p02FormattedPrompt: true,
      p02: true,
      modelCalls: 3,
    },
    ...overrides,
  }
}

function failedHotItem(): HotItem {
  return {
    id: 'coverage-failed',
    marketId: 'us',
    platform: 'tiktok',
    title: '完整旅行视频',
    likes: 10,
    views: 100,
    source: 'views_top',
    topicTags: ['travel'],
    formatFit: ['video'],
    oneLiner: '原始素材仍然保留。',
    suggestedFeature: 'f2f',
    collectedAt: '2026-07-20T00:00:00.000Z',
    dedupeKey: 'coverage-failed',
    sourceUrl: 'https://www.tiktok.com/@example/video/1',
    recognition: 'live',
    multimodalAnalysisStatus: 'failed',
    multimodalAnalysisError:
      'MM01 有效画面时间轴覆盖 8.4%（11.0 / 130.8 秒，最低要求 80%）：有效画面覆盖低于门槛；未充分触达片尾。为避免误判，P02 未执行。',
  }
}

function analysisBundleForDisplay(): MultimodalAnalysisBundle {
  return {
    mm01: {
      sourceMeta: {
        platform: 'tiktok',
        marketId: 'us',
        marketLanguages: ['en'],
        title: '测试素材',
        caption: '测试说明',
        sourceUrl: 'https://example.com/video',
        durationSec: 12,
      },
      modalityStatus: {
        videoFrames: 'ok',
        ocr: 'ok',
        asr: 'ok',
        audio: 'ok',
        analysisMode: 'full_video',
        confidenceCap: 'high',
      },
      cleanedInputsForP02: {
        visualDescription: '人物拿起道具',
        ocrText: '屏幕文字',
        audioDescription: '音乐渐强',
        rawTranscript: '测试口播',
        transcriptStatus: 'available',
        sceneSegmentsText: '0-3 秒建立悬念',
      },
      sceneSegments: [
        {
          segmentId: 's1',
          timeRange: '0.0-3.0s',
          sceneFunctionGuess: 'hook',
          visual: {
            people: '一名人物',
            setting: '室内',
            action: '拿起道具',
            productOrObject: '道具',
            camera: '近景',
            style: '暖色',
          },
          ocr: { texts: ['屏幕文字'], textRoleGuess: 'hook' },
          asr: { speech: '测试口播', language: 'en', speakerGuess: '人物' },
          audio: { musicMood: '紧张', sfx: ['提示音'], voiceTone: '惊讶' },
          emotion: {
            viewerEmotionGuess: '好奇',
            characterEmotion: '惊讶',
          },
          evidence: [
            {
              type: 'visual',
              source: 'frame',
              confidence: 'high',
              fact: '人物拿起道具',
            },
          ],
        },
      ],
      globalUnderstanding: {
        topicGuess: '身份反转',
        actionReasonGuess: {
          intendedAction: '继续观看',
          persuasionReason: '等待揭晓',
        },
        persuasionStrategyGuess: ['信息缺口'],
        localStyleSignals: {
          casting: '单人',
          environment: '室内',
          composition: '近景',
          colorTone: '暖色',
          textOverlayStyle: '大字',
          productPresentation: '道具推动叙事',
          risk: [],
        },
      },
      qualityFlags: {
        needsHumanReview: false,
        missingCriticalInfo: [],
        reason: '证据完整',
      },
    },
    contextResearch: {
      module: 'C01_CONTEXT_RESEARCH_PACK',
      targetNextPrompt: 'P02F',
      searchRequired: true,
      searchPerformed: true,
      searchProvider: 'web-search',
      contextPack: [
        {
          claim: '该表达在相关语境中常用于制造身份反差',
          source: 'https://example.com/context',
          sourceType: 'primary',
          confidence: 'medium',
          appliesToVideo: 'partial',
          boundary: '只用于解释笑点，不证明人物身份',
          evidenceNeededInVideo: ['人物反应'],
        },
      ],
      interpretiveBridge: {
        videoFacts: ['MM01-E001'],
        externalContext: ['该表达在相关语境中常用于制造身份反差'],
        contextSupportedInference: '反差可能强化了钩子',
        uncertainty: '具体文化出处仍需人工核验',
      },
      sources: ['https://example.com/context'],
      qualityFlags: { needsHumanReview: true, reason: '文化出处需复核' },
    },
    p02Handoff: {
      sourceUsed: ['visual', 'asr', 'audio'],
      handoffNotes: '保留事实边界',
      p02FormattedPrompt: 'P02F 测试文本',
    },
    p02: {
      theme: '身份反转',
      sourceFactSummary: '人物用道具制造信息差',
      story: '人物建立悬念并在结尾兑现反转。',
      storyCharCount: 18,
      coreHook: '普通道具背后是什么',
      tags: ['反转'],
      subtitleBody: '测试口播',
      transcriptUsed: true,
      confidence: 'medium',
      notes: '外部语境只用于解释',
      evidenceBeats: [
        { type: 'visual', fact: '人物拿起道具', evidence: '[MM01-E001]' },
      ],
      keyMoments: [
        {
          timeRange: '0.0-3.0s',
          role: 'hook',
          fact: '人物展示道具',
          whyImportant: '建立信息缺口',
          evidenceRefs: ['MM01-E001'],
        },
      ],
      sourceVsContextBoundary: {
        videoFacts: ['[MM01-E001] 人物展示道具'],
        externalContextUsed: ['该表达在相关语境中常用于制造身份反差'],
        contextSupportedInferences: ['反差可能强化了钩子'],
      },
      narrativeMechanics: {
        audienceReason: '等待信息缺口被填补',
        narrativeEngine: '展示异常细节后延迟解释',
        payoffLogic: '结尾揭晓道具意义',
        preservedSignals: ['信息缺口'],
        replaceableSurface: ['具体道具'],
        forbiddenSurface: ['人物身份刻板印象'],
        evidenceRefs: ['MM01-E001'],
      },
    },
    diagnostics: {
      provider: 'gemini',
      profile: 'gemini',
      model: 'gemini-model',
      mediaMode: 'video_inline_keyframes',
      elapsedMs: 1234,
      modelCalls: 3,
      reportedModels: [
        { stage: 'mm01', model: 'gemini-model' },
        { stage: 'c01', model: 'context-model' },
        { stage: 'p02', model: 'breakdown-model' },
      ],
      models: [
        {
          role: 'multimodal_synthesis',
          provider: 'gemini',
          model: 'gemini-model',
        },
        {
          role: 'context_research',
          provider: 'downstream',
          model: 'context-model',
        },
        { role: 'p02', provider: 'downstream', model: 'breakdown-model' },
      ],
    },
  } as unknown as MultimodalAnalysisBundle
}

describe('InspirePage failed multimodal source', () => {
  it('shows the retained source, readable error and existing safe retry without a breakdown', () => {
    mockedApp.current = {
      hotItems: [failedHotItem()],
      breakdowns: [],
      matches: [],
      lastIngestAt: null,
      ingesting: false,
      ingestLinks: vi.fn(),
      ingestForeplaySearch: vi.fn(),
      loadDemoData: vi.fn(),
      updateHotItem: vi.fn(),
      reBreakdownItem: vi.fn(),
      reanalyzeSource: vi.fn(async () => 'failed' as const),
      pendingScreen: [],
    }

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <InspirePage />
      </MemoryRouter>,
    )

    expect(html).toContain('完整旅行视频')
    expect(html).toContain('多模态未通过 · 后续拆解已阻断')
    expect(html).toContain(
      'MM01 有效画面时间轴覆盖 8.4%（11.0 / 130.8 秒，最低要求 80%）',
    )
    expect(html).toContain('重新多模态分析')
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-label="重新多模态分析：完整旅行视频"')
    expect(html).not.toContain('已进筛选队列')
    expect(html).not.toContain('先粘贴链接并点击')
  })
})

describe('InspirePage video preprocessing notices', () => {
  it('explains that Gemini still receives a bounded inline video without local keyframes', () => {
    const status = multimodalStatus({
      capabilities: {
        videoInline: true,
        sceneKeyframes: false,
        audio: true,
        asr: true,
        image: true,
        strictJsonSchema: true,
      },
    })

    const notice = multimodalPreprocessingNotice(status)

    expect(notice).toContain('完整视频仍会直接交给所选模型')
    expect(notice).toContain('模型自己的视频管线采样画面')
    expect(notice).toContain('P02')
    expect(notice).not.toContain('模型看不到视频')
  })

  it('warns that Kimi safely skips video when neither inline video nor keyframes are available', () => {
    const status = multimodalStatus({
      provider: 'kimi',
      profile: 'kimi-k3',
      model: 'kimi-k3',
      capabilities: {
        videoInline: false,
        sceneKeyframes: false,
        audio: false,
        asr: false,
        image: true,
        strictJsonSchema: true,
      },
    })

    expect(multimodalPreprocessingNotice(status)).toContain(
      '视频会在调用模型前安全跳过',
    )
  })

  it('explains a successful whole-video result with zero local keyframes', () => {
    expect(
      localKeyframeResultNotice({
        provider: 'gemini',
        profile: 'gemini',
        model: 'gemini-3.1-pro-preview-thinking',
        mediaMode: 'video_inline',
        elapsedMs: 100,
        modelCalls: 3,
        keyframeCount: 0,
      }),
    ).toContain('完整视频仍已 inline 送达模型')
    expect(
      localKeyframeResultNotice({
        provider: 'gemini',
        profile: 'gemini',
        model: 'gemini-3.1-pro-preview-thinking',
        mediaMode: 'video_inline_keyframes',
        elapsedMs: 100,
        modelCalls: 3,
        keyframeCount: 8,
      }),
    ).toBeNull()
  })
})

describe('MultimodalAnalysisPanel C01/P02 trace', () => {
  it('shows context sources, fact boundaries, key moments, mechanics and every model stage', () => {
    const html = renderToStaticMarkup(
      <MultimodalAnalysisPanel
        analysis={analysisBundleForDisplay()}
        defaultOpen
      />,
    )

    expect(html).toContain('MM01 → C01 → 本地 P02F → P02')
    expect(html).toContain('C01 搜索语境与事实边界')
    expect(html).toContain('只用于解释笑点，不证明人物身份')
    expect(html).toContain('具体文化出处仍需人工核验')
    expect(html).toContain('https://example.com/context')
    expect(html).toContain('关键时刻')
    expect(html).toContain('建立信息缺口')
    expect(html).toContain('视频事实与外部语境边界')
    expect(html).toContain('叙事机制')
    expect(html).toContain('展示异常细节后延迟解释')
    expect(html).toContain('上游报告 C01 · context-model')
    expect(html).toContain('C01 外部语境检索 · context-model')
    expect(html).toContain('P02 事实拆解 · breakdown-model')
  })

  it('never renders a non-http context source as a clickable link', () => {
    const analysis = analysisBundleForDisplay()
    analysis.contextResearch.contextPack[0].source = 'javascript:alert(1)'
    analysis.contextResearch.sources = ['javascript:alert(1)']

    const html = renderToStaticMarkup(
      <MultimodalAnalysisPanel analysis={analysis} defaultOpen />,
    )

    expect(html).toContain('来源地址未通过安全校验')
    expect(html).not.toContain('href="javascript:')
  })

  it.each([
    'http://localhost/private',
    'http://127.0.0.1/private',
    'http://10.0.0.8/private',
    'http://192.168.1.8/private',
    'http://[::1]/private',
  ])('never renders a non-public context source as a link: %s', (source) => {
    const analysis = analysisBundleForDisplay()
    analysis.contextResearch.contextPack[0].source = source
    analysis.contextResearch.sources = [source]

    const html = renderToStaticMarkup(
      <MultimodalAnalysisPanel analysis={analysis} defaultOpen />,
    )

    expect(html).toContain('来源地址未通过安全校验')
    expect(html).not.toContain(`href="${source}`)
  })
})
