import { describe, expect, it, vi } from 'vitest'
import {
  compileP02FormattedPrompt,
  type ContextResearchOutput,
  type Mm01AnalysisPack,
  type P02Breakdown,
} from '../../src/contracts/multimodalAnalysis.ts'
import { MM01_SYSTEM_PROMPT } from '../../src/prompts/mm01SystemPrompt.ts'
import {
  analyzeWithGemini,
  analysisModeForPreparedMedia,
  buildMm01GenerateContentBody,
  buildP02GenerateContentBody,
  geminiConfigForRequest,
  geminiConfigFromEnv,
  MM01_RESPONSE_SCHEMA,
  parseGeminiJsonCandidates,
  parseGeminiJsonText,
  parseGeminiAuthMode,
  validateGeminiApiBaseUrl,
  type GeminiConfig,
  type MultimodalSourceRequest,
} from './gemini.ts'
import type { PreparedMedia } from './media.ts'

const request: MultimodalSourceRequest = {
  sourceUrl: 'https://www.tiktok.com/@creator/video/1',
  mediaUrl: 'https://signed.example/video.mp4?token=private',
  mediaKind: 'video',
  platform: 'tiktok',
  marketId: 'id',
  marketLanguages: ['id', 'en'],
  title: '旅途中看不懂提示牌',
  caption: '陌生城市里的沟通误会',
  providerTranscript: '',
  durationSeconds: 8,
}

