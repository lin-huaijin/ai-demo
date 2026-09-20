import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compileP02FormattedPrompt,
  type ContextResearchOutput,
  type Mm01AnalysisPack,
  type MultimodalAnalysisBundle,
  type P02Breakdown,
} from '../contracts/multimodalAnalysis.ts'
import type { ImageAnalysisPack } from '../contracts/imageAnalysis.ts'
import type { HotItem } from '../types'
import {
  clearRuntimeApiCredentials,
  setRuntimeApiCredentials,
  setRuntimeMultimodalProfile,
} from './apiAccess'
import {
  analyzeHotItem,
  analyzeHotItems,
  analysisModeSummary,
  applyMultimodalAnalysisToHotItem,
  fusionGeminiLaneSummary,
  fusionSeedInputSummary,
  geminiVideoProcessingSummary,
  getMultimodalServiceStatus,
  multimodalAnalysisRequestFromHotItem,
} from './multimodalAnalysis'

describe('human-readable fusion diagnostics', () => {
  const baseFusion: NonNullable<
    MultimodalAnalysisBundle['diagnostics']['fusion']
  > = {
    strategy: 'seed_visual_then_gemini_verification',
    seedInputMode: 'video_and_keyframes',
    seedVideoFps: 1,
    seedFrameCount: 10,
    seedObservationCount: 8,
    seedSequenceCount: 4,
  }

  it.each([
    [
      'video_and_keyframes' as const,
      'Seed 按 1 fps 检查全时长视频画面 + 10 张时间标注关键帧',
    ],
    ['video_only' as const, 'Seed 按 1 fps 检查全时长视频画面'],
    ['keyframes_only' as const, 'Seed 仅检查 10 张时间标注关键帧'],
    ['images' as const, 'Seed 检查 10 张图片'],
  ])('describes the actual Seed input mode %s', (seedInputMode, expected) => {
    expect(fusionSeedInputSummary({ ...baseFusion, seedInputMode })).toBe(expected)
  })

  it('shows Gemini sampling and media-resolution settings only when traced', () => {
    const diagnostics = {
      provider: 'fusion' as const,
      profile: 'fusion' as const,
      model: 'Gemini × Seed',
      mediaMode: 'video_inline_keyframes' as const,
      elapsedMs: 100,
      modelCalls: 3,
      geminiVideoFps: 2,
      geminiMediaResolution: 'MEDIA_RESOLUTION_HIGH' as const,
    }
    expect(geminiVideoProcessingSummary(diagnostics)).toBe(
      'Gemini 视频采样 2 fps · 媒体解析档位 高',
    )
    expect(
      geminiVideoProcessingSummary({
        ...diagnostics,
        geminiVideoFps: undefined,
        geminiMediaResolution: undefined,
      }),
    ).toBeUndefined()
  })

  it.each([
    'video_frames_audio',
    'video_frames',
    'video_audio',
    'image_inline',
    'text_only',
  ] as const)(
    'does not describe %s as Gemini whole-video sampling',
    (mediaMode) => {
      expect(
        geminiVideoProcessingSummary({
          provider: 'fusion',
          profile: 'fusion',
          model: 'Gemini × Seed',
          mediaMode,
          elapsedMs: 100,
          modelCalls: 3,
          geminiVideoFps: 2,
          geminiMediaResolution: 'MEDIA_RESOLUTION_HIGH',
        }),
      ).toBeUndefined()
    },
  )

  it('labels audio_frames as frames-only when neither audio nor ASR is usable', () => {
    const status: Mm01AnalysisPack['modalityStatus'] = {
      videoFrames: 'ok',
      ocr: 'ok',
      asr: 'missing',
      audio: 'failed',
      analysisMode: 'audio_frames',
      confidenceCap: 'medium',
    }
    expect(analysisModeSummary(status)).toBe('仅关键帧（音频不可用）')
    expect(
      analysisModeSummary({ ...status, audio: 'partial' }),
    ).toBe('关键帧 + 音频')
  })

  it('describes the Gemini fusion lane from actual media and modality evidence', () => {
    const diagnostics: MultimodalAnalysisBundle['diagnostics'] = {
      provider: 'fusion',
      profile: 'fusion',
      model: 'Gemini × Seed',
      mediaMode: 'video_inline_keyframes',
      elapsedMs: 100,
      modelCalls: 3,
    }
    const status: Mm01AnalysisPack['modalityStatus'] = {
      videoFrames: 'ok',
      ocr: 'ok',
      asr: 'ok',
      audio: 'ok',
      analysisMode: 'full_video',
      confidenceCap: 'high',
    }

    expect(fusionGeminiLaneSummary(diagnostics, status)).toMatchObject({
      focusLabel: '完整视频 / 关键帧 / 音频 / ASR / 语义',
      inputSummary:
        'Gemini 使用完整视频与时间标注关键帧，结合可用音轨与 ASR',
    })

    const framesOnly = fusionGeminiLaneSummary(
      { ...diagnostics, mediaMode: 'video_frames_audio' },
      { ...status, analysisMode: 'audio_frames', audio: 'missing', asr: 'failed' },
    )
    expect(framesOnly).toMatchObject({
      focusLabel: '关键帧 / 语义',
      inputSummary:
        'Gemini 使用时间标注关键帧，音频与 ASR 均未形成可用证据',
    })
    expect(framesOnly.description).not.toContain('完整视频')

    const verifiedSilent = fusionGeminiLaneSummary(
      {
        ...diagnostics,
        sourceAudioTrack: 'absent',
        audioInputProvenance: 'none',
      },
      status,
    )
    expect(verifiedSilent).toMatchObject({
      focusLabel: '完整视频 / 关键帧 / 语义',
      inputSummary:
        'Gemini 使用完整视频与时间标注关键帧，本次未提供音轨或 ASR',
    })
  })
})

