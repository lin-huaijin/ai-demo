import { describe, expect, it, vi } from 'vitest'
import {
  parseMultimodalAnalysisApiResponse,
  type ContextResearchOutput,
  type Mm01AnalysisPack,
  type P02Breakdown,
  type P02FormattedPromptCompilerOutput,
} from '../../src/contracts/multimodalAnalysis.ts'
import { MM01_SYSTEM_PROMPT } from '../../src/prompts/mm01SystemPrompt.ts'
import type { DownstreamTextConfig } from './downstreamText.ts'
import type { PreparedMedia } from './media.ts'
import {
  sampledVisualTimestampsForPreparedMedia,
  type MultimodalSourceRequest,
} from './modelCore.ts'
import {
  analyzeSeedVisualDetails,
  analyzeWithSeed,
  buildSeedMm01Body,
  buildSeedP02Body,
  buildSeedVisualDetailBody,
  callSeed,
  parseSeedVisualDetailReport,
  projectMediaForSeed,
  seedConfigForRequest,
  validateSeedApiBaseUrl,
  type SeedConfig,
} from './seed.ts'

const media: PreparedMedia = {
  parts: [
    { inlineData: { mimeType: 'video/mp4', data: 'VIDEO_BASE64' } },
    { inlineData: { mimeType: 'audio/mpeg', data: 'AUDIO_BASE64' } },
    { text: '关键帧时间：0.20 秒' },
    { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_1_BASE64' } },
    { text: '关键帧时间：7.80 秒' },
    { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_2_BASE64' } },
  ],
  mode: 'video_inline_keyframes',
  keyframeCount: 2,
  durationSeconds: 8,
  warnings: [],
  cleanup: async () => undefined,
}

const config: SeedConfig = {
  apiKey: 'seed-test-key',
  apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seed-2-1-pro-260628',
  videoFps: 2,
  timeoutMs: 5_000,
}

const downstreamConfig: DownstreamTextConfig = {
  apiKey: 'downstream-test-key',
  apiBaseUrl: 'https://models.example.test/v1',
  c01Model: 'context-search-test-model',
  p02Model: 'breakdown-test-model',
  timeoutMs: 5_000,
  searchTool: 'web_search_preview',
}

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

function detailReport() {
  return {
    module: 'SEED_VISUAL_DETAIL_REPORT',
    observations: [
      {
        frameId: 'frame_001',
        people: '一人站在路牌旁',
        actions: '抬头看向路牌',
        objects: '路牌与手机',
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
        people: '一人把手机转向镜头',
        actions: '手持手机',
        objects: '手机',
        setting: '城市路口',
        composition: '手机位于前景',
        camera: '近景',
        lighting: '自然光',
        color: '暖色',
        visibleText: [],
        uncertainties: ['手机小字不可读'],
      },
    ],
    sequenceObservations: [
      {
        timeRange: '0.0-4.0s',
        motionOrActions: '人物先看路牌，再拿起手机',
        cameraOrTransition: '固定中景，随后切到近景',
        visibleText: ['EXIT B'],
        uncertainties: [],
      },
      {
        timeRange: '4.0-8.0s',
        motionOrActions: '人物把手机转向镜头',
        cameraOrTransition: '近景保持',
        visibleText: [],
        uncertainties: ['手机屏幕小字不可读'],
      },
    ],
  }
}

function mm01Fixture(): Mm01AnalysisPack {
  return {
    module: 'MM01_MULTIMODAL_ANALYSIS_PACK',
    targetNextPrompt: 'C01',
    sourceMeta: {
      platform: 'tiktok',
      sourceUrl: request.sourceUrl,
      marketId: request.marketId,
      marketLanguages: request.marketLanguages,
      title: request.title,
      caption: request.caption,
      durationSec: 8,
    },
    modalityStatus: {
      videoFrames: 'ok',
      ocr: 'ok',
      asr: 'missing',
      audio: 'missing',
      analysisMode: 'full_video',
      confidenceCap: 'high',
    },
    cleanedInputsForP02: {
      transcriptStatus: 'missing',
      rawTranscript: '',
      visualDescription: '0-4 秒人物查看路牌，4-8 秒把手机转向镜头。',
      ocrText: 'EXIT B',
      audioDescription: '',
      sceneSegmentsText:
        '能力与覆盖声明：收到完整视频画面和关键帧，Seed 适配器未授权音频或 ASR；覆盖 0.0-8.0s，时间戳为近似值且无法精确量化误差。s1 查看路牌；s2 展示手机。核心暗线：【高概率暗线/隐喻】手机展示动作可能回应前段信息缺口；可复用的三个机制：【明确证据】路牌信息缺口、动作转折、道具揭示；仍待核验：【待核验/纯猜测】人物关系、对白和手机用途。',
    },
    sceneSegments: [
      {
        segmentId: 's1',
        timeRange: '0.0-4.0s',
        sceneFunctionGuess: 'hook',
        visual: {
          people: '一名人物查看路牌',
          setting: '城市路口',
          productOrObject: '路牌',
          camera: '中景静态',
          style: '暖色纪实',
        },
        ocr: { texts: ['EXIT B'], textRoleGuess: 'subtitle' },
        asr: { speech: '', language: 'unknown', speakerGuess: 'unknown' },
        audio: { musicMood: '', sfx: [], voiceTone: '' },
        emotion: { viewerEmotionGuess: '好奇', characterEmotion: '困惑' },
        evidence: [
          {
            type: 'visual',
            fact: '【明确证据】人物查看路牌',
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
          people: '人物把手机转向镜头',
          setting: '城市路口',
          productOrObject: '手机',
          camera: '近景',
          style: '暖色纪实',
        },
        ocr: { texts: [], textRoleGuess: 'unknown' },
        asr: { speech: '', language: 'unknown', speakerGuess: 'unknown' },
        audio: { musicMood: '', sfx: [], voiceTone: '' },
        emotion: { viewerEmotionGuess: '温暖', characterEmotion: '释然' },
        evidence: [
          {
            type: 'visual',
            fact: '【明确证据】人物展示手机',
            source: 'frame',
            confidence: 'high',
          },
          {
            type: 'inference',
            fact: '【高概率暗线/隐喻】手机可能回应前段信息缺口；依据是路牌后紧接手机展示，其他解释是普通内容展示',
            source: 'model_inference',
            confidence: 'medium',
          },
        ],
      },
    ],
    globalUnderstanding: {
      topicGuess: '【高概率暗线/隐喻】旅途中的信息理解困难',
      actionReasonGuess: {
        intendedAction: '继续出行',
        persuasionReason: '手机展示动作可能回应前段困惑',
      },
      persuasionStrategyGuess: ['human_experience', 'contrast'],
      localStyleSignals: {
        casting: '一名人物',
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
        literalEvent: '人物查看写有 EXIT B 的路牌',
        visibleEvidenceRefs: ['MM01-E001'],
        textEvidenceRefs: ['MM01-E002'],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: [],
        certainty: 'high',
      },
      {
        timeRange: '4.0-8.0s',
        literalEvent: '人物把手机转向镜头展示',
        visibleEvidenceRefs: ['MM01-E003'],
        textEvidenceRefs: [],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: ['MM01-E004'],
        certainty: 'high',
      },
    ],
    narrativeMap: {
      who: '一名人物',
      where: '城市路口',
      initialSituation: '人物查看路牌',
      problemOrDesire: '人物可能想理解路牌信息',
      escalation: '人物持续查看路牌',
      turningPoint: '人物展示手机',
      outcome: '手机成为画面焦点',
      impliedMeaning: '手机展示动作可能回应前段信息缺口',
      audienceTakeaway: '普通信息和人物反应之间的反差可以制造悬念',
      unknowns: ['Seed 无音频和 ASR 权限，无法确认对白和因果'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003', 'MM01-E004'],
    },
    attentionMap: [
      {
        segmentId: 's1',
        timeRange: '0.0-4.0s',
        role: 'hook',
        importanceScore: 5,
        reason: '路牌与人物反应形成信息缺口',
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
        evidenceRefs: ['MM01-E003', 'MM01-E004'],
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
        claim: '人物可能在确认出口信息时遇到理解困难',
        supportingEvidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
        contradictingEvidenceRefs: [],
        confidence: 'medium',
        reasoningLimits: '无音频和 ASR，不能确认对白和手机用途。',
      },
    ],
    crossModalChecks: {
      captionVsVideo: 'consistent',
      asrVsOcr: 'unknown',
      audioVsEmotion: 'unknown',
      notes: 'Seed 适配器未授权音频和 ASR。',
    },
    qualityFlags: {
      missingCriticalInfo: ['asr', 'audio'],
      needsHumanReview: true,
      reason: '音频和 ASR 不可用，因果需人工复核。',
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
        boundary: '只能解释标识的可能语境，不能确认具体地点。',
        evidenceNeededInVideo: ['画面出现 EXIT B'],
      },
    ],
    interpretiveBridge: {
      videoFacts: ['MM01-E001', 'MM01-E003'],
      externalContext: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInference:
        'MM01-E001 + https://example.test/exit-b 共同支持人物可能在确认出口信息时遇到理解困难。',
      uncertainty: 'Seed 无音频和 ASR，无法确认对白和因果。',
    },
    sources: ['https://example.test/exit-b'],
    qualityFlags: { needsHumanReview: false, reason: '' },
  }
}

function p02Fixture(): P02Breakdown {
  const story =
    '一名人物先在城市路口查看写有 EXIT B 的路牌，随后把手机转向镜头展示。画面从公共标识切换到私人设备，形成信息转折；由于没有音频与 ASR，手机的具体用途和人物意图仍不能确认为事实。'
  return {
    theme: '旅行场景中的信息理解',
    tags: ['旅行', '路牌', '手机', '信息差'],
    subtitleBody: '',
    sourceFactSummary: '人物先查看 EXIT B 路牌，随后展示手机。',
    evidenceBeats: [
      { type: 'visual', fact: '【明确证据】人物查看路牌', evidence: '[MM01-E001] 0.0-4.0s 画面' },
      { type: 'text', fact: '【明确证据】路牌显示 EXIT B', evidence: '[MM01-E002] 0.0-4.0s OCR' },
      { type: 'visual', fact: '【明确证据】人物展示手机', evidence: '[MM01-E003] 4.0-8.0s 画面' },
    ],
    keyMoments: [
      {
        timeRange: '0.0-4.0s',
        role: 'hook',
        fact: '人物查看写有 EXIT B 的路牌',
        whyImportant: '路牌与人物反应形成开场信息缺口',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
      },
      {
        timeRange: '4.0-8.0s',
        role: 'reveal',
        fact: '人物把手机转向镜头',
        whyImportant: '手机特写形成视觉转折',
        evidenceRefs: ['MM01-E003'],
      },
    ],
    sourceVsContextBoundary: {
      videoFacts: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
      externalContextUsed: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInferences: [
        'MM01-E001 + https://example.test/exit-b 共同支持人物可能在确认出口信息时遇到理解困难。',
      ],
    },
    narrativeMechanics: {
      audienceReason: '可见标识与人物反应之间的信息差促使观众继续观看。',
      narrativeEngine: '画面从查看公共标识推进到展示私人设备。',
      payoffLogic: '手机特写回应前段信息缺口，但不虚构具体用途。',
      preservedSignals: ['路牌信息缺口', '手机展示动作', '公共标识到私人设备的转折'],
      replaceableSurface: ['具体出口编号', '城市路口', '手机样式'],
      forbiddenSurface: ['原人物脸', '原品牌界面', '原账号水印'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
    },
    riskRefs: [],
    uncertaintyNotes: 'Seed 无音频和 ASR，无法确认对白和手机用途。',
    story,
    coreHook: '看见出口牌后，为何还要展示手机',
    storyCharCount: [...story.trim()].length,
    transcriptUsed: false,
    confidence: 'medium',
    notes: '只保留视觉与 OCR 事实，因果作为受限推断。',
  }
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
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        total_tokens: 33,
        input_tokens_details: { cached_tokens: 2 },
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

describe('Seed 2.1 Pro Ark Responses adapter', () => {
  it('builds standalone MM01 with full visual media and P02 as text-only handoff', () => {
    const projection = projectMediaForSeed(media)
    const mm01Body = buildSeedMm01Body(request, projection, config)
    const mm01Text = JSON.stringify(mm01Body)
    expect(mm01Text).toContain('input_video')
    expect(mm01Text).toContain('VIDEO_BASE64')
    expect(mm01Text).toContain('FRAME_1_BASE64')
    expect(mm01Text).not.toContain('AUDIO_BASE64')
    expect(mm01Text).toContain('能力与覆盖声明')
    expect(mm01Text).toContain('【高概率暗线/隐喻】')
    const input = mm01Body.input as Array<{
      content: Array<{ type: string; text?: string }>
    }>
    const instruction = input[0].content.find(
      (part) => part.type === 'input_text' && part.text?.includes('能力与覆盖声明'),
    )?.text
    expect(instruction?.startsWith(MM01_SYSTEM_PROMPT)).toBe(true)

    const handoff: P02FormattedPromptCompilerOutput = {
      module: 'P02_FORMATTED_PROMPT_COMPILER',
      targetNextPrompt: 'P02',
      analysisMode: 'audio_frames',
      confidenceCap: 'medium',
      p02FormattedPrompt: '[MM01-E001] evidence handoff',
      sourceUsed: ['visual'],
      handoffNotes: 'test',
      qualityFlags: {
        missingCriticalInfo: ['asr', 'audio'],
        needsHumanReview: true,
        reason: 'Seed has no authorized audio evidence.',
      },
    }
    const p02Text = JSON.stringify(buildSeedP02Body(handoff, config))
    expect(p02Text).toContain('[MM01-E001] evidence handoff')
    expect(p02Text).toContain('evidenceBeats')
    expect(p02Text).not.toContain('input_video')
    expect(p02Text).not.toContain('FRAME_1_BASE64')
  })

  it('runs visual-only MM01, searched C01 and downstream P02 with explicit provenance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(seedResponse(mm01Fixture()))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))

    const result = await analyzeWithSeed(
      request,
      media,
      config,
      fetchMock as typeof fetch,
      downstreamConfig,
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://ark.cn-beijing.volces.com/api/v3/responses',
      'https://models.example.test/v1/responses',
      'https://models.example.test/v1/responses',
    ])
    const mm01Body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    const c01Body = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    const p02Body = JSON.parse(String(fetchMock.mock.calls[2][1].body))
    expect(JSON.stringify(mm01Body)).toContain('VIDEO_BASE64')
    expect(JSON.stringify(mm01Body)).toContain('FRAME_1_BASE64')
    expect(JSON.stringify(mm01Body)).not.toContain('AUDIO_BASE64')
    expect(JSON.stringify(c01Body)).toContain('C01_CONTEXT_RESEARCH_PACK')
    expect(JSON.stringify(c01Body)).toContain('web_search_preview')
    expect(JSON.stringify(c01Body)).not.toContain('VIDEO_BASE64')
    expect(JSON.stringify(p02Body)).toContain('P02 confidence')
    expect(JSON.stringify(p02Body)).not.toContain('VIDEO_BASE64')

    expect(result.mm01.modalityStatus).toMatchObject({
      audio: 'missing',
      asr: 'missing',
    })
    expect(result.diagnostics).toMatchObject({
      provider: 'seed',
      profile: 'seed-2.1-pro',
      modelCalls: 3,
      reportedModels: [
        { stage: 'mm01', model: 'seed-reported-test-model' },
        { stage: 'c01', model: 'downstream-reported-test-model' },
        { stage: 'p02', model: 'downstream-reported-test-model' },
      ],
      models: [
        {
          role: 'visual_detail',
          provider: 'seed',
          model: 'doubao-seed-2-1-pro-260628',
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
    })
    expect(
      parseMultimodalAnalysisApiResponse({ analysis: result }).diagnostics
        .modelCalls,
    ).toBe(3)
  })

  it('sends full visual video plus timestamped keyframes and excludes standalone audio', () => {
    const projection = projectMediaForSeed(media)
    expect(projection.videos).toHaveLength(1)
    expect(projection.frames.map(({ timeLabel }) => timeLabel)).toEqual([
      '0.20 秒',
      '7.80 秒',
    ])
    expect(JSON.stringify(projection.media.parts)).not.toContain('AUDIO_BASE64')
    expect(projection.media.mode).toBe('video_inline_keyframes')

    const body = buildSeedVisualDetailBody(projection, config)
    const serialized = JSON.stringify(body)
    expect(body.model).toBe('doubao-seed-2-1-pro-260628')
    expect(serialized).toContain('"type":"input_video"')
    expect(serialized).toContain('data:video/mp4;base64,VIDEO_BASE64')
    expect(serialized).toContain('"fps":2')
    expect(serialized).toContain('data:image/jpeg;base64,FRAME_1_BASE64')
    expect(serialized).not.toContain('AUDIO_BASE64')
    expect(serialized).toContain('sequenceObservations')
  })

  it('preserves canonical sample timestamps when Seed falls back to keyframes only', () => {
    const framesOnly: PreparedMedia = {
      ...media,
      parts: media.parts.filter(
        (part) =>
          'text' in part || part.inlineData.mimeType.startsWith('image/'),
      ),
      mode: 'video_frames',
    }
    const projection = projectMediaForSeed(framesOnly)

    expect(projection.media.mode).toBe('video_frames')
    expect(JSON.stringify(projection.media.parts)).toContain('Seed 视觉帧 frame_001')
    expect(sampledVisualTimestampsForPreparedMedia(projection.media)).toEqual([
      0.2,
      7.8,
    ])
  })

  it('uses an optional Ark inference endpoint ID only as the request model override', () => {
    const projection = projectMediaForSeed(media)
    const body = buildSeedVisualDetailBody(projection, {
      model: 'doubao-seed-2-1-pro-260628',
      inferenceEndpointId: 'ep-test-123',
      videoFps: 2,
    })
    expect(body.model).toBe('ep-test-123')
  })

  it('extracts only final output_text and reports snake_case usage', async () => {
    const fetchMock = vi.fn(async () => seedResponse(detailReport()))
    const result = await callSeed(
      buildSeedVisualDetailBody(projectMediaForSeed(media), config),
      config,
      fetchMock as typeof fetch,
    )
    expect(result.candidates).toContainEqual(detailReport())
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      totalTokens: 33,
      cachedInputTokens: 2,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer seed-test-key',
    })
  })

  it('validates every keyframe and continuous-video observation before fusion', async () => {
    const fetchMock = vi.fn(async () => seedResponse(detailReport()))
    const result = await analyzeSeedVisualDetails(
      media,
      config,
      fetchMock as typeof fetch,
    )
    expect(result).toMatchObject({
      frameCount: 2,
      inputMode: 'video_and_keyframes',
      report: {
        module: 'SEED_VISUAL_DETAIL_REPORT',
        observations: [{ frameId: 'frame_001' }, { frameId: 'frame_002' }],
        sequenceObservations: [
          { timeRange: '0.0-4.0s' },
          { timeRange: '4.0-8.0s' },
        ],
      },
    })
  })

  it('supports hosted video-only analysis when FFmpeg produced no keyframes', async () => {
    const videoOnly: PreparedMedia = {
      ...media,
      parts: [{ inlineData: { mimeType: 'video/mp4', data: 'VIDEO_BASE64' } }],
      mode: 'video_inline',
      keyframeCount: 0,
    }
    const report = {
      module: 'SEED_VISUAL_DETAIL_REPORT',
      observations: [],
      sequenceObservations: detailReport().sequenceObservations,
    }
    const fetchMock = vi.fn(async () => seedResponse(report))
    await expect(
      analyzeSeedVisualDetails(videoOnly, config, fetchMock as typeof fetch),
    ).resolves.toMatchObject({
      frameCount: 0,
      inputMode: 'video_only',
      report,
    })
  })

  it('rejects sequence claims when only still images were supplied', async () => {
    const stillMedia: PreparedMedia = {
      ...media,
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_1_BASE64' } },
        { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_2_BASE64' } },
      ],
      mode: 'image_inline',
    }
    const fetchMock = vi.fn(async () => seedResponse(detailReport()))
    await expect(
      analyzeSeedVisualDetails(stillMedia, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'SEED_INVALID_OUTPUT' })
  })

  it('rejects oversized Seed fields and lists before Gemini prompt embedding', () => {
    const projection = projectMediaForSeed(media)
    const oversizedField = detailReport()
    oversizedField.observations[0].people = 'x'.repeat(2_001)
    expect(() =>
      parseSeedVisualDetailReport(oversizedField, projection),
    ).toThrow(/safe character limit/)

    const oversizedList = detailReport()
    oversizedList.observations[0].visibleText = Array.from(
      { length: 25 },
      (_, index) => `text-${index}`,
    )
    expect(() =>
      parseSeedVisualDetailReport(oversizedList, projection),
    ).toThrow(/safe item limit/)
  })

  it('distinguishes incomplete output from a safety refusal', async () => {
    const body = buildSeedVisualDetailBody(projectMediaForSeed(media), config)
    const incomplete = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'incomplete', output: [] }), {
        status: 200,
      }),
    )
    await expect(
      callSeed(body, config, incomplete as typeof fetch),
    ).rejects.toMatchObject({ code: 'SEED_INCOMPLETE' })

    const refusal = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'not allowed' }],
            },
          ],
        }),
        { status: 200 },
      ),
    )
    await expect(
      callSeed(body, config, refusal as typeof fetch),
    ).rejects.toMatchObject({ code: 'SEED_BLOCKED' })
  })
})