const media: PreparedMedia = {
  // Deliberately put the keyframe first; the request builder must restore the
  // whole-video -> timestamped-frame -> text order.
  parts: [
    { text: '关键帧时间：2.00 秒' },
    { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_BASE64' } },
    { inlineData: { mimeType: 'video/mp4', data: 'VIDEO_BASE64' } },
  ],
  mode: 'video_inline_keyframes',
  keyframeCount: 1,
  durationSeconds: 8,
  sourceAudioTrack: 'present',
  audioInputProvenance: 'inline_video',
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
      sourceUrl: 'model-must-not-control-this',
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
      audio: 'ok',
      analysisMode: 'compressed_video',
      confidenceCap: 'medium',
    },
    cleanedInputsForP02: {
      transcriptStatus: 'missing',
      rawTranscript: '',
      visualDescription: '0-3 秒人物看向路牌，3-8 秒向路人展示手机。',
      ocrText: 'EXIT B',
      audioDescription: '轻快音乐，转折处有提示音。',
      sceneSegmentsText:
        '能力与覆盖声明：收到完整视频及原音轨，ASR 不可用；覆盖 0.0-8.0s，时间戳为近似值且无法精确量化误差。s1 路牌困惑；s2 手机界面带来转折。核心暗线：【高概率暗线/隐喻】视觉信息差由手机展示动作缓解；可复用的三个机制：【明确证据】路牌信息缺口、动作转折、道具揭示；仍待核验：【待核验/纯猜测】人物关系和具体地域文化语境。',
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
        asr: { speech: '', language: 'unknown', speakerGuess: 'unknown' },
        audio: { musicMood: '轻快', sfx: [], voiceTone: 'unknown' },
        emotion: { viewerEmotionGuess: '好奇', characterEmotion: '困惑' },
        evidence: [
          {
            type: 'visual',
            fact: '【明确证据】旅客皱眉查看路牌',
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
        timeRange: '3.0-8.0s',
        sceneFunctionGuess: 'reveal',
        visual: {
          people: '一名旅客把手机展示给路人',
          setting: '城市路口',
          productOrObject: '手机翻译界面',
          camera: '中景推近',
          style: '暖色纪实',
        },
        ocr: { texts: [], textRoleGuess: 'unknown' },
        asr: { speech: '', language: 'unknown', speakerGuess: 'unknown' },
        audio: { musicMood: '轻快', sfx: ['提示音'], voiceTone: 'unknown' },
        emotion: { viewerEmotionGuess: '温暖', characterEmotion: '释然' },
        evidence: [
          {
            type: 'visual',
            fact: '【明确证据】旅客向路人展示手机界面',
            source: 'frame',
            confidence: 'medium',
          },
          {
            type: 'audio',
            fact: '【明确证据】转折处出现提示音',
            source: 'audio',
            confidence: 'medium',
          },
        ],
      },
    ],
    globalUnderstanding: {
      topicGuess: '【高概率暗线/隐喻】旅途中通过手机解决信息理解困难',
      actionReasonGuess: {
        intendedAction: '继续完成出行',
        persuasionReason: '手机界面帮助双方理解信息',
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
        literalEvent: '旅客皱眉查看 EXIT B 路牌',
        visibleEvidenceRefs: ['MM01-E001'],
        textEvidenceRefs: ['MM01-E002'],
        speechEvidenceRefs: [],
        audioEvidenceRefs: [],
        inferenceEvidenceRefs: [],
        certainty: 'medium',
      },
      {
        timeRange: '3.0-8.0s',
        literalEvent: '旅客向路人展示手机界面，转折处出现提示音',
        visibleEvidenceRefs: ['MM01-E003'],
        textEvidenceRefs: [],
        speechEvidenceRefs: [],
        audioEvidenceRefs: ['MM01-E004'],
        inferenceEvidenceRefs: [],
        certainty: 'medium',
      },
    ],
    narrativeMap: {
      who: '一名旅客与路人',
      where: '城市路口',
      initialSituation: '旅客查看出口路牌',
      problemOrDesire: '旅客想确认出口方向',
      escalation: '旅客向路人展示手机界面',
      turningPoint: '手机界面带来理解转折',
      outcome: '旅客情绪转为释然',
      impliedMeaning: '旅行信息理解困难被手机界面缓解',
      audienceTakeaway: '陌生城市中的沟通误会被一个工具动作化解',
      unknowns: ['无 ASR，无法确认对白'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003', 'MM01-E004'],
    },
    attentionMap: [
      {
        segmentId: 's1',
        timeRange: '0.0-3.0s',
        role: 'hook',
        importanceScore: 5,
        reason: '看见出口牌却仍困惑形成停手点',
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
        claim: '旅客因出口标识理解困难而向路人展示手机求助',
        supportingEvidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
        contradictingEvidenceRefs: [],
        confidence: 'medium',
        reasoningLimits: '无 ASR，无法确认对白。',
      },
    ],
    crossModalChecks: {
      captionVsVideo: 'consistent',
      asrVsOcr: 'unknown',
      audioVsEmotion: 'consistent',
      notes: '缺少 ASR。',
    },
    qualityFlags: {
      missingCriticalInfo: ['asr'],
      needsHumanReview: true,
      reason: '无 ASR，不能确认人物是否说话。',
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
      uncertainty: '无 ASR，无法确认对白。',
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
    '一名旅客在陌生城市反复查看路牌，却仍无法确认出口方向。路人靠近后，他把手机界面递给对方查看，双方终于理解彼此的意思，紧张的寻找过程转为轻松的继续出发。'
  return {
    theme: '旅行场景·信息理解误会',
    tags: ['旅行', '语言障碍', '误会', '反转'],
    subtitleBody: '',
    sourceFactSummary: '旅客在路口查看路牌并向路人展示手机，随后情绪由困惑转为释然。',
    evidenceBeats: [
      { type: 'visual', fact: '【明确证据】旅客皱眉查看路牌', evidence: '[MM01-E001] 0.0-3.0s 画面' },
      { type: 'text', fact: '【明确证据】路牌显示 EXIT B', evidence: '[MM01-E002] 0.0-3.0s OCR' },
      { type: 'audio', fact: '【明确证据】转折处出现提示音', evidence: '[MM01-E004] 3.0-8.0s 音轨' },
    ],
    keyMoments: [
      {
        timeRange: '0.0-3.0s',
        role: 'hook',
        fact: '旅客看见 EXIT B 路牌却仍显得困惑',
        whyImportant: '开场用可见标识和困惑表情形成反差',
        evidenceRefs: ['MM01-E001', 'MM01-E002'],
      },
      {
        timeRange: '3.0-8.0s',
        role: 'reveal',
        fact: '旅客展示手机界面后情绪转为释然',
        whyImportant: '这一动作承担理解转折',
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
      audienceReason: '观众会继续看，是因为可见出口牌和主角困惑之间形成反差。',
      narrativeEngine: '剧情靠信息差推进，手机展示动作承担从困惑到理解的转折。',
      payoffLogic: '手机界面被展示后，前面的方向困惑得到解释，情绪完成释放。',
      preservedSignals: ['路牌与困惑反差', '手机展示动作', '情绪由困惑转释然'],
      replaceableSurface: ['出口编号', '城市路口', '路牌样式'],
      forbiddenSurface: ['原人物脸', '原品牌界面', '原账号水印'],
      evidenceRefs: ['MM01-E001', 'MM01-E002', 'MM01-E003'],
    },
    riskRefs: [],
    uncertaintyNotes: '无 ASR，无法确认对白。',
    story,
    coreHook: '看见出口牌，却还是找不到出口',
    storyCharCount: [...story.trim()].length,
    transcriptUsed: false,
    confidence: 'medium',
    notes: '无可用字幕，故事中的因果关系含合理推断。',
  }
}

function geminiResponse(output: unknown): Response {
  return new Response(
    JSON.stringify({
      modelVersion: 'gemini-reported-test-model',
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'internal reasoning' },
              { text: JSON.stringify(output) },
            ],
          },
        },
      ],
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

const config: GeminiConfig = {
  apiKey: 'secret-test-key',
  apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-3.1-pro-preview-thinking',
  videoFps: 3.5,
  mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
  timeoutMs: 5_000,
}

describe('MM01 -> C01 -> P02F -> P02 Gemini service', () => {
  it('accepts one schema-bound JSON object wrapped by a gateway', () => {
    expect(parseGeminiJsonText('```json\n{"ok":true}\n```')).toEqual({
      ok: true,
    })
    expect(parseGeminiJsonText('**Structured result**\n{"ok":true}')).toEqual({
      ok: true,
    })
    expect(() =>
      parseGeminiJsonText('result: {"ok":true}\nextra: {"no":false}'),
    ).toThrow(
      /invalid JSON/,
    )
    expect(
      parseGeminiJsonCandidates(
        'draft: {"scratch":true}\nfinal: {"ok":true}',
      ),
    ).toEqual([{ ok: true }, { scratch: true }])
    expect(
      parseGeminiJsonCandidates(
        'broken: {"unfinished": true\nfinal: {"ok":"brace \\"{x}\\""}',
      ),
    ).toEqual([{ ok: 'brace "{x}"' }])
  })

  it('selects the sole contract-valid answer from gateway analysis and draft objects', async () => {
    const wrappedResponse = (output: unknown, splitParts = false) =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: JSON.stringify(output) },
                  ...(splitParts
                    ? [
                        { text: 'analysis draft: {"scratch":true}' },
                        { text: JSON.stringify(output) },
                      ]
                    : [
                        {
                          text: `analysis draft: {"scratch":true}\nfinal: ${JSON.stringify(output)}`,
                        },
                      ]),
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(wrappedResponse(mm01Fixture(), true))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))

    const result = await analyzeWithGemini(
      request,
      media,
      config,
      fetchMock as typeof fetch,
    )

    expect(result.mm01.module).toBe('MM01_MULTIMODAL_ANALYSIS_PACK')
    expect(result.p02.theme).toBe(p02Fixture().theme)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects two different contract-valid final answers as ambiguous', async () => {
    const second = {
      ...mm01Fixture(),
      cleanedInputsForP02: {
        ...mm01Fixture().cleanedInputsForP02,
        visualDescription: '另一份完整且不同的视觉描述。',
      },
    }
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: `${JSON.stringify(mm01Fixture())}\n${JSON.stringify(second)}`,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      analyzeWithGemini(request, media, config, fetchMock as typeof fetch),
    ).rejects.toThrow(/ambiguous/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('requires the model itself to return every MM01 contract group', async () => {
    const incomplete = { ...mm01Fixture() } as Record<string, unknown>
    delete incomplete.sourceMeta
    const fetchMock = vi.fn().mockImplementation(async () => geminiResponse(incomplete))

    await expect(
      analyzeWithGemini(request, media, config, fetchMock as typeof fetch),
    ).rejects.toThrow(/sourceMeta/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('blocks before the model when a source video audio track was not preserved', async () => {
    const framesOnly: PreparedMedia = {
      parts: [
        { text: '关键帧时间：2.00 秒' },
        { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_BASE64' } },
      ],
      mode: 'video_frames',
      keyframeCount: 1,
      durationSeconds: 8,
      sourceAudioTrack: 'present',
      audioInputProvenance: 'none',
      warnings: ['完整视频不可用，已降级为关键帧。'],
      cleanup: async () => undefined,
    }
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => geminiResponse(mm01Fixture()))

    await expect(
      analyzeWithGemini(request, framesOnly, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({
      code: 'MM01_AUDIO_EVIDENCE_MISSING',
      failure: 'audio_input_missing',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks an inline video whose known source audio track could not be verified', async () => {
    const unverifiedInline: PreparedMedia = {
      ...media,
      audioInputProvenance: 'unknown',
      warnings: ['源音轨存在，但最终 inline 音轨无法验证。'],
    }
    const fetchMock = vi.fn()

    await expect(
      analyzeWithGemini(request, unverifiedInline, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({
      code: 'MM01_AUDIO_EVIDENCE_MISSING',
      failure: 'audio_input_missing',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows a verified silent source but still rejects invented audio claims', async () => {
    const verifiedSilent: PreparedMedia = {
      parts: [
        { text: '关键帧时间：2.00 秒' },
        { inlineData: { mimeType: 'image/jpeg', data: 'FRAME_BASE64' } },
      ],
      mode: 'video_frames',
      keyframeCount: 1,
      durationSeconds: 8,
      sourceAudioTrack: 'absent',
      audioInputProvenance: 'none',
      warnings: ['已确认源视频没有音轨。'],
      cleanup: async () => undefined,
    }
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => geminiResponse(mm01Fixture()))

    await expect(
      analyzeWithGemini(request, verifiedSilent, config, fetchMock as typeof fetch),
    ).rejects.toThrow(/audio unavailable/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops before P02 when Gemini received audio but did not analyze it', async () => {
    const missingAudio = structuredClone(mm01Fixture())
    missingAudio.modalityStatus.audio = 'missing'
    missingAudio.cleanedInputsForP02.audioDescription = ''
    missingAudio.qualityFlags.missingCriticalInfo = ['asr', 'audio']
    for (const segment of missingAudio.sceneSegments) {
      segment.audio = { musicMood: '', sfx: [], voiceTone: '' }
      segment.evidence = segment.evidence.filter(
        (evidence) => evidence.type !== 'audio' && evidence.source !== 'audio',
      )
    }
    missingAudio.eventTimeline[1].audioEvidenceRefs = []
    missingAudio.narrativeMap.evidenceRefs = ['MM01-E001', 'MM01-E002', 'MM01-E003']
    missingAudio.attentionMap[1].evidenceRefs = ['MM01-E003']
    missingAudio.crossModalChecks.audioVsEmotion = 'unknown'
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => geminiResponse(missingAudio))

    await expect(
      analyzeWithGemini(request, media, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({
      code: 'MM01_AUDIO_EVIDENCE_MISSING',
      failure: 'audio_analysis_missing',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not accept unknown placeholders as completed audio analysis', async () => {
    const placeholderAudio = structuredClone(mm01Fixture())
    placeholderAudio.cleanedInputsForP02.audioDescription = 'unknown'
    placeholderAudio.qualityFlags.missingCriticalInfo = ['asr']
    for (const segment of placeholderAudio.sceneSegments) {
      segment.audio = { musicMood: 'unknown', sfx: [], voiceTone: 'unknown' }
      segment.evidence = segment.evidence.filter(
        (evidence) => evidence.type !== 'audio' && evidence.source !== 'audio',
      )
    }
    placeholderAudio.sceneSegments[1].evidence.push({
      type: 'audio',
      source: 'audio',
      confidence: 'medium',
      fact: '【明确证据】无法确认音频内容',
    })
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => geminiResponse(placeholderAudio))

    await expect(
      analyzeWithGemini(request, media, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({
      code: 'MM01_AUDIO_EVIDENCE_MISSING',
      failure: 'audio_analysis_missing',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('sends the MM01 brief, whole media, timestamped frames and final context in one ordered request', () => {
    const seedCandidate =
      '融合候选线索：Seed 认为 2 秒处可能出现路牌，请以原媒体独立核对。'
    const repairInstruction = 'REPAIR_ONCE_MARKER'
    const body = buildMm01GenerateContentBody(
      request,
      media,
      seedCandidate,
      {},
      repairInstruction,
    ) as {
      systemInstruction: { parts: Array<{ text: string }> }
      contents: Array<{ parts: Array<Record<string, unknown>> }>
      generationConfig: Record<string, unknown>
    }
    const parts = body.contents[0].parts
    expect(body.systemInstruction.parts).toEqual([
      { text: MM01_SYSTEM_PROMPT },
    ])
    expect(parts[0]).toMatchObject({
      inlineData: { mimeType: 'video/mp4' },
      videoMetadata: { fps: 2 },
    })
    expect(parts[1]).toEqual({ text: '关键帧时间：2.00 秒' })
    expect(parts[2]).toMatchObject({
      inlineData: { mimeType: 'image/jpeg' },
    })
    expect(parts[3]).toEqual({ text: seedCandidate })
    expect(parts[4]).toMatchObject({
      text: expect.stringContaining('内部媒体模式：video_inline_keyframes'),
    })
    expect(parts[4]).toMatchObject({
      text: expect.stringContaining(
        '服务端强制逐窗检查：0.0-4.0s、4.0-8.0s',
      ),
    })
    expect(parts.at(-1)).toEqual({ text: repairInstruction })
    expect(
      parts.filter((part) => part.text === repairInstruction),
    ).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain(request.mediaUrl)
    expect(JSON.stringify(body)).not.toContain(request.sourceUrl)
    expect(body.generationConfig).toMatchObject({
      temperature: 1,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
    })

    const properties = MM01_RESPONSE_SCHEMA.properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('story')
    expect(properties).not.toHaveProperty('coreHook')
    expect(properties).not.toHaveProperty('rewriteDirections')
  })

  it('maps the human MM01 research brief into the existing JSON contract', () => {
    for (const requirement of [
      'AI Creative Workflow · Creative Workflow 的 MM01 多模态视频分析师',
      '能力与覆盖声明',
      '【明确证据】',
      '【高概率暗线/隐喻】',
      '【待核验/纯猜测】',
      '常识合理性校验',
      '声画关系',
      '前 1-3 秒',
      're-hook',
      '文化信号、隐喻、隐藏笑点和潜规则',
      '核心暗线：',
      '可复用的三个机制',
      '仍待核验：',
      'audio.voiceTone 必须是空字符串',
      '不得植入任何产品',
      '只返回一个严格符合响应 Schema 的 JSON 值',
    ]) {
      expect(MM01_SYSTEM_PROMPT).toContain(requirement)
    }

    const properties = MM01_RESPONSE_SCHEMA.properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('humanReadableReport')
    expect(properties).not.toHaveProperty('creativeScript')
  })

  it('runs MM01, C01 and P02 sequentially and compiles P02F locally', async () => {
    const mm01 = mm01Fixture()
    mm01.globalUnderstanding.topicGuess = '旅途中通过手机解决信息理解困难'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse(mm01))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))

    const result = await analyzeWithGemini(
      request,
      media,
      config,
      fetchMock as typeof fetch,
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      encodeURIComponent(config.model),
    )
    expect(String(fetchMock.mock.calls[1][0])).toContain('/responses')
    expect(String(fetchMock.mock.calls[2][0])).toContain('/responses')
    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    ) as Record<string, unknown>
    const secondBody = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    ) as Record<string, unknown>
    const thirdBody = JSON.parse(
      String(fetchMock.mock.calls[2][1]?.body),
    ) as Record<string, unknown>
    expect(JSON.stringify(firstBody)).toContain('VIDEO_BASE64')
    expect(JSON.stringify(secondBody)).not.toContain('inlineData')
    expect(JSON.stringify(secondBody)).toContain('C01_CONTEXT_RESEARCH_PACK')
    expect(JSON.stringify(thirdBody)).not.toContain('inlineData')
    expect(JSON.stringify(thirdBody)).toContain('P02 confidence')
    const firstParts = (
      firstBody.contents as Array<{ parts: Array<Record<string, unknown>> }>
    )[0].parts
    expect(firstParts[0]).toMatchObject({
      inlineData: { mimeType: 'video/mp4' },
      videoMetadata: { fps: 3.5 },
    })
    expect(firstBody.generationConfig).toMatchObject({
      mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    })

    expect(result.mm01.sourceMeta).toEqual({
      platform: 'tiktok',
      sourceUrl: request.sourceUrl,
      marketId: 'id',
      marketLanguages: ['id', 'en'],
      title: request.title,
      caption: request.caption,
      durationSec: 8,
    })
    expect(result.mm01.modalityStatus.analysisMode).toBe('full_video')
    expect(result.mm01.modalityStatus.confidenceCap).toBe('high')
    expect(result.mm01.globalUnderstanding.topicGuess).toBe(
      '【高概率暗线/隐喻】旅途中通过手机解决信息理解困难',
    )
    expect(result.p02Handoff).toEqual(
      compileP02FormattedPrompt(result.mm01, result.contextResearch),
    )
    expect(result.diagnostics).toMatchObject({
      provider: 'gemini',
      profile: 'gemini',
      model: config.model,
      mediaMode: 'video_inline_keyframes',
      modelCalls: 3,
      keyframeCount: 1,
      geminiVideoFps: 3.5,
      geminiMediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
      reportedModels: [
        { stage: 'mm01', model: 'gemini-reported-test-model' },
        { stage: 'c01', model: 'downstream-reported-test-model' },
        { stage: 'p02', model: 'downstream-reported-test-model' },
      ],
    })
  })

  it('stops before P02 when MM01 direct evidence covers too little of a long video', async () => {
    const longMedia: PreparedMedia = {
      ...media,
      durationSeconds: 130.8,
    }
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => geminiResponse(mm01Fixture()))

    await expect(
      analyzeWithGemini(request, longMedia, config, fetchMock as typeof fetch),
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

  it('does not treat client/provider duration metadata as authoritative coverage', async () => {
    const unprobedMedia: PreparedMedia = {
      ...media,
      durationSeconds: undefined,
    }
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => geminiResponse(mm01Fixture()))

    await expect(
      analyzeWithGemini(request, unprobedMedia, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({
      code: 'MM01_INSUFFICIENT_COVERAGE',
      evaluation: {
        status: 'blocked',
        durationSec: 0,
        reasonCodes: expect.arrayContaining(['duration_unavailable']),
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uses the same Bearer credential on both native Gemini gateway calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse(mm01Fixture()))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))
    await analyzeWithGemini(
      request,
      media,
      {
        ...config,
        apiKey: 'test-key',
        apiBaseUrl: 'https://proxy.example.com/v1beta',
        authMode: 'bearer',
        allowedApiHosts: ['proxy.example.com'],
      },
      fetchMock as typeof fetch,
    )
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
        authorization: 'Bearer test-key',
    })
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error')
  })

  it('rejects invalid P02 after one same-model repair attempt', async () => {
    const invalid = { ...p02Fixture(), tags: ['too-few'] }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse(mm01Fixture()))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(invalid))
      .mockResolvedValueOnce(responsesResponse(invalid))
    await expect(
      analyzeWithGemini(request, media, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ code: 'DOWNSTREAM_INVALID_OUTPUT' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('counts a successful downstream repair as an additional model call', async () => {
    const invalid = { ...p02Fixture(), tags: ['too-few'] }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiResponse(mm01Fixture()))
      .mockResolvedValueOnce(responsesResponse(c01Fixture()))
      .mockResolvedValueOnce(responsesResponse(invalid))
      .mockResolvedValueOnce(responsesResponse(p02Fixture()))

    const result = await analyzeWithGemini(
      request,
      media,
      config,
      fetchMock as typeof fetch,
    )

    expect(result.diagnostics.modelCalls).toBe(4)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('maps prepared media modes to deterministic confidence modes', () => {
    expect(analysisModeForPreparedMedia(media)).toBe('full_video')
    expect(
      analysisModeForPreparedMedia({
        ...media,
        warnings: ['视频转码后进入 inline'],
      }),
    ).toBe('compressed_video')
    expect(
      analysisModeForPreparedMedia({ ...media, mode: 'video_frames_audio' }),
    ).toBe('audio_frames')
    expect(
      analysisModeForPreparedMedia({ ...media, mode: 'text_only' }),
    ).toBe('text_fallback')
  })

  it('builds the P02 request from deterministic text only', () => {
    const authoritative = {
      ...mm01Fixture(),
      sourceMeta: {
        ...mm01Fixture().sourceMeta,
        sourceUrl: request.sourceUrl ?? '',
        durationSec: 8,
      },
      modalityStatus: {
        ...mm01Fixture().modalityStatus,
        analysisMode: 'compressed_video' as const,
        confidenceCap: 'medium' as const,
      },
    }
    const handoff = compileP02FormattedPrompt(authoritative, c01Fixture())
    const body = buildP02GenerateContentBody(handoff) as {
      contents: Array<{ parts: Array<{ text: string }> }>
    }
    expect(body.contents[0].parts).toEqual([
      { text: handoff.p02FormattedPrompt },
    ])
    expect(JSON.stringify(body)).not.toContain('inlineData')
  })
})

describe('Gemini configuration security', () => {
  it('allows only HTTPS Google API by default and exact explicit hosts', () => {
    expect(() =>
      validateGeminiApiBaseUrl('http://generativelanguage.googleapis.com/v1beta'),
    ).toThrow(/HTTPS/)
    expect(() =>
      validateGeminiApiBaseUrl('https://metadata.google.internal/v1beta'),
    ).toThrow(/allowlist/)
    expect(() =>
      validateGeminiApiBaseUrl('https://proxy.example.com/v1beta', [
        '*.example.com',
      ]),
    ).toThrow(/通配符/)
    expect(
      validateGeminiApiBaseUrl('https://proxy.example.com/v1beta/', [
        'proxy.example.com',
      ]),
    ).toBe('https://proxy.example.com/v1beta')
  })

  it('loads an explicitly allowlisted bearer gateway and the default model', () => {
    const gateway = geminiConfigFromEnv({
      GEMINI_API_BASE_URL: 'https://api.moonshot.cn/v1beta',
      GEMINI_API_ALLOWED_HOSTS: 'api.moonshot.cn',
      GEMINI_API_AUTH_MODE: 'bearer',
    })
    expect(gateway).toMatchObject({
      apiBaseUrl: 'https://api.moonshot.cn/v1beta',
      authMode: 'bearer',
      model: 'gemini-3.1-pro-preview-thinking',
      videoFps: 2,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
    })
    expect(parseGeminiAuthMode()).toBe('google-api-key')
    expect(() => parseGeminiAuthMode('basic')).toThrow(/AUTH_MODE/)
    expect(() => geminiConfigFromEnv({ GEMINI_VIDEO_FPS: '25' })).toThrow(
      /GEMINI_VIDEO_FPS/,
    )
    expect(() =>
      geminiConfigFromEnv({ GEMINI_MEDIA_RESOLUTION: 'ultra' }),
    ).toThrow(/GEMINI_MEDIA_RESOLUTION/)
    expect(
      geminiConfigFromEnv({
        GEMINI_VIDEO_FPS: '3.5',
        GEMINI_MEDIA_RESOLUTION: 'MEDIA_RESOLUTION_MEDIUM',
      }),
    ).toMatchObject({
      videoFps: 3.5,
      mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    })
  })

  it('uses a bounded request-only key without mutating the environment config', () => {
    const env = { GEMINI_API_KEY: 'server-key' }
    expect(
      geminiConfigForRequest(
        { headers: { 'x-intent-gemini-key': 'session-key' } },
        env,
      ).apiKey,
    ).toBe('session-key')
    expect(geminiConfigFromEnv(env).apiKey).toBe('server-key')
    expect(
      geminiConfigForRequest(
        { headers: { 'x-intent-gemini-key': 'x'.repeat(513) } },
        env,
      ).apiKey,
    ).toBe('server-key')
  })

  it('never includes upstream response text or a key in thrown failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'upstream-secret-debug-body' } }),
        { status: 500 },
      ),
    )
    let message = ''
    try {
      await analyzeWithGemini(request, media, config, fetchMock as typeof fetch)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toContain('upstream-secret-debug-body')
    expect(message).not.toContain(config.apiKey)
  })
})