const STORY =
  '旅客在陌生城市发现自己看不懂出口提示，先反复确认路牌，随后向路人展示手机。双方借助界面迅速理解彼此，原本紧张的问路过程转为轻松继续出发。'

function im01Fixture(): ImageAnalysisPack {
  return {
    module: 'IM01_IMAGE_ANALYSIS_PACK',
    sourceMeta: {
      platform: 'meta',
      sourceUrl: 'https://example.test/ad',
      imageUrl: 'https://cdn.example.test/social-ad.jpg',
      marketId: 'us',
      marketLanguages: ['en-US'],
      title: 'Social ad',
      caption: '',
    },
    imageGeometry: {
      aspectRatio: '1:1',
      width: 1080,
      height: 1080,
      safeArea: '主体和文字都在画面中心安全区内。',
    },
    visualInventory: [
      {
        id: 'v1',
        type: 'phone',
        description: '手机聊天 App 界面位于画面中央。',
        absolutePosition: { xPct: 35, yPct: 18, wPct: 30, hPct: 62 },
        relativePosition: '居中，位于主标题下方。',
        visualRole: 'proof',
        confidence: 'high',
      },
    ],
    ocrBlocks: [
      {
        id: 't1',
        text: 'Meet new people',
        language: 'en',
        absolutePosition: { xPct: 18, yPct: 8, wPct: 64, hPct: 10 },
        relativePosition: '顶部居中大标题。',
        fontScale: 'hero',
        textRole: 'headline',
        verbatimSensitivity: 'safe',
        confidence: 'high',
      },
    ],
    layoutMap: {
      composition: '顶部标题、中央手机界面、底部 CTA 的社交 App 广告版式。',
      readingOrder: ['t1', 'v1'],
      primaryFocus: '手机中的聊天界面',
      secondaryFocus: '顶部标题',
      ctaLocation: '底部区域',
      phoneUiLocation: '画面中央',
      textImageRelationship: '标题提出社交结果，手机 UI 作为产品证明。',
    },
    styleProfile: {
      visualStyle: '移动 App 安装广告',
      colorPalette: ['white', 'blue', 'black'],
      typographyStyle: '粗体无衬线标题',
      mood: '轻松、安全、社交',
      platformFeel: 'Meta feed 静态图广告',
    },
    semanticRead: {
      literalMessage: '这是一张鼓励用户认识新朋友的社交 App 广告。',
      impliedMessage: '使用该 App 可以更容易开始聊天并建立连接。',
      userPain: '缺少轻松认识新朋友的入口。',
      promisedOutcome: '快速开始对话并获得社交连接。',
      emotionalDrivers: ['好奇', '陪伴感'],
      targetAudienceSignals: ['想扩大社交圈的人'],
      adLoop: {
        painHook: '想认识新朋友',
        proofMoment: '展示聊天 App UI',
        resultPromise: '获得新的社交连接',
        cta: '底部行动按钮',
      },
    },
    riskAndCleanup: {
      sourceBrandSignals: [],
      sourceProductSignals: ['原 App UI 风格'],
      sourceCtaSignals: ['底部 CTA'],
      sensitiveSignals: [],
      copyrightSignals: [],
      unverifiedClaims: [],
      mustNotCarryToPrompt: ['原 App UI 细节'],
      safeAbstractions: ['社交聊天界面', '认识新朋友的情绪承诺'],
    },
    notes: '测试 fixture。',
    confidence: 'high',
  }
}

function hotItem(patch: Partial<HotItem> = {}): HotItem {
  return {
    id: 'hot-1',
    marketId: 'id',
    platform: 'tiktok',
    title: '原始标题',
    likes: 12,
    views: 34,
    source: 'topic_tag',
    topicTags: ['travel'],
    formatFit: ['video'],
    oneLiner: '原 regex 链路保留的故事。',
    suggestedFeature: 'f2f',
    collectedAt: '2026-07-20 12:00:00',
    dedupeKey: 'https://example.test/video',
    sourceUrl: 'https://example.test/video',
    mediaUrl: 'https://cdn.example.test/video.mp4',
    mediaUrls: ['https://cdn.example.test/video.mp4'],
    videoUrls: ['https://cdn.example.test/video.mp4'],
    imageUrls: [],
    mediaKind: 'video',
    durationSeconds: 8,
    caption: '原始 caption',
    recognition: 'live',
    theme: '原始主题',
    transcript: '请问出口在哪里',
    providerTranscript: '请问出口在哪里',
    transcriptStatus: 'ok',
    transcriptSource: 'provider',
    ...patch,
  }
}

