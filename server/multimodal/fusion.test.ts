import { describe, expect, it, vi } from 'vitest'
import type {
  ContextResearchOutput,
  Mm01AnalysisPack,
  P02Breakdown,
} from '../../src/contracts/multimodalAnalysis.ts'
import {
  parseMm01AnalysisPack,
  parseMultimodalAnalysisApiResponse,
} from '../../src/contracts/multimodalAnalysis.ts'
import { MM01_SYSTEM_PROMPT } from '../../src/prompts/mm01SystemPrompt.ts'
import {
  analyzeWithFusion,
  buildFusionMm01Body,
  type FusionConfig,
} from './fusion.ts'
import type { PreparedMedia } from './media.ts'
import type { MultimodalSourceRequest } from './modelCore.ts'
import type { DownstreamTextConfig } from './downstreamText.ts'
import { seedVisualContextText } from './seed.ts'

const request: MultimodalSourceRequest = {
  sourceUrl: 'https://www.tiktok.com/@creator/video/1',
  mediaKind: 'video',
  platform: 'tiktok',
  marketId: 'id',
  marketLanguages: ['id', 'en'],
  title: '看不懂路牌',
  caption: '旅行中的信息误会',
  durationSeconds: 8,
}

const media: PreparedMedia = {
  parts: [
    { inlineData: { mimeType: 'video/mp4', data: 'VIDEO_BASE64' } },
    { text: '关键帧时间：0.20 秒' },
    { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_1_BASE64' } },
    { text: '关键帧时间：7.80 秒' },
    { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_2_BASE64' } },
  ],
  mode: 'video_inline_keyframes',
  keyframeCount: 2,
  durationSeconds: 8,
  sourceAudioTrack: 'present',
  audioInputProvenance: 'inline_video',
  warnings: [],
  cleanup: async () => undefined,
}

const config: FusionConfig = {
  gemini: {
    apiKey: 'gemini-test-key',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-test-model',
    videoFps: 3.5,
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    timeoutMs: 5_000,
  },
  seed: {
    apiKey: 'seed-test-key',
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260628',
    inferenceEndpointId: 'ep-test-seed',
    videoFps: 2,
    timeoutMs: 5_000,
  },
}

const downstreamConfig: DownstreamTextConfig = {
  apiKey: 'downstream-test-key',
  apiBaseUrl: 'https://models.example.test/v1',
  c01Model: 'context-search-test-model',
  p02Model: 'breakdown-test-model',
  timeoutMs: 5_000,
  searchTool: 'web_search_preview',
}

function seedDetailReport() {
  return {
    module: 'SEED_VISUAL_DETAIL_REPORT',
    observations: [
      {
        frameId: 'frame_001',
        people: '一人查看路牌',
        actions: '抬头',
        objects: '路牌',
        setting: '城市路口',
        composition: '人物居中',
        camera: '中景',
        lighting: '自然光',
        color: '暖色',
        visibleText: ['EXIT B'],
        uncertainties: [],
      },
      {
        frameId: 'frame_002',
        people: '一人展示手机',
        actions: '手持手机',
        objects: '手机',
        setting: '城市路口',
        composition: '手机在前景',
        camera: '近景',
        lighting: '自然光',
        color: '暖色',
        visibleText: [],
        uncertainties: ['小字不可读'],
      },
    ],
    sequenceObservations: [
      {
        timeRange: '0.0-4.0s',
        motionOrActions: '人物查看路牌',
        cameraOrTransition: '固定中景',
        visibleText: ['EXIT B'],
        uncertainties: [],
      },
      {
        timeRange: '4.0-8.0s',
        motionOrActions: '人物展示手机',
        cameraOrTransition: '切到近景',
        visibleText: [],
        uncertainties: ['手机小字不可读'],
      },
    ],
  }
}

function mm01Fixture(): Mm01AnalysisPack {
  return {
    module: 'MM01_MULTIMODAL_ANALYSIS_PACK',
    targetNextPrompt: 'C01',
    sourceMeta: {
      platform: 'unknown',
      sourceUrl: '',
      marketId: '',
      marketLanguages: [],
      title: '',
      caption: '',
      durationSec: 8,
    },
    modalityStatus: {
      videoFrames: 'ok',
      ocr: 'ok',
      asr: 'missing',
      audio: 'ok',
      analysisMode: 'full_video',
      confidenceCap: 'high',
    },
    cleanedInputsForP02: {
      transcriptStatus: 'missing',
      rawTranscript: '',
      visualDescription: '0-4 秒查看路牌，4-8 秒展示手机。',
      ocrText: 'EXIT B',
      audioDescription: '全片可听到轻快背景音乐，没有可确认人声。',
      sceneSegmentsText:
        '能力与覆盖声明：收到完整视频画面与原音轨，没有可确认人声；覆盖 0.0-8.0s，时间戳为近似值且无法精确量化误差。s1 查看路牌；s2 展示手机。核心暗线：【高概率暗线/隐喻】手机展示动作可能回应前段信息缺口；可复用的三个机制：【明确证据】路牌信息缺口、动作转折、道具揭示；仍待核验：【待核验/纯猜测】人物关系和手机用途。',
    },
    sceneSegments: [
      {
        segmentId: 's1',
        timeRange: '0.0-4.0s',
        sceneFunctionGuess: 'hook',
        visual: {
          people: '一名旅客查看路牌',
          setting: '城市路口',
          productOrObject: '路牌',
          camera: '中景静态',
          style: '暖色纪实',
        },
        ocr: { texts: ['EXIT B'], textRoleGuess: 'subtitle' },
        asr: { speech: '', language: 'unknown', speakerGuess: 'unknown' },
        audio: { musicMood: '轻快', sfx: [], voiceTone: '' },
        emotion: { viewerEmotionGuess: '好奇', characterEmotion: '困惑' },
        evidence: [
          {
            type: 'visual',
            fact: '【明确证据】旅客查看路牌',
            source: 'frame',
            confidence: 'high',
          },
          {
            type: 'text',
            fact: '【明确证据】路牌显示 EXIT B',
            source: 'ocr',
            confidence: 'high',
          },
        ],
      },
      {
        segmentId: 's2',
        timeRange: '4.0-8.0s',
        sceneFunctionGuess: 'reveal',
        visual: {
          people: '旅客展示手机',
          setting: '城市路口',
          productOrObject: '手机',
          camera: '近景',
          style: '暖色纪实',
        },
        ocr: { texts: [], textRoleGuess: 'unknown' },
        asr: { speech: '', language: 'unknown', speakerGuess: 'unknown' },
        audio: { musicMood: '轻快', sfx: [], voiceTone: '' },
        emotion: { viewerEmotionGuess: '温暖', characterEmotion: '释然' },
        evidence: [
          {
            type: 'visual',
            fact: '【明确证据】旅客展示手机',
            source: 'frame',
            confidence: 'high',
          },
        ],
      },
    ],
    globalUnderstanding: {
      topicGuess: '【高概率暗线/隐喻】旅途中通过手机处理信息理解困难',
      actionReasonGuess: {
        intendedAction: '继续出行',
        persuasionReason: '手机画面可能帮助理解',
      },
      persuasionStrategyGuess: ['human_experience', 'contrast'],
      localStyleSignals: {
        casting: '旅客与路人',
        environment: '城市路口',
        composition: '人物与道具交替',
        colorTone: '暖色',
        textOverlayStyle: '路牌文字',
        productPresentation: '结尾展示手机',
        risk: [],
      },
    },
    eventTimeline: [
      {
        timeRange: '0.0-4.0s',
        literalEvent: '旅客查看写有 EXIT B 的路牌',
        visibleEvidenceRefs: ['MM01-E001'],
        textEvidenceRefs: ['MM01-E002'],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: [],
        certainty: 'high',
      },
      {
        timeRange: '4.0-8.0s',
        literalEvent: '旅客向镜头展示手机',
        visibleEvidenceRefs: ['MM01-E003'],
        textEvidenceRefs: [],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: [],
        certainty: 'high',
      },
    ],
    narrativeMap: {
      who: '一名旅客',
      where: '城市路口',
      initialSituation: '旅客查看出口路牌',
      problemOrDesire: '旅客想理解路牌信息',
      escalation: '人物持续查看路牌',
      turningPoint: '人物展示手机',
      outcome: '手机成为画面焦点',
      impliedMeaning: '手机展示动作可能回应前段信息缺口',
      audienceTakeaway: '普通路牌信息与人物反应制造悬念',
      unknowns: ['没有可验证 ASR，无法确认对白和手机用途'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
    },
    attentionMap: [
      {
        segmentId: 's1',
        timeRange: '0.0-4.0s',
        role: 'hook',
        importanceScore: 5,
        reason: '路牌和人物困惑形成信息缺口',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
        reuseType: 'keep_structure',
        risk: [],
      },
      {
        segmentId: 's2',
        timeRange: '4.0-8.0s',
        role: 'reveal',
        importanceScore: 4,
        reason: '手机特写形成视觉转折',
        evidenceRefs: ['MM01-E003'],
        reuseType: 'keep_structure',
        risk: [],
      },
    ],
    contextGaps: [
      {
        gap: 'EXIT B 标识的常见使用语境需要外部核验',
        entities: ['EXIT B'],
        neededFor: 'understand_symbol_or_object',
        evidenceRefs: ['MM01-E002'],
        searchQueries: ['EXIT B sign common meaning'],
      },
    ],
    interpretationCandidates: [
      {
        claim: '旅客可能在确认出口信息时遇到理解困难',
        supportingEvidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
        contradictingEvidenceRefs: [],
        confidence: 'medium',
        reasoningLimits: '无 ASR，手机用途和因果关系不能确认为事实。',
      },
    ],
    crossModalChecks: {
      captionVsVideo: 'unknown',
      asrVsOcr: 'unknown',
      audioVsEmotion: 'consistent',
      notes: 'ASR 缺失，无法核对口播与 OCR。',
    },
    qualityFlags: {
      missingCriticalInfo: ['asr'],
      needsHumanReview: true,
      reason: '没有可验证 ASR。',
    },
  }
}

function c01Fixture(): ContextResearchOutput {
  return {
    module: 'C01_CONTEXT_RESEARCH_PACK',
    targetNextPrompt: 'P02F',
    searchRequired: true,
    searchPerformed: true,
    searchProvider: 'context-search-test-model',
    contextPack: [
      {
        claim: 'EXIT B 常见于交通或场馆出口编号标识。',
        source: 'https://example.test/exit-b',
        sourceType: 'search',
        confidence: 'medium',
        appliesToVideo: 'supports_interpretation',
        boundary: '只能解释 EXIT B 标识的可能语境，不能确认具体地点。',
        evidenceNeededInVideo: ['画面出现 EXIT B'],
      },
    ],
    interpretiveBridge: {
      videoFacts: ['MM01-E001', 'MM01-E003'],
      externalContext: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInference:
        'MM01-E001 + https://example.test/exit-b 共同支持旅客可能在确认出口信息时遇到理解困难。',
      uncertainty: '无 ASR，无法确认人物对白和手机用途。',
    },
    sources: ['https://example.test/exit-b'],
    qualityFlags: {
      needsHumanReview: false,
      reason: '',
    },
  }
}

function p02Fixture(): P02Breakdown {
  const story =
    '一名旅客在城市路口查看写有 EXIT B 的路牌，随后把手机转向镜头展示。画面从查看公共信息转到近距离展示手机，但没有可验证口播说明两者之间的具体因果。'
  return {
    theme: '旅行场景中的信息理解',
    tags: ['旅行', '路牌', '手机', '信息'],
    subtitleBody: '',
    sourceFactSummary: '旅客先查看路牌，随后展示手机。',
    evidenceBeats: [
      { type: 'visual', fact: '【明确证据】旅客查看路牌', evidence: '[MM01-E001] 0.0-4.0s 画面' },
      { type: 'text', fact: '【明确证据】路牌显示 EXIT B', evidence: '[MM01-E002] 0.0-4.0s OCR' },
      { type: 'visual', fact: '【明确证据】旅客展示手机', evidence: '[MM01-E003] 4.0-8.0s 画面' },
    ],
    keyMoments: [
      {
        timeRange: '0.0-4.0s',
        role: 'hook',
        fact: '旅客查看写有 EXIT B 的路牌',
        whyImportant: '路牌信息与人物反应形成开场信息缺口',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
      },
      {
        timeRange: '4.0-8.0s',
        role: 'reveal',
        fact: '旅客把手机转向镜头展示',
        whyImportant: '手机特写形成视觉转折',
        evidenceRefs: ['MM01-E003'],
      },
    ],
    sourceVsContextBoundary: {
      videoFacts: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
      externalContextUsed: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInferences: [
        'MM01-E001 + https://example.test/exit-b 共同支持旅客可能在确认出口信息时遇到理解困难。',
      ],
    },
    narrativeMechanics: {
      audienceReason: '观众会继续看，是因为可见路牌和人物困惑之间形成信息差。',
      narrativeEngine: '剧情从查看公共信息推进到展示私人设备。',
      payoffLogic: '手机特写回应前段信息缺口，但具体用途仍保留不确定性。',
      preservedSignals: ['路牌与困惑的反差', '手机展示动作承担转折'],
      replaceableSurface: ['具体出口编号', '城市路口', '手机界面'],
      forbiddenSurface: ['原人物脸', '原品牌界面', '原账号水印'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
    },
    riskRefs: [],
    uncertaintyNotes: '无 ASR，无法确认对白和手机用途。',
    story,
    coreHook: '看到出口牌后仍继续查看手机',
    storyCharCount: [...story.trim()].length,
    transcriptUsed: false,
    confidence: 'high',
    notes: '音频与口播没有进入事实链。',
  }
}

const fusionReview = {
  consensus: ['两边都识别到路牌、人物和后段手机特写。'],
  conflicts: [
    {
      topic: '手机的作用',
      gemini: '可能用于理解信息',
      seed: '只确认手机被展示，小字不可读',
      resolution: '保留手机被展示的事实，因果降为推断。',
      adoptedFrom: 'both' as const,
    },
  ],
  finalConclusion: '采用共同可见事实，未确认的因果不写成直接证据。',
}

function seedResponse(output: unknown): Response {
  return new Response(
    JSON.stringify({
      model: 'seed-reported-test-model',
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(output) }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function geminiResponse(output: unknown): Response {
  return new Response(
    JSON.stringify({
      modelVersion: 'gemini-reported-test-model',
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(output) }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 200,
        totalTokenCount: 300,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function responsesResponse(output: unknown): Response {
  return new Response(
    JSON.stringify({
      model: 'downstream-reported-test-model',
      output: [
        { type: 'web_search_call', id: 'search-1', status: 'completed' },
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(output),
              annotations: [
                { type: 'url_citation', url: 'https://example.test/exit-b' },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 30, output_tokens: 40, total_tokens: 70 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('Seed + Gemini fusion profile', () => {
  it('wraps the Gemini MM01 schema and marks Seed observations untrusted', () => {
    const context = seedVisualContextText(seedDetailReport())
    expect(context.startsWith('{')).toBe(true)
    expect(context).not.toContain('<seed_')
    const body = buildFusionMm01Body(request, media, context, config.gemini)
    expect(body.systemInstruction).toEqual({
      parts: [{ text: MM01_SYSTEM_PROMPT }],
    })
    expect(JSON.stringify(body)).toContain('retrieval_aid_only')
    expect(JSON.stringify(body)).toContain('fusionReview')
    const parts = (
      body.contents as Array<{ parts: Array<Record<string, unknown>> }>
    )[0].parts
    expect(parts[0]).toMatchObject({
      inlineData: { mimeType: 'video/mp4' },
      videoMetadata: { fps: 3.5 },
    })
    expect(body.generationConfig).toMatchObject({
      mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    })
    expect(
      (body.generationConfig as Record<string, unknown>).responseSchema,
    ).toMatchObject({
      required: ['mm01', 'fusionReview'],
    })
  })

  it('runs Seed visual scout, Gemini verification, C01 and P02 in order', async () => {
    expect(parseMm01AnalysisPack(mm01Fixture()).targetNextPrompt).toBe('C01')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seedResponse(seedDetailReport()))
      .mockResolvedValueOnce(
        geminiResponse({ mm01: mm01Fixture(), fusionReview }),
      )
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))

    const result = await analyzeWithFusion(
      request,
      media,
      config,
      fetchMock as typeof fetch,
      downstreamConfig,
    )

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://ark.cn-beijing.volces.com/api/v3/responses',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent',
      'https://models.example.test/v1/responses',
      'https://models.example.test/v1/responses',
    ])
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1].body)).model,
    ).toBe('ep-test-seed')
    const geminiMm01Body = JSON.parse(
      String(fetchMock.mock.calls[1][1].body),
    )
    const geminiMm01Parts = (
      geminiMm01Body.contents as Array<{
        parts: Array<Record<string, unknown>>
      }>
    )[0].parts
    expect(geminiMm01Parts[0]).toMatchObject({
      inlineData: { mimeType: 'video/mp4' },
      videoMetadata: { fps: 3.5 },
    })
    expect(geminiMm01Body.generationConfig).toMatchObject({
      mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    })
    const c01Body = JSON.parse(String(fetchMock.mock.calls[2][1].body))
    const p02Body = JSON.parse(String(fetchMock.mock.calls[3][1].body))
    expect(JSON.stringify(c01Body)).toContain('C01_CONTEXT_RESEARCH_PACK')
    expect(JSON.stringify(c01Body)).toContain('web_search_preview')
    expect(JSON.stringify(c01Body)).not.toContain('VIDEO_BASE64')
    expect(JSON.stringify(p02Body)).toContain('P02 confidence')
    expect(JSON.stringify(p02Body)).not.toContain('VIDEO_BASE64')
    expect(result.fusionReview).toEqual(fusionReview)
    expect(result.diagnostics).toMatchObject({
      provider: 'fusion',
      profile: 'fusion',
      modelCalls: 4,
      geminiVideoFps: 3.5,
      geminiMediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
      reportedModels: [
        { stage: 'mm01', model: 'gemini-reported-test-model' },
        { stage: 'c01', model: 'downstream-reported-test-model' },
        { stage: 'p02', model: 'downstream-reported-test-model' },
      ],
      models: [
        {
          role: 'visual_detail',
          provider: 'seed',
          model: 'seed-reported-test-model',
        },
        {
          role: 'multimodal_synthesis',
          provider: 'gemini',
          model: 'gemini-reported-test-model',
        },
        {
          role: 'context_research',
          provider: 'downstream',
          model: 'context-search-test-model',
        },
        {
          role: 'p02',
          provider: 'downstream',
          model: 'breakdown-test-model',
        },
      ],
      fusion: {
        strategy: 'seed_visual_then_gemini_verification',
        seedInputMode: 'video_and_keyframes',
        seedVideoFps: 2,
        seedFrameCount: 2,
        seedObservationCount: 2,
        seedSequenceCount: 2,
      },
    })
    expect(result.mm01.sourceMeta.sourceUrl).toBe(request.sourceUrl)
    expect(result.p02Handoff.p02FormattedPrompt).not.toContain('fusionReview')
    expect(
      parseMultimodalAnalysisApiResponse({ analysis: result }).fusionReview,
    ).toEqual(fusionReview)
  })

  it('keeps fusion available with inline video when hosted FFmpeg yields zero frames', async () => {
    const videoOnly: PreparedMedia = {
      ...media,
      parts: [{ inlineData: { mimeType: 'video/mp4', data: 'VIDEO_BASE64' } }],
      mode: 'video_inline',
      keyframeCount: 0,
    }
    const videoOnlyReport = {
      module: 'SEED_VISUAL_DETAIL_REPORT',
      observations: [],
      sequenceObservations: seedDetailReport().sequenceObservations,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seedResponse(videoOnlyReport))
      .mockResolvedValueOnce(
        geminiResponse({ mm01: mm01Fixture(), fusionReview }),
      )
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))

    const result = await analyzeWithFusion(
      request,
      videoOnly,
      config,
      fetchMock as typeof fetch,
      downstreamConfig,
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.diagnostics.fusion).toMatchObject({
      seedInputMode: 'video_only',
      seedVideoFps: 2,
      seedFrameCount: 0,
      seedObservationCount: 0,
      seedSequenceCount: 2,
    })
    expect(
      parseMultimodalAnalysisApiResponse({ analysis: result }).diagnostics
        .fusion?.seedInputMode,
    ).toBe('video_only')
  })

  it('rejects Gemini audio claims when fusion only supplied timestamped frames', async () => {
    const framesOnly: PreparedMedia = {
      ...media,
      parts: media.parts.filter(
        (part) =>
          !(
            'inlineData' in part &&
            part.inlineData.mimeType.startsWith('video/')
          ),
      ),
      mode: 'video_frames',
      sourceAudioTrack: 'absent',
      audioInputProvenance: 'none',
    }
    const invalidMm01 = mm01Fixture()
    invalidMm01.modalityStatus.audio = 'ok'
    invalidMm01.cleanedInputsForP02.audioDescription = '模型声称听到轻快音乐。'
    invalidMm01.qualityFlags.missingCriticalInfo = ['asr']
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        seedResponse({ ...seedDetailReport(), sequenceObservations: [] }),
      )
      .mockResolvedValueOnce(
        geminiResponse({ mm01: invalidMm01, fusionReview }),
      )
      .mockResolvedValueOnce(
        seedResponse({ ...seedDetailReport(), sequenceObservations: [] }),
      )
      .mockResolvedValueOnce(
        geminiResponse({ mm01: invalidMm01, fusionReview }),
      )
      .mockResolvedValueOnce(
        seedResponse({ ...seedDetailReport(), sequenceObservations: [] }),
      )
      .mockResolvedValueOnce(
        geminiResponse({ mm01: invalidMm01, fusionReview }),
      )

    await expect(
      analyzeWithFusion(
        request,
        framesOnly,
        config,
        fetchMock as typeof fetch,
        downstreamConfig,
      ),
    ).rejects.toThrow(/audio unavailable/)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://ark.cn-beijing.volces.com/api/v3/responses',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent',
      'https://ark.cn-beijing.volces.com/api/v3/responses',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent',
      'https://ark.cn-beijing.volces.com/api/v3/responses',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent',
    ])
  })
})