describe('Seed configuration security', () => {
  it('requires HTTPS and an exact allowlisted host', () => {
    expect(() =>
      validateSeedApiBaseUrl('http://ark.cn-beijing.volces.com/api/v3'),
    ).toThrow(/HTTPS/)
    expect(() => validateSeedApiBaseUrl('https://proxy.example.com/api/v3')).toThrow(
      /allowlist/,
    )
    expect(
      validateSeedApiBaseUrl('https://proxy.example.com/api/v3/', [
        'proxy.example.com',
      ]),
    ).toBe('https://proxy.example.com/api/v3')
  })

  it('accepts only the dedicated per-request Seed key', () => {
    expect(
      seedConfigForRequest(
        {
          headers: {
            'x-intent-seed-key': 'seed-session-key',
            'x-intent-gemini-key': 'gemini-session-key',
          },
        },
        { SEED_API_KEY: 'seed-server-key' },
      ).apiKey,
    ).toBe('seed-session-key')
    const serverConfig = seedConfigForRequest(
        { headers: { 'x-intent-gemini-key': 'gemini-session-key' } },
        { SEED_API_KEY: 'seed-server-key' },
      )
    expect(serverConfig.apiKey).toBe('seed-server-key')
    expect(serverConfig.videoFps).toBe(2)
    expect(
      seedConfigForRequest(
        { headers: {} },
        { ARK_API_KEY: 'ark-server-key' },
      ).apiKey,
    ).toBe('ark-server-key')
    expect(
      seedConfigForRequest(
        { headers: {} },
        {
          SEED_API_KEY: 'seed-server-key',
          ARK_API_KEY: 'ark-server-key',
        },
      ).apiKey,
    ).toBe('seed-server-key')
    expect(() =>
      seedConfigForRequest(
        { headers: {} },
        { SEED_VIDEO_FPS: '5.1' },
      ),
    ).toThrow(/0.2/)
  })
})