function mm01Fixture(options: {
  rawTranscript?: string
  asrMissing?: boolean
  needsHumanReview?: boolean
} = {}): Mm01AnalysisPack {
  const rawTranscript = options.rawTranscript ?? '请问出口在哪里'
  const asrMissing = options.asrMissing ?? false
  const needsHumanReview = options.needsHumanReview ?? asrMissing
  return {
    module: 'MM01_MULTIMODAL_ANALYSIS_PACK',
    targetNextPrompt: 'C01',
    sourceMeta: {
      platform: 'tiktok',
      sourceUrl: 'https://example.test/video',
      marketId: 'id',
      marketLanguages: ['id-ID', 'en'],
      title: '原始标题',
      caption: '原始 caption',
      durationSec: 8,
    },
    modalityStatus: {
      videoFrames: 'ok',
      ocr: 'ok',
      asr: asrMissing ? 'missing' : 'ok',
      audio: 'ok',
      analysisMode: 'compressed_video',
      confidenceCap: 'medium',
    },
    cleanedInputsForP02: {
      transcriptStatus: asrMissing ? 'missing' : 'ok',
      rawTranscript: asrMissing ? '' : rawTranscript,
      visualDescription: '0-3 秒人物查看路牌；3-8 秒向路人展示手机。',
      ocrText: 'EXIT B',
      audioDescription: '轻快音乐，转折处有提示音。',
      sceneSegmentsText: 's1 查看路牌；s2 展示手机并继续出发。',
    },
    sceneSegments: [
      {
        segmentId: 's1',
        timeRange: '0.0-3.0s',
        sceneFunctionGuess: 'hook',
        visual: {
          people: '一名旅客皱眉查看路牌',
          setting: '城市路口',
          productOrObject: '路牌',
          camera: '近景静态',
          style: '暖色纪实',
        },
        ocr: { texts: ['EXIT B'], textRoleGuess: 'subtitle' },
        asr: {
          speech: asrMissing ? '' : rawTranscript,
          language: asrMissing ? 'unknown' : 'zh',
          speakerGuess: asrMissing ? 'unknown' : '旅客',
        },
        audio: { musicMood: '轻快', sfx: [], voiceTone: '疑惑' },
        emotion: { viewerEmotionGuess: '好奇', characterEmotion: '困惑' },
        evidence: [
          {
            type: 'visual',
            fact: '旅客皱眉查看路牌',
            source: 'frame',
            confidence: 'medium',
          },
          {
            type: 'text',
            fact: '路牌显示 EXIT B',
            source: 'ocr',
            confidence: 'medium',
          },
          ...(asrMissing
            ? []
            : [
                {
                  type: 'speech' as const,
                  fact: rawTranscript,
                  source: 'asr' as const,
                  confidence: 'medium' as const,
                },
              ]),
        ],
      },
      {
        segmentId: 's2',
        timeRange: '3.0-8.0s',
        sceneFunctionGuess: 'reveal',
        visual: {
          people: '旅客向路人展示手机',
          setting: '城市路口',
          productOrObject: '手机界面',
          camera: '中景推近',
          style: '暖色纪实',
        },
        ocr: { texts: [], textRoleGuess: 'unknown' },
        asr: { speech: '', language: 'unknown', speakerGuess: 'unknown' },
        audio: { musicMood: '轻快', sfx: ['提示音'], voiceTone: '轻松' },
        emotion: { viewerEmotionGuess: '温暖', characterEmotion: '释然' },
        evidence: [
          {
            type: 'visual',
            fact: '旅客向路人展示手机界面',
            source: 'frame',
            confidence: 'medium',
          },
          {
            type: 'audio',
            fact: '转折处出现提示音',
            source: 'audio',
            confidence: 'medium',
          },
        ],
      },
    ],
    globalUnderstanding: {
      topicGuess: '旅行中的信息理解障碍',
      actionReasonGuess: {
        intendedAction: '继续出行',
        persuasionReason: '手机帮助双方理解信息',
      },
      persuasionStrategyGuess: ['human_experience', 'contrast'],
      localStyleSignals: {
        casting: '年轻旅客与当地路人',
        environment: '城市路口',
        composition: '人物与路牌交替',
        colorTone: '暖色',
        textOverlayStyle: '简洁路牌文字',
        productPresentation: '转折处展示手机',
        risk: [],
      },
    },
    eventTimeline: [
      {
        timeRange: '0.0-3.0s',
        literalEvent: '旅客查看写有 EXIT B 的路牌',
        visibleEvidenceRefs: ['MM01-E001'],
        textEvidenceRefs: ['MM01-E002'],
        speechEvidenceRefs: asrMissing ? [] : ['MM01-E003'],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: [],
        certainty: 'medium',
      },
      {
        timeRange: '3.0-8.0s',
        literalEvent: '旅客向路人展示手机界面，转折处出现提示音',
        visibleEvidenceRefs: [asrMissing ? 'MM01-E003' : 'MM01-E004'],
        textEvidenceRefs: [],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [asrMissing ? 'MM01-E004' : 'MM01-E005'],
        inferenceEvidenceRefs: [],
        certainty: 'medium',
      },
    ],
    narrativeMap: {
      who: '旅客与路人',
      where: '城市路口',
      initialSituation: '旅客查看出口路牌',
      problemOrDesire: '旅客想确认出口方向',
      escalation: '旅客需要把手机界面展示给路人',
      turningPoint: '手机界面帮助双方理解信息',
      outcome: '旅客继续出行',
      impliedMeaning: '旅行信息理解困难可以通过手机界面缓解',
      audienceTakeaway: '陌生环境中的沟通误会被工具动作化解',
      unknowns: asrMissing ? ['无法确认对白'] : [],
      evidenceRefs: [
        'MM01-E001',
        'MM01-E002',
        asrMissing ? 'MM01-E003' : 'MM01-E004',
        asrMissing ? 'MM01-E004' : 'MM01-E005',
      ],
    },
    attentionMap: [
      {
        segmentId: 's1',
        timeRange: '0.0-3.0s',
        role: 'hook',
        importanceScore: 5,
        reason: '看见出口牌却仍困惑，形成开场反差',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
        reuseType: 'keep_structure',
        risk: [],
      },
      {
        segmentId: 's2',
        timeRange: '3.0-8.0s',
        role: 'reveal',
        importanceScore: 4,
        reason: '展示手机界面形成解决转折',
        evidenceRefs: [
          asrMissing ? 'MM01-E003' : 'MM01-E004',
          asrMissing ? 'MM01-E004' : 'MM01-E005',
        ],
        reuseType: 'keep_structure',
        risk: [],
      },
    ],
    contextGaps: [
      {
        gap: 'EXIT B 作为出口编号的语境需要检索确认',
        entities: ['EXIT B'],
        neededFor: 'understand_symbol_or_object',
        evidenceRefs: ['MM01-E002'],
        searchQueries: ['EXIT B sign meaning transit exit'],
      },
    ],
    interpretationCandidates: [
      {
        claim: '旅客因出口标识理解困难而用手机向路人求助',
        supportingEvidenceRefs: [
          'MM01-E001',
          'MM01-E002',
          asrMissing ? 'MM01-E003' : 'MM01-E004',
        ],
        contradictingEvidenceRefs: [],
        confidence: 'medium',
        reasoningLimits: asrMissing ? '无 ASR，无法确认对白。' : '',
      },
    ],
    crossModalChecks: {
      captionVsVideo: 'consistent',
      asrVsOcr: asrMissing ? 'unknown' : 'consistent',
      audioVsEmotion: 'consistent',
      notes: asrMissing ? '缺少 ASR。' : '',
    },
    qualityFlags: {
      missingCriticalInfo: asrMissing ? ['asr'] : [],
      needsHumanReview,
      reason: needsHumanReview ? '需要复核缺失的语音证据。' : '',
    },
  }
}

