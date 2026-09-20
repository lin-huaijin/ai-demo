import { describe, expect, it, vi } from 'vitest'
import {
  ANALYSIS_MODE_CONFIDENCE_CAP,
  parseMultimodalAnalysisApiResponse,
  type ContextResearchOutput,
  type Mm01AnalysisPack,
  type P02Breakdown,
} from '../../src/contracts/multimodalAnalysis.ts'
import { MM01_SYSTEM_PROMPT } from '../../src/prompts/mm01SystemPrompt.ts'
import {
  analyzeWithKimi,
  buildKimiMm01Body,
  kimiConfigForRequest,
  projectMediaForKimi,
  validateKimiApiBaseUrl,
  type KimiConfig,
} from './kimi.ts'
import type { PreparedMedia } from './media.ts'
import type { MultimodalSourceRequest } from './modelCore.ts'

const request: MultimodalSourceRequest = {
  sourceUrl: 'https://www.tiktok.com/@creator/video/1',
  mediaKind: 'video',
  platform: 'tiktok',
  marketId: 'id',
  marketLanguages: ['id', 'en'],
  title: '看不懂路牌',
  caption: '旅行中的信息误会',
  providerTranscript: '不可信字幕候选',
  durationSeconds: 8,
}

const media: PreparedMedia = {
  parts: [
    { text: '关键帧时间：2.00 秒' },
    { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_BASE64' } },
    { inlineData: { mimeType: 'audio/mpeg', data: 'AUDIO_BASE64' } },
    { inlineData: { mimeType: 'video/mp4', data: 'VIDEO_BASE64' } },
  ],
  mode: 'video_inline_keyframes',
  keyframeCount: 1,
  durationSeconds: 8,
  audioTrackRemoved: true,
  warnings: [],
  cleanup: async () => undefined,
}

process.env.DOWNSTREAM_MODEL_API_KEY = 'downstream-test-key'

function mm01Fixture(): Mm01AnalysisPack {
  return {
    module: 'MM01_MULTIMODAL_ANALYSIS_PACK',
    targetNextPrompt: 'C01',
    sourceMeta: {
      platform: 'unknown',
      sourceUrl: 'model-controlled-value',
      marketId: 'wrong',
      marketLanguages: [],
      title: 'wrong',
      caption: 'wrong',
      durationSec: 999,
    },
    modalityStatus: {
      videoFrames: 'ok',
      ocr: 'ok',
      asr: 'missing',
      audio: 'missing',
      analysisMode: 'compressed_video',
      confidenceCap: 'medium',
    },
    cleanedInputsForP02: {
      transcriptStatus: 'missing',
      rawTranscript: '',
      visualDescription: '0-4 秒人物查看路牌，4-8 秒向路人展示手机。',
      ocrText: 'EXIT B',
      audioDescription: '',
      sceneSegmentsText:
        '能力与覆盖声明：收到去音轨完整视频画面，音频与 ASR 不可用；覆盖 0.0-8.0s，时间戳为近似值且无法精确量化误差。s1 查看路牌；s2 展示手机。核心暗线：【高概率暗线/隐喻】可见动作暗示信息理解发生变化；可复用的三个机制：【明确证据】路牌信息缺口、动作转折、手机道具揭示；仍待核验：【待核验/纯猜测】人物关系与手机界面的具体用途。',
    },
    sceneSegments: [
      {
        segmentId: 's1',
        timeRange: '0.0-4.0s',
        sceneFunctionGuess: 'hook',
        visual: {
          people: '一名旅客查看路牌',
          setting: '城市路口',
          productOrObject: '路牌和手机',
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
            fact: '【明确证据】旅客查看路牌',
            source: 'frame',
            confidence: 'medium',
          },
          {
            type: 'text',
            fact: '【明确证据】路牌显示 EXIT B',
            source: 'ocr',
            confidence: 'medium',
          },
        ],
      },
      {
        segmentId: 's2',
        timeRange: '4.0-8.0s',
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
        audio: { musicMood: '', sfx: [], voiceTone: '' },
        emotion: { viewerEmotionGuess: '温暖', characterEmotion: '释然' },
        evidence: [
          {
            type: 'visual',
            fact: '【明确证据】旅客展示手机界面',
            source: 'frame',
            confidence: 'medium',
          },
          {
            type: 'inference',
            fact: '【高概率暗线/隐喻】手机可能帮助双方理解信息；线索为先看路牌后展示手机，其他解释是普通内容展示',
            source: 'model_inference',
            confidence: 'low',
          },
        ],
      },
    ],
    globalUnderstanding: {
      topicGuess: '【高概率暗线/隐喻】旅途中使用手机解决信息理解困难',
      actionReasonGuess: {
        intendedAction: '继续完成出行',
        persuasionReason: '手机界面可能帮助双方理解信息',
      },
      persuasionStrategyGuess: ['human_experience', 'contrast'],
      localStyleSignals: {
        casting: '年轻旅客与路人',
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
        timeRange: '0.0-4.0s',
        literalEvent: '旅客查看写有 EXIT B 的路牌',
        visibleEvidenceRefs: ['MM01-E001'],
        textEvidenceRefs: ['MM01-E002'],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: [],
        certainty: 'medium',
      },
      {
        timeRange: '4.0-8.0s',
        literalEvent: '旅客向路人展示手机界面',
        visibleEvidenceRefs: ['MM01-E003'],
        textEvidenceRefs: [],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: ['MM01-E004'],
        certainty: 'medium',
      },
    ],
    narrativeMap: {
      who: '旅客与路人',
      where: '城市路口',
      initialSituation: '旅客查看出口路牌',
      problemOrDesire: '旅客想确认方向',
      escalation: '旅客展示手机界面给路人',
      turningPoint: '手机界面可能成为理解转折',
      outcome: '旅客继续出发',
      impliedMeaning: '旅行信息理解困难可能被手机界面缓解',
      audienceTakeaway: '陌生环境中可以借助手机降低沟通误会',
      unknowns: ['Kimi 模式无音频和 ASR'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003', 'MM01-E004'],
    },
    attentionMap: [
      {
        segmentId: 's1',
        timeRange: '0.0-4.0s',
        role: 'hook',
        importanceScore: 5,
        reason: '看见出口牌但仍困惑形成开场反差',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
        reuseType: 'keep_structure',
        risk: [],
      },
      {
        segmentId: 's2',
        timeRange: '4.0-8.0s',
        role: 'reveal',
        importanceScore: 4,
        reason: '展示手机界面形成可能的解决转折',
        evidenceRefs: ['MM01-E003', 'MM01-E004'],
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
        claim: '旅客因出口标识理解困难而展示手机界面求助',
        supportingEvidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
        contradictingEvidenceRefs: [],
        confidence: 'medium',
        reasoningLimits: '音频和 ASR 缺失，不能确认对白。',
      },
    ],
    crossModalChecks: {
      captionVsVideo: 'consistent',
      asrVsOcr: 'unknown',
      audioVsEmotion: 'unknown',
      notes: 'Kimi 模式缺少音频和 ASR。',
    },
    qualityFlags: {
      missingCriticalInfo: ['asr', 'audio'],
      needsHumanReview: true,
      reason: '模型协议未提供独立音频或 ASR 证据。',
    },
  }
}

function c01Fixture(): ContextResearchOutput {
  return {
    module: 'C01_CONTEXT_RESEARCH_PACK',
    targetNextPrompt: 'P02F',
    searchRequired: true,
    searchPerformed: true,
    searchProvider: 'test-search-model',
    contextPack: [
      {
        claim: 'EXIT B 常见于交通或场馆出口编号标识。',
        source: 'https://example.test/exit-b',
        sourceType: 'search',
        confidence: 'medium',
        appliesToVideo: 'supports_interpretation',
        boundary: '只能解释 EXIT B 标识，不能确认具体地点。',
        evidenceNeededInVideo: ['画面出现 EXIT B'],
      },
    ],
    interpretiveBridge: {
      videoFacts: ['MM01-E001', 'MM01-E003'],
      externalContext: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInference:
        'MM01-E001 + https://example.test/exit-b 共同支持旅客可能在确认出口方向时遇到理解困难。',
      uncertainty: 'Kimi 模式无音频和 ASR。',
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
    '一名旅客在陌生城市反复查看路牌，却仍无法确认出口方向。路人靠近后，他把手机界面递给对方查看，双方可能借此理解信息，随后继续向前出发。'
  return {
    theme: '旅行场景·信息理解误会',
    tags: ['旅行', '信息障碍', '路牌', '手机'],
    subtitleBody: '',
    sourceFactSummary: '旅客查看路牌后向路人展示手机，画面从困惑转向释然。',
    evidenceBeats: [
      { type: 'visual', fact: '【明确证据】旅客查看路牌', evidence: '[MM01-E001] 0.0-4.0s 画面' },
      { type: 'text', fact: '【明确证据】路牌显示 EXIT B', evidence: '[MM01-E002] 0.0-4.0s OCR' },
      { type: 'inference', fact: '【高概率暗线/隐喻】手机可能帮助双方理解信息；线索为先看路牌后展示手机，其他解释是普通内容展示', evidence: '[MM01-E004] 4.0-8.0s 合理推断' },
    ],
    keyMoments: [
      {
        timeRange: '0.0-4.0s',
        role: 'hook',
        fact: '旅客看见 EXIT B 路牌却仍显得困惑',
        whyImportant: '可见标识和人物困惑形成停手点',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
      },
      {
        timeRange: '4.0-8.0s',
        role: 'reveal',
        fact: '旅客向路人展示手机界面',
        whyImportant: '展示动作承担可能的解决转折',
        evidenceRefs: ['MM01-E003', 'MM01-E004'],
      },
    ],
    sourceVsContextBoundary: {
      videoFacts: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
      externalContextUsed: ['EXIT B 常见于交通或场馆出口编号标识。'],
      contextSupportedInferences: [
        'MM01-E001 + https://example.test/exit-b 共同支持旅客可能在确认出口方向时遇到理解困难。',
      ],
    },
    narrativeMechanics: {
      audienceReason: '观众会继续看，是因为可见标识和主角无法确认方向形成信息差。',
      narrativeEngine: '剧情靠信息障碍推进，展示手机的动作承担可能的解决转折。',
      payoffLogic: '展示手机后，前面的困惑获得可能解决，行动可以继续。',
      preservedSignals: ['可见标识与方向困惑', '展示手机求助', '从停滞到继续行动'],
      replaceableSurface: ['出口编号', '路口环境', '路牌样式'],
      forbiddenSurface: ['原人物脸', '原品牌界面', '原账号水印'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
    },
    riskRefs: [],
    uncertaintyNotes: '音轨和 ASR 缺失，因果只作为推断。',
    story,
    coreHook: '看见出口牌，却仍无法确认方向',
    storyCharCount: [...story.trim()].length,
    transcriptUsed: false,
    confidence: 'medium',
    notes: '音轨和 ASR 缺失，因果只作为推断。',
  }
}

function kimiResponse(
  output: unknown,
  finishReason = 'stop',
): Response {
  return new Response(
    JSON.stringify({
      model: 'kimi-reported-test-model',
      choices: [
        {
          finish_reason: finishReason,
          message: {
            reasoning_content: JSON.stringify({ ignored: true }),
            content: JSON.stringify(output),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        prompt_tokens_details: { cached_tokens: 2 },
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
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const config: KimiConfig = {
  apiKey: 'kimi-test-key',
  apiBaseUrl: 'https://api.moonshot.cn/v1',
  model: 'kimi-k3',
  timeoutMs: 5_000,
  reasoningEffort: 'max',
  allowedApiHosts: ['api.moonshot.cn'],
}

describe('Kimi K3 OpenAI-compatible multimodal adapter', () => {
  it('maps video and images, removes standalone audio, and uses strict JSON schema', () => {
    const projection = projectMediaForKimi(media)
    const body = buildKimiMm01Body(request, projection, config)
    const serialized = JSON.stringify(body)

    expect(projection.analysisMode).toBe('audio_frames')
    expect(ANALYSIS_MODE_CONFIDENCE_CAP[projection.analysisMode]).toBe('medium')
    expect(projection.availability).toEqual({ visual: true, audio: false, asr: false })
    expect(serialized).toContain('video_url')
    expect(serialized).toContain('data:video/mp4;base64,VIDEO_BASE64')
    expect(serialized).toContain('image_url')
    expect(serialized).not.toContain('AUDIO_BASE64')
    expect(serialized).toContain('实际音轨证据可用：false')
    expect(body.messages).toEqual([
      { role: 'system', content: MM01_SYSTEM_PROMPT },
      expect.objectContaining({ role: 'user' }),
    ])
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('n')
    expect(body).toMatchObject({
      model: 'kimi-k3',
      reasoning_effort: 'max',
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true },
      },
    })
  })

  it('runs Kimi MM01, required C01 search, then text-model P02 with a local P02F handoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(kimiResponse(mm01Fixture()))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))

    const result = await analyzeWithKimi(
      request,
      media,
      config,
      fetchMock as typeof fetch,
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.moonshot.cn/v1/chat/completions')
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      authorization: 'Bearer kimi-test-key',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      model: 'kimi-k3',
    })
    expect(String(fetchMock.mock.calls[1][0])).toContain('/responses')
    expect(String(fetchMock.mock.calls[2][0])).toContain('/responses')
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    const thirdBody = JSON.parse(String(fetchMock.mock.calls[2][1].body))
    expect(JSON.stringify(firstBody)).toContain('video_url')
    expect(JSON.stringify(thirdBody)).not.toContain('video_url')
    expect(JSON.stringify(thirdBody)).not.toContain('image_url')
    expect(JSON.stringify(thirdBody)).toContain('P02 confidence')
    expect(result.mm01.modalityStatus.audio).toBe('missing')
    expect(result.mm01.modalityStatus.asr).toBe('missing')
    expect(result.mm01.modalityStatus).toMatchObject({
      analysisMode: 'audio_frames',
      confidenceCap: 'medium',
    })
    expect(result.p02Handoff).toMatchObject({
      analysisMode: 'audio_frames',
      confidenceCap: 'medium',
    })
    expect(result.diagnostics).toMatchObject({
      provider: 'kimi',
      profile: 'kimi-k3',
      model: 'kimi-k3',
      modelCalls: 3,
      reportedModels: [
        { stage: 'mm01', model: 'kimi-reported-test-model' },
        { stage: 'c01', model: 'downstream-reported-test-model' },
        { stage: 'p02', model: 'downstream-reported-test-model' },
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 2,
      },
    })
    expect(() =>
      parseMultimodalAnalysisApiResponse({ analysis: result }),
    ).not.toThrow()
  })

  it('applies the same duration-aware MM01 gate before the Kimi P02 call', async () => {
    const longMedia: PreparedMedia = {
      ...media,
      durationSeconds: 130.8,
    }
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => kimiResponse(mm01Fixture()))

    await expect(
      analyzeWithKimi(request, longMedia, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({
      code: 'MM01_INSUFFICIENT_COVERAGE',
      evaluation: {
        status: 'blocked',
        durationSec: 130.8,
        coveredSec: 8,
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('removes an inline video whose embedded audio was not locally stripped', () => {
    const unverified = { ...media, audioTrackRemoved: false }
    const projection = projectMediaForKimi(unverified)
    const serialized = JSON.stringify(buildKimiMm01Body(request, projection, config))

    expect(projection.media.mode).toBe('video_frames')
    expect(projection.media.keyframeCount).toBe(1)
    expect(projection.analysisMode).toBe('audio_frames')
    expect(serialized).not.toContain('video_url')
    expect(serialized).toContain('image_url')
    expect(serialized).not.toContain('VIDEO_BASE64')
  })

  it('rejects truncated responses and unsupported audio claims', async () => {
    const truncated = vi.fn().mockResolvedValue(kimiResponse(mm01Fixture(), 'length'))
    await expect(
      analyzeWithKimi(request, media, config, truncated as typeof fetch),
    ).rejects.toMatchObject({ code: 'KIMI_INVALID_OUTPUT' })

    const hallucinated = mm01Fixture()
    hallucinated.modalityStatus.audio = 'ok'
    hallucinated.cleanedInputsForP02.audioDescription = '模型声称听到音乐'
    hallucinated.sceneSegments[0].audio.musicMood = '轻快'
    hallucinated.qualityFlags.missingCriticalInfo = ['asr']
    const audioClaim = vi.fn().mockResolvedValue(kimiResponse(hallucinated))
    await expect(
      analyzeWithKimi(request, media, config, audioClaim as typeof fetch),
    ).rejects.toMatchObject({ code: 'KIMI_INVALID_OUTPUT' })
    expect(audioClaim).toHaveBeenCalledTimes(3)
  })

  it('rejects P02 audio evidence when MM01 marked audio missing', async () => {
    const p02WithAudio = p02Fixture()
    p02WithAudio.evidenceBeats[2] = {
      type: 'audio',
      fact: '出现提示音',
      evidence: '模型臆测的音轨',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(kimiResponse(mm01Fixture()))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02WithAudio))
      .mockResolvedValueOnce(responsesResponse(p02WithAudio))

    await expect(
      analyzeWithKimi(request, media, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'DOWNSTREAM_INVALID_OUTPUT' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('skips before any model call when no visual evidence survived preparation', async () => {
    const audioOnly: PreparedMedia = {
      parts: [{ inlineData: { mimeType: 'audio/mpeg', data: 'AUDIO_ONLY' } }],
      mode: 'video_audio',
      keyframeCount: 0,
      warnings: [],
      cleanup: async () => undefined,
    }
    const fetchMock = vi.fn()
    await expect(
      analyzeWithKimi(request, audioOnly, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'KIMI_UNSUPPORTED_MEDIA' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Kimi configuration security', () => {
  it('requires HTTPS and an exact allowlisted gateway host', () => {
    expect(() => validateKimiApiBaseUrl('http://api.moonshot.cn/v1')).toThrow(
      /HTTPS/,
    )
    expect(() => validateKimiApiBaseUrl('https://proxy.example.com/v1')).toThrow(
      /allowlist/,
    )
    expect(
      validateKimiApiBaseUrl('https://api.moonshot.cn/v1/', ['api.moonshot.cn']),
    ).toBe('https://api.moonshot.cn/v1')
    expect(validateKimiApiBaseUrl('https://api.moonshot.cn')).toBe(
      'https://api.moonshot.cn/v1',
    )
  })

  it('accepts only the dedicated per-request Kimi key', () => {
    expect(
      kimiConfigForRequest(
        {
          headers: {
            'x-intent-kimi-key': 'session-kimi-key',
            'x-intent-gemini-key': 'must-not-be-reused',
          },
        },
        {
          KIMI_API_KEY: 'server-key',
          KIMI_API_BASE_URL: 'https://api.moonshot.cn/v1',
          KIMI_API_ALLOWED_HOSTS: 'api.moonshot.cn',
        },
      ).apiKey,
    ).toBe('session-kimi-key')

    expect(
      kimiConfigForRequest(
        { headers: { 'x-intent-kimi-key': 'x'.repeat(513) } },
        {
          KIMI_API_KEY: 'server-key',
          KIMI_API_BASE_URL: 'https://api.moonshot.cn/v1',
        },
      ).apiKey,
    ).toBe('server-key')
  })

  it('rejects unsafe URL decorations, wildcard hosts, and oversized requests', async () => {
    expect(() =>
      validateKimiApiBaseUrl('https://user:pass@api.moonshot.cn/v1'),
    ).toThrow(/账号/)
    expect(() =>
      validateKimiApiBaseUrl('https://api.moonshot.cn/v1?target=other'),
    ).toThrow(/查询参数/)
    expect(() =>
      kimiConfigForRequest(
        { headers: {} },
        { KIMI_API_ALLOWED_HOSTS: '*.example.com' },
      ),
    ).toThrow(/通配符/)

    const fetchMock = vi.fn()
    await expect(
      analyzeWithKimi(
        request,
        media,
        { ...config, maxRequestBytes: 1 },
        fetchMock as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: 'KIMI_REQUEST_TOO_LARGE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps blocked and timeout failures without exposing upstream payloads', async () => {
    const blocked = vi.fn().mockResolvedValue(kimiResponse(mm01Fixture(), 'content_filter'))
    await expect(
      analyzeWithKimi(request, media, config, blocked as typeof fetch),
    ).rejects.toMatchObject({ code: 'KIMI_BLOCKED' })

    const timeout = vi.fn().mockRejectedValue(new Error('AbortError: timed out'))
    await expect(
      analyzeWithKimi(request, media, config, timeout as typeof fetch),
    ).rejects.toMatchObject({ code: 'KIMI_TIMEOUT' })
  })
})