function c01Fixture(asrMissing = false): ContextResearchOutput {
  return {
    module: 'C01_CONTEXT_RESEARCH_PACK',
    targetNextPrompt: 'P02F',
    searchRequired: true,
    searchPerformed: true,
    searchProvider: 'test-search-model',
    contextPack: [
      {
        claim: 'EXIT B 常见于交通或场馆出口编号标识。',
        source: 'https://example.test/exit-sign',
        sourceType: 'search',
        confidence: 'medium',
        appliesToVideo: 'supports_interpretation',
        boundary: '只解释可见路牌语境，不能确认具体地点。',
        evidenceNeededInVideo: ['画面中出现 EXIT B'],
      },
    ],
    interpretiveBridge: {
      videoFacts: [
        'MM01-E001',
        'MM01-E002',
        asrMissing ? 'MM01-E003' : 'MM01-E004',
      ],
      externalContext: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInference:
        'MM01-E001 + https://example.test/exit-sign 共同支持可见标识可能与人物的方向理解困难有关。',
      uncertainty: '视频没有证明具体城市或交通系统。',
    },
    sources: ['https://example.test/exit-sign'],
    qualityFlags: { needsHumanReview: false, reason: '' },
  }
}

function p02Fixture(
  subtitleBody = '请问，出口在哪里？',
  asrMissing = false,
): P02Breakdown {
  return {
    theme: '旅行问路·语言理解',
    tags: ['旅行', '问路', '语言障碍'],
    subtitleBody,
    sourceFactSummary: '旅客查看路牌并向路人展示手机。',
    evidenceBeats: [
      { type: 'visual', fact: '旅客皱眉查看路牌', evidence: '[MM01-E001] 0.0-3.0s 画面' },
      { type: 'text', fact: '路牌显示 EXIT B', evidence: '[MM01-E002] 0.0-3.0s OCR' },
      {
        type: 'audio',
        fact: '转折处出现提示音',
        evidence: `[${asrMissing ? 'MM01-E004' : 'MM01-E005'}] 3.0-8.0s 音轨`,
      },
    ],
    keyMoments: [
      {
        timeRange: '0.0-3.0s',
        role: 'hook',
        fact: '旅客查看 EXIT B 路牌但仍显得困惑',
        whyImportant: '可见标识与人物困惑形成信息差。',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
      },
      {
        timeRange: '3.0-8.0s',
        role: 'reveal',
        fact: '旅客向路人展示手机界面',
        whyImportant: '手机界面承担剧情转折',
        evidenceRefs: [asrMissing ? 'MM01-E003' : 'MM01-E004'],
      },
    ],
    sourceVsContextBoundary: {
      videoFacts: ['MM01-E001', 'MM01-E002', asrMissing ? 'MM01-E003' : 'MM01-E004'],
      externalContextUsed: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInferences: [
        'MM01-E001 + https://example.test/exit-sign 共同支持可见标识可能与人物的方向理解困难有关。',
      ],
    },
    narrativeMechanics: {
      audienceReason: '观众会继续看，是因为出口标识可见但主角仍困惑，形成信息差。',
      narrativeEngine: '剧情靠信息理解困难推进，手机展示动作承担从卡住到理解的转折。',
      payoffLogic: '当手机界面被展示给路人后，前面的方向困惑获得可能解决。',
      preservedSignals: ['可见标识与困惑反差', '手机展示动作', '从卡住到理解的转折'],
      replaceableSurface: ['出口编号', '城市环境', '路牌外观'],
      forbiddenSurface: ['原人物脸', '原应用界面', '原账号水印'],
      evidenceRefs: [
        'MM01-E001',
        'MM01-E002',
        asrMissing ? 'MM01-E003' : 'MM01-E004',
      ],
    },
    riskRefs: [],
    uncertaintyNotes: '具体对白取决于 ASR 可用性。',
    story: STORY,
    coreHook: '看见出口牌却仍找不到出口',
    storyCharCount: [...STORY.trim()].length,
    transcriptUsed: Boolean(subtitleBody.trim()),
    confidence: 'medium',
    notes: '因果关系以画面和音轨证据为边界。',
  }
}

function bundle(options: {
  rawTranscript?: string
  asrMissing?: boolean
  subtitleBody?: string
  needsHumanReview?: boolean
} = {}): MultimodalAnalysisBundle {
  const mm01 = mm01Fixture(options)
  const contextResearch = c01Fixture(options.asrMissing)
  const p02 = p02Fixture(
    options.asrMissing ? '' : (options.subtitleBody ?? '请问，出口在哪里？'),
    options.asrMissing,
  )
  return {
    mm01,
    contextResearch,
    p02Handoff: compileP02FormattedPrompt(mm01, contextResearch),
    p02,
    diagnostics: {
      provider: 'gemini',
      profile: 'gemini',
      model: 'gemini-3.1-pro',
      mediaMode: 'video_frames_audio',
      elapsedMs: 1200,
      modelCalls: 3,
      durationSeconds: 8,
      keyframeCount: 2,
      models: [
        {
          role: 'multimodal_synthesis',
          provider: 'gemini',
          model: 'gemini-3.1-pro',
        },
        {
          role: 'context_research',
          provider: 'downstream',
          model: 'context-model',
        },
        { role: 'p02', provider: 'downstream', model: 'breakdown-model' },
      ],
    },
  }
}

afterEach(() => {
  clearRuntimeApiCredentials()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MM01 client projection', () => {
  it('projects strict P02 fields and retains the complete MM01 bundle', () => {
    const input = hotItem()
    const analysis = bundle()
    const result = applyMultimodalAnalysisToHotItem(input, analysis)

    expect(result.theme).toBe(analysis.p02.theme)
    expect(result.oneLiner).toBe(analysis.p02.story)
    expect(result.transcript).toBe(analysis.p02.subtitleBody)
    expect(result.visualDescription).toBe(
      analysis.mm01.cleanedInputsForP02.visualDescription,
    )
    expect(result.multimodalAnalysis).toBe(analysis)
    expect(result.multimodalAnalysisStatus).toBe('complete')
    expect(result.transcriptVerification).toBe('verified')
  })

  it('marks a valid analysis as degraded when C01 still needs human review', () => {
    const input = hotItem()
    const analysis = bundle()
    analysis.contextResearch.qualityFlags = {
      needsHumanReview: true,
      reason: '没有取得足够可靠的外部语境。',
    }

    const result = applyMultimodalAnalysisToHotItem(input, analysis)

    expect(result.multimodalAnalysis).toBe(analysis)
    expect(result.multimodalAnalysisStatus).toBe('degraded')
    expect(result.multimodalAnalysisError).toBeUndefined()
  })

  it('infers an automatic market only after MM01 provides trusted ASR/OCR evidence', () => {
    const input = hotItem({
      marketId: 'unknown',
      marketSelection: 'auto',
      title: 'Brazil 日本 travel',
      caption: 'Unverified destination copy',
      providerTranscript: '未经核验的 العربية provider 字幕',
      transcript: '未经核验的 العربية provider 字幕',
    })
    const analysis = bundle({
      rawTranscript: 'これは実際に音轨から確認した日本語です',
      subtitleBody: 'これは実際に音轨から確認した日本語です',
    })

    const result = applyMultimodalAnalysisToHotItem(input, analysis)

    expect(result.marketId).toBe('jp')
    expect(result.marketSelection).toBe('auto')
  })

  it('never overwrites an explicitly selected market with MM01 language evidence', () => {
    const input = hotItem({ marketId: 'id', marketSelection: 'explicit' })
    const analysis = bundle({
      rawTranscript: 'これは実際に音轨から確認した日本語です',
      subtitleBody: 'これは実際に音轨から確認した日本語です',
    })

    const result = applyMultimodalAnalysisToHotItem(input, analysis)

    expect(result.marketId).toBe('id')
    expect(result.marketSelection).toBe('explicit')
  })

  it('can infer an automatic market from MM01 OCR when ASR is unavailable', () => {
    const input = hotItem({ marketId: 'unknown', marketSelection: 'auto' })
    const analysis = bundle({ asrMissing: true })
    analysis.mm01.cleanedInputsForP02.ocrText = '한국어 안내'
    analysis.mm01.sceneSegments[0].ocr.texts = ['한국어 안내']

    const result = applyMultimodalAnalysisToHotItem(input, analysis)

    expect(result.marketId).toBe('kr')
  })

  it('quarantines provider text when MM01 ASR is missing', () => {
    const input = hotItem()
    const analysis = bundle({ asrMissing: true })
    const result = applyMultimodalAnalysisToHotItem(input, analysis)

    expect(result.transcriptStatus).toBe('conflict')
    expect(result.transcript).toBeUndefined()
    expect(result.providerTranscript).toBe('请问出口在哪里')
    expect(result.modelTranscript).toBeUndefined()
    expect(result.transcriptConflict).toMatchObject({
      providerTranscript: '请问出口在哪里',
      modelTranscript: '',
    })
    expect(result.theme).toBe(input.theme)
    expect(result.oneLiner).toBe(input.oneLiner)
    expect(result.multimodalAnalysisStatus).toBe('degraded')
  })

  it('quarantines divergent provider/model transcripts and blocks P02 semantics', () => {
    const input = hotItem({
      transcript: '今天教大家如何做早餐',
      providerTranscript: '今天教大家如何做早餐',
    })
    const analysis = bundle({
      rawTranscript: '现在购买立减百分之五十',
      subtitleBody: '现在购买立减百分之五十',
    })
    const result = applyMultimodalAnalysisToHotItem(input, analysis)

    expect(result.transcriptStatus).toBe('conflict')
    expect(result.transcript).toBeUndefined()
    expect(result.transcriptConflict).toEqual({
      providerTranscript: '今天教大家如何做早餐',
      modelTranscript: '现在购买立减百分之五十',
      reason: expect.stringContaining('0.55'),
    })
    expect(result.theme).toBe(input.theme)
    expect(result.oneLiner).toBe(input.oneLiner)
  })

  it('keeps every explicitly curated field above model projections', () => {
    const input = hotItem({
      theme: '人工主题',
      oneLiner: '人工故事',
      transcript: '人工确认字幕',
      visualDescription: '人工画面描述',
      curatedSourceFields: [
        'theme',
        'oneLiner',
        'transcript',
        'visualDescription',
      ],
    })
    const result = applyMultimodalAnalysisToHotItem(input, bundle())

    expect(result.theme).toBe('人工主题')
    expect(result.oneLiner).toBe('人工故事')
    expect(result.transcript).toBe('人工确认字幕')
    expect(result.visualDescription).toBe('人工画面描述')
    expect(result.transcriptSource).toBe('human')
    expect(result.transcriptVerification).toBe('verified')
    expect(result.transcriptConflict).toBeUndefined()
  })
})

describe('MM01 API client', () => {
  it('normalizes legacy, single-model, fusion, and redacted status envelopes', async () => {
    const legacy = await getMultimodalServiceStatus(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            configured: true,
            model: 'gemini-legacy',
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
              image: true,
            },
            pipeline: { geminiCalls: 3 },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    )
    expect(legacy).toMatchObject({
      provider: 'gemini',
      profile: 'gemini',
      capabilities: { asr: true, strictJsonSchema: true },
      pipeline: { contextResearch: true, modelCalls: 3 },
    })

    const kimi = await getMultimodalServiceStatus(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            configured: true,
            provider: 'kimi',
            profile: 'kimi-k3',
            model: 'kimi-k3',
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
              audio: false,
              asr: false,
              image: true,
              strictJsonSchema: true,
            },
            pipeline: { contextResearch: true, modelCalls: 3 },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    )
    expect(kimi).toMatchObject({ provider: 'kimi', profile: 'kimi-k3' })

    const seed = await getMultimodalServiceStatus(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            configured: true,
            provider: 'seed',
            profile: 'seed-2.1-pro',
            model: 'doubao-seed-2-1-pro-260628',
            enabled: true,
            authorized: true,
            requiresAccessToken: false,
            capabilities: {
              videoInline: false,
              sceneKeyframes: true,
              audio: false,
              asr: false,
              image: true,
              strictJsonSchema: true,
            },
            downstream: {
              configured: true,
              c01Model: 'context-model',
              p02Model: 'breakdown-model',
            },
            pipeline: { contextResearch: true, modelCalls: 3 },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    )
    expect(seed).toMatchObject({ provider: 'seed', profile: 'seed-2.1-pro' })

    const fusion = await getMultimodalServiceStatus(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            configured: true,
            provider: 'fusion',
            profile: 'fusion',
            model: 'Gemini + Seed 2.1 Pro',
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
            pipeline: { contextResearch: true, modelCalls: 4 },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    )
    expect(fusion).toMatchObject({
      provider: 'fusion',
      profile: 'fusion',
      pipeline: { modelCalls: 4 },
    })

    const redacted = await getMultimodalServiceStatus(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            configured: false,
            provider: '',
            profile: '',
            model: '',
            enabled: true,
            authorized: false,
            requiresAccessToken: true,
            capabilities: {},
            pipeline: { contextResearch: true, modelCalls: 3 },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    )
    expect(redacted).toMatchObject({ authorized: false, requiresAccessToken: true })
  })

  it('does not report the pipeline configured when downstream C01/P02 is missing', async () => {
    const status = await getMultimodalServiceStatus(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            configured: true,
            provider: 'gemini',
            profile: 'gemini',
            model: 'gemini-model',
            enabled: true,
            authorized: true,
            requiresAccessToken: false,
            downstream: {
              configured: false,
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
            pipeline: { contextResearch: true, modelCalls: 3 },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    )

    expect(status.configured).toBe(false)
    expect(status.downstream).toEqual({
      configured: false,
      c01Model: 'context-model',
      p02Model: 'breakdown-model',
    })
  })

  it('rejects a contradictory modern status profile', async () => {
    await expect(
      getMultimodalServiceStatus(
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              configured: true,
              provider: 'kimi',
              profile: 'gemini',
              model: 'kimi-k3',
              enabled: true,
              authorized: true,
              requiresAccessToken: false,
              capabilities: {},
              pipeline: { contextResearch: true, modelCalls: 3 },
            }),
            { status: 200 },
          ),
        ) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/provider\/profile/)
  })

  it('preserves the original regex inputs on an HTTP failure', async () => {
    const input = hotItem()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: '上游暂时不可用' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const result = await analyzeHotItem(input, { fetchImpl })

    expect(result.theme).toBe(input.theme)
    expect(result.oneLiner).toBe(input.oneLiner)
    expect(result.transcript).toBe(input.transcript)
    expect(result.multimodalAnalysis).toBeUndefined()
    expect(result.multimodalAnalysisStatus).toBe('failed')
    expect(result.multimodalAnalysisError).toBe('上游暂时不可用')
  })

  it('treats Kimi visual-evidence absence as a safe skip', async () => {
    const input = hotItem()
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'Kimi K3 未取得可用视频画面；本次未调用模型。',
          code: 'KIMI_UNSUPPORTED_MEDIA',
        }),
        {
          status: 422,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch

    const result = await analyzeHotItem(input, { fetchImpl })

    expect(result.multimodalAnalysisStatus).toBe('skipped')
    expect(result.multimodalAnalysisError).toContain('未取得可用视频画面')
    expect(result.theme).toBe(input.theme)
    expect(result.oneLiner).toBe(input.oneLiner)
  })

  it('treats Seed visual-evidence absence as the same safe skip', async () => {
    const input = hotItem()
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'Seed 2.1 Pro 未取得可用关键帧或图片；本次未调用模型。',
          code: 'SEED_UNSUPPORTED_MEDIA',
        }),
        {
          status: 422,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch

    const result = await analyzeHotItem(input, { fetchImpl })

    expect(result.multimodalAnalysisStatus).toBe('skipped')
    expect(result.multimodalAnalysisError).toContain('未取得可用关键帧或图片')
    expect(result.theme).toBe(input.theme)
    expect(result.oneLiner).toBe(input.oneLiner)
  })

  it('builds the exact video request, selected model headers and strict response', async () => {
    setRuntimeApiCredentials({
      geminiApiKey: 'runtime-gemini-key',
      downstreamApiKey: 'runtime-downstream-key',
      teamAccessToken: 'team-access',
    })
    setRuntimeMultimodalProfile('gemini')
    const analysis = bundle()
    const artifact = {
      projectId: 'portfolio',
      assetId: 'asset-1',
      runId: 'run-1',
      status: 'complete',
      manifestUrl: '/api/artifacts/projects/portfolio/assets/asset-1',
      exportUrl:
        '/api/artifacts/projects/portfolio/assets/asset-1/runs/run-1/export',
    }
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            analysis,
            artifact,
            artifactWarning: '归档保留了一条非阻断提示',
          }),
          {
          status: 200,
          headers: { 'content-type': 'application/json' },
          },
        ),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch
    const input = hotItem()

    const result = await analyzeHotItem(input, { fetchImpl })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/multimodal/analyze')
    expect(init).toMatchObject({ method: 'POST' })
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer team-access',
      'x-intent-multimodal-profile': 'gemini',
      'x-intent-gemini-key': 'runtime-gemini-key',
      'x-intent-downstream-key': 'runtime-downstream-key',
    })
    expect(JSON.parse(String(init?.body))).toEqual(
      multimodalAnalysisRequestFromHotItem(input),
    )
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mediaKind: 'video',
      mediaUrl: 'https://cdn.example.test/video.mp4',
      videoUrls: ['https://cdn.example.test/video.mp4'],
      marketLanguages: ['id-ID', 'en'],
      providerTranscript: '请问出口在哪里',
    })
    expect(result.multimodalAnalysisError).toBeUndefined()
    expect(result.multimodalAnalysisStatus).toBe('complete')
    expect(result.artifact).toEqual(artifact)
    expect(result.artifactWarning).toBe('归档保留了一条非阻断提示')
    expect(result.multimodalAnalysis?.p02Handoff).toEqual(
      compileP02FormattedPrompt(analysis.mm01, analysis.contextResearch),
    )
  })

  it('analyzes image assets through image IM01 even when another multimodal profile is selected', async () => {
    setRuntimeApiCredentials({
      geminiApiKey: 'runtime-gemini-key',
      kimiApiKey: 'runtime-kimi-key',
      downstreamApiKey: 'runtime-downstream-key',
    })
    setRuntimeMultimodalProfile('kimi-k3')
    const analysis = im01Fixture()
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ analysis }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch
    const input = hotItem({
      mediaKind: 'image',
      mediaUrl: 'https://cdn.example.test/social-ad.jpg',
      mediaUrls: ['https://cdn.example.test/social-ad.jpg'],
      videoUrls: [],
      imageUrls: ['https://cdn.example.test/social-ad.jpg'],
      durationSeconds: undefined,
      transcript: undefined,
      providerTranscript: undefined,
      transcriptStatus: 'skipped',
      transcriptSource: 'none',
    })

    const result = await analyzeHotItem(input, { fetchImpl })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/image/analyze')
    expect(init?.headers).toMatchObject({
      'x-intent-multimodal-profile': 'gemini',
      'x-intent-gemini-key': 'runtime-gemini-key',
      'x-intent-downstream-key': 'runtime-downstream-key',
    })
    expect(init?.headers).not.toMatchObject({
      'x-intent-kimi-key': 'runtime-kimi-key',
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mediaKind: 'image',
      mediaUrl: 'https://cdn.example.test/social-ad.jpg',
      imageUrls: ['https://cdn.example.test/social-ad.jpg'],
    })
    expect(result.multimodalAnalysisStatus).toBe('complete')
    expect(result.multimodalAnalysis).toBeUndefined()
    expect(result.imageAnalysis).toEqual(analysis)
    expect(result.visualDescription).toContain('手机聊天 App 界面')
  })

  it('rejects a malformed 200 response instead of partially applying it', async () => {
    const input = hotItem()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ analysis: { mm01: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const result = await analyzeHotItem(input, { fetchImpl })

    expect(result.multimodalAnalysisStatus).toBe('failed')
    expect(result.theme).toBe(input.theme)
    expect(result.oneLiner).toBe(input.oneLiner)
  })

  it('analyzes mixed video and image evidence and reports all four batch counters', async () => {
    const complete = hotItem({
      id: 'complete',
      title: 'complete',
      mediaKind: 'mixed',
      imageUrls: ['https://cdn.example.test/still.jpg'],
    })
    const degraded = hotItem({ id: 'degraded', title: 'degraded' })
    const skipped = hotItem({
      id: 'skipped',
      title: 'skipped',
      mediaKind: 'image',
      mediaUrl: 'https://cdn.example.test/still.jpg',
      mediaUrls: ['https://cdn.example.test/still.jpg'],
      videoUrls: [],
      imageUrls: ['https://cdn.example.test/still.jpg'],
      transcript: undefined,
      providerTranscript: undefined,
      transcriptStatus: 'skipped',
      transcriptSource: 'none',
    })
    const failed = hotItem({ id: 'failed', title: 'failed' })
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { title: string }
        if (body.title === 'failed') {
          return new Response(JSON.stringify({ error: '上游失败' }), {
            status: 502,
            headers: { 'content-type': 'application/json' },
          })
        }
        const analysis =
          body.title === 'skipped'
            ? im01Fixture()
            : body.title === 'degraded'
              ? bundle({ needsHumanReview: true })
              : bundle()
        return new Response(JSON.stringify({ analysis }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await analyzeHotItems(
      [complete, degraded, skipped, failed],
      true,
      1,
    )

    expect(result).toMatchObject({
      complete: 2,
      degraded: 1,
      skipped: 0,
      failed: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.items[0].multimodalAnalysisStatus).toBe('complete')
    expect(result.items[0].mediaKind).toBe('mixed')
    expect(result.items[2].multimodalAnalysisStatus).toBe('complete')
  })
})
