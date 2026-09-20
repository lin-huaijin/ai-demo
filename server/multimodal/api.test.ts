import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MultimodalAnalysisBundle } from '../../src/contracts/multimodalAnalysis.ts'
import {
  analyzeSourceRequest,
  multimodalStatus,
  parseAnalysisRequest,
} from './api.ts'
import type { analyzeWithGemini, GeminiConfig } from './gemini.ts'
import { KimiServiceError } from './kimi.ts'
import { SeedServiceError } from './seed.ts'
import { Mm01CoverageError } from './modelCore.ts'
import type { MultimodalRuntime } from './profiles.ts'

afterEach(() => vi.unstubAllEnvs())

const config: GeminiConfig = {
  apiKey: 'test-key',
  apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-3.1-pro-preview-thinking',
  timeoutMs: 1_000,
}

const analysis = {
  mm01: {
    module: 'MM01_MULTIMODAL_ANALYSIS_PACK',
    targetNextPrompt: 'C01',
  },
  contextResearch: {
    module: 'C01_CONTEXT_RESEARCH_PACK',
    targetNextPrompt: 'P02F',
  },
  p02Handoff: {
    module: 'P02_FORMATTED_PROMPT_COMPILER',
    targetNextPrompt: 'P02',
  },
  p02: { theme: 'test' },
  diagnostics: {
    provider: 'gemini',
    profile: 'gemini',
    model: config.model,
    mediaMode: 'text_only',
    elapsedMs: 2,
    modelCalls: 3,
    keyframeCount: 0,
  },
} as unknown as MultimodalAnalysisBundle

describe('multimodal API request contract', () => {
  it('parses all explicit URL/media/source fields', () => {
    const parsed = parseAnalysisRequest({
      mediaKind: 'mixed',
      sourceUrl: 'https://www.tiktok.com/@a/video/1',
      mediaUrl: 'https://cdn.example/primary.mp4?token=short-lived',
      mediaUrls: ['https://cdn.example/primary.mp4'],
      videoUrls: ['https://cdn.example/primary.mp4'],
      imageUrls: ['https://cdn.example/still.jpg'],
      platform: 'tiktok',
      marketId: 'id',
      marketLanguages: ['id', 'en'],
      title: 'title',
      caption: 'caption',
      providerTranscript: 'candidate transcript',
      durationSeconds: 9.5,
    })
    expect(parsed).toMatchObject({
      mediaKind: 'mixed',
      platform: 'tiktok',
      marketId: 'id',
      marketLanguages: ['id', 'en'],
      durationSeconds: 9.5,
      videoUrls: ['https://cdn.example/primary.mp4'],
      imageUrls: ['https://cdn.example/still.jpg'],
    })
  })

  it('rejects unsafe, credential-bearing and malformed URL fields', () => {
    expect(() =>
      parseAnalysisRequest({ mediaKind: 'video', mediaUrl: 'file:///etc/passwd' }),
    ).toThrow(/HTTP/)
    expect(() =>
      parseAnalysisRequest({
        mediaKind: 'video',
        mediaUrl: 'https://user:password@cdn.example/video.mp4',
      }),
    ).toThrow(/账号/)
    expect(() =>
      parseAnalysisRequest({ mediaKind: 'video', mediaUrl: 'not-a-url' }),
    ).toThrow(/URL/)
    expect(() =>
      parseAnalysisRequest({ mediaKind: 'pdf', title: 'x' }),
    ).toThrow(/mediaKind/)
  })

  it('does not prepare media or call Gemini when no key is configured', async () => {
    const prepare = vi.fn()
    const analyze = vi.fn()
    const result = await analyzeSourceRequest(
      { mediaKind: 'video', title: '', caption: '' },
      { config: { ...config, apiKey: '' }, prepare, analyze },
    )
    expect(result).toMatchObject({
      status: 503,
      body: { code: 'MULTIMODAL_NOT_CONFIGURED' },
    })
    expect(prepare).not.toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('does not evaluate unrelated Gemini configuration for a selected Kimi runtime', async () => {
    vi.stubEnv('GEMINI_API_BASE_URL', 'http://invalid-gemini.example')
    const cleanup = vi.fn(async () => undefined)
    const analyze = vi.fn(async () => analysis)
    const runtime: MultimodalRuntime = {
      profile: 'kimi-k3',
      provider: 'kimi',
      model: 'kimi-k3',
      apiKey: 'kimi-key',
      capabilities: {
        videoInline: true,
        sceneKeyframes: true,
        audio: false,
        asr: false,
        image: true,
        strictJsonSchema: true,
      },
      analyze,
    }
    const result = await analyzeSourceRequest(
      { mediaKind: 'video', title: '', caption: '' },
      {
        runtime,
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'text_only' as const,
          keyframeCount: 0,
          warnings: [],
          cleanup,
        })),
      },
    )
    expect(result.status).toBe(200)
    expect(analyze).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('requests audio-free media preparation for Kimi only', async () => {
    const cleanup = vi.fn(async () => undefined)
    const prepare = vi.fn(async () => ({
      parts: [],
      mode: 'text_only' as const,
      keyframeCount: 0,
      warnings: [],
      cleanup,
    }))
    const runtime: MultimodalRuntime = {
      profile: 'kimi-k3',
      provider: 'kimi',
      model: 'kimi-k3',
      apiKey: 'kimi-key',
      capabilities: {
        videoInline: true,
        sceneKeyframes: true,
        audio: false,
        asr: false,
        image: true,
        strictJsonSchema: true,
      },
      analyze: vi.fn(async () => analysis),
    }

    await analyzeSourceRequest(
      { mediaKind: 'video', mediaUrl: 'https://cdn.example/video.mp4' },
      { runtime, prepare, prepareOptions: { allowClashFakeIp: true } },
    )

    expect(prepare).toHaveBeenCalledWith(
      expect.any(Object),
      'video',
      expect.objectContaining({
        allowClashFakeIp: true,
        stripAudioTrack: true,
      }),
    )
  })

  it('does not spend a model call when video preparation loses all audio input', async () => {
    const analyze = vi.fn(async () => analysis)
    const result = await analyzeSourceRequest(
      {
        mediaKind: 'video',
        mediaUrl: 'https://expired.example/video.mp4',
        title: '仍可用标题',
        caption: '仍可用 caption',
      },
      {
        config,
        prepare: vi.fn().mockRejectedValue(new Error('signed URL and secret query')),
        analyze: analyze as typeof analyzeWithGemini,
      },
    )
    expect(result).toEqual({
      status: 422,
      body: {
        code: 'MM01_AUDIO_EVIDENCE_MISSING',
        error:
          '原视频音轨未能完整送达多模态模型；为避免漏掉口播、BGM、音效和环境音，MM01 与 P02 已中止。请重试或检查 FFmpeg 与素材大小。',
      },
    })
    expect(analyze).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('signed URL and secret query')
  })

  it('creates and completes a durable run around the unchanged model call', async () => {
    const pending = {
      projectId: 'default',
      assetId: 'asset_123',
      runId: 'run_456',
      status: 'pending' as const,
    }
    const complete = { ...pending, status: 'complete' as const }
    const artifactStore = {
      beginRun: vi.fn(async () => pending),
      copyDownloadedMedia: vi.fn(async () => ({ kind: 'original-video' })),
      persistPreparedMedia: vi.fn(async () => []),
      completeRun: vi.fn(async () => complete),
      failRun: vi.fn(async () => ({ ...pending, status: 'failed' as const })),
    }
    const cleanup = vi.fn(async () => undefined)
    const result = await analyzeSourceRequest(
      {
        mediaKind: 'video',
        sourceUrl: 'https://www.tiktok.com/@creator/video/123?tracking=1',
        mediaUrl: 'https://cdn.example/video.mp4?signature=secret',
        title: 'archive test',
      },
      {
        config,
        artifactStore: artifactStore as never,
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'text_only' as const,
          keyframeCount: 0,
          warnings: [],
          cleanup,
        })),
        analyze: vi.fn(async () => analysis) as typeof analyzeWithGemini,
      },
    )

    expect(artifactStore.beginRun).toHaveBeenCalledOnce()
    expect(artifactStore.persistPreparedMedia).toHaveBeenCalledOnce()
    expect(artifactStore.completeRun).toHaveBeenCalledWith(
      pending,
      expect.objectContaining({ analysis, requestedModel: config.model }),
    )
    expect(result).toEqual({
      status: 200,
      body: { analysis, artifact: complete },
    })
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('marks the archive partial when media evidence persistence fails', async () => {
    const pending = {
      projectId: 'default',
      assetId: 'asset_partial',
      runId: 'run_partial',
      status: 'pending' as const,
    }
    const completeRun = vi.fn(async (
      _reference: unknown,
      input: { status: 'complete' | 'partial'; warning?: string },
    ) => ({
      ...pending,
      status: input.status,
      warning: input.warning,
    }))
    const result = await analyzeSourceRequest(
      {
        mediaKind: 'video',
        sourceUrl: 'https://example.com/video/partial',
      },
      {
        config,
        artifactStore: {
          beginRun: vi.fn(async () => pending),
          copyDownloadedMedia: vi.fn(),
          persistPreparedMedia: vi.fn().mockRejectedValue(new Error('disk full')),
          completeRun,
          failRun: vi.fn(),
        } as never,
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'text_only' as const,
          keyframeCount: 0,
          warnings: [],
          cleanup: async () => undefined,
        })),
        analyze: vi.fn(async () => analysis) as typeof analyzeWithGemini,
      },
    )

    expect(completeRun).toHaveBeenCalledWith(
      pending,
      expect.objectContaining({
        status: 'partial',
        warning: expect.stringContaining('媒体证据'),
      }),
    )
    expect(result.body.artifact).toMatchObject({ status: 'partial' })
  })

  it('reports archive initialization failure without blocking paid analysis', async () => {
    const result = await analyzeSourceRequest(
      {
        mediaKind: 'video',
        sourceUrl: 'https://example.com/video/archive-init-failure',
      },
      {
        config,
        artifactStore: {
          beginRun: vi.fn().mockRejectedValue(new Error('archive unavailable')),
          copyDownloadedMedia: vi.fn(),
          persistPreparedMedia: vi.fn(),
          completeRun: vi.fn(),
          failRun: vi.fn(),
        } as never,
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'text_only' as const,
          keyframeCount: 0,
          warnings: [],
          cleanup: async () => undefined,
        })),
        analyze: vi.fn(async () => analysis) as typeof analyzeWithGemini,
        onError: vi.fn(),
      },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        analysis,
        artifactWarning: expect.stringContaining('档案初始化失败'),
      },
    })
    expect(result.body).not.toHaveProperty('artifact')
  })

  it('passes explicit mixed collections to the existing media preparer and cleans up', async () => {
    const cleanup = vi.fn(async () => undefined)
    const prepare = vi.fn(async () => ({
      parts: [],
      mode: 'text_only' as const,
      keyframeCount: 0,
      warnings: [],
      cleanup,
    }))
    const analyze = vi.fn(async () => analysis)
    const request = {
      mediaKind: 'mixed',
      mediaUrl: 'https://cdn.example/primary.mp4',
      mediaUrls: ['https://cdn.example/primary.mp4'],
      videoUrls: ['https://cdn.example/primary.mp4'],
      imageUrls: ['https://cdn.example/still.jpg'],
    }
    const result = await analyzeSourceRequest(request, {
      config,
      prepare,
      analyze: analyze as typeof analyzeWithGemini,
    })
    expect(result.status).toBe(200)
    expect(prepare).toHaveBeenCalledWith(
      {
        mediaUrl: 'https://cdn.example/primary.mp4',
        mediaUrls: ['https://cdn.example/primary.mp4'],
        videoUrls: ['https://cdn.example/primary.mp4'],
        imageUrls: ['https://cdn.example/still.jpg'],
      },
      'mixed',
    )
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('returns a stable sanitized error without upstream response or API key', async () => {
    const cleanup = vi.fn(async () => undefined)
    const result = await analyzeSourceRequest(
      { mediaKind: 'text', title: 'safe input' },
      {
        config: { ...config, apiKey: 'do-not-return-this-key' },
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'text_only' as const,
          keyframeCount: 0,
          warnings: [],
          cleanup,
        })),
        analyze: vi.fn(async () => {
          throw new Error('raw gateway response with internal details')
        }) as typeof analyzeWithGemini,
      },
    )
    expect(result).toMatchObject({
      status: 502,
      body: { code: 'MULTIMODAL_ANALYSIS_FAILED' },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('raw gateway response')
    expect(serialized).not.toContain('do-not-return-this-key')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('maps missing Kimi visual evidence to a sanitized 422 skip', async () => {
    const cleanup = vi.fn(async () => undefined)
    const result = await analyzeSourceRequest(
      { mediaKind: 'video', mediaUrl: 'https://cdn.example/video.mp4' },
      {
        runtime: {
          profile: 'kimi-k3',
          provider: 'kimi',
          model: 'kimi-k3',
          apiKey: 'kimi-key',
          capabilities: {
            videoInline: true,
            sceneKeyframes: true,
            audio: false,
            asr: false,
            image: true,
            strictJsonSchema: true,
          },
          analyze: vi.fn(async () => {
            throw new KimiServiceError(
              'KIMI_UNSUPPORTED_MEDIA',
              'raw internal media detail',
            )
          }),
        },
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'text_only' as const,
          keyframeCount: 0,
          warnings: [],
          cleanup,
        })),
      },
    )

    expect(result).toEqual({
      status: 422,
      body: {
        error: 'Kimi K3 未取得可用视频画面；为避免仅凭标题或字幕猜测，本次未调用模型。',
        code: 'KIMI_UNSUPPORTED_MEDIA',
      },
    })
    expect(JSON.stringify(result)).not.toContain('raw internal media detail')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('reports incomplete Seed output as truncation rather than a safety block', async () => {
    const cleanup = vi.fn(async () => undefined)
    const result = await analyzeSourceRequest(
      { mediaKind: 'video', mediaUrl: 'https://cdn.example/video.mp4' },
      {
        runtime: {
          profile: 'seed-2.1-pro',
          provider: 'seed',
          model: 'doubao-seed-2-1-pro-260628',
          apiKey: 'seed-key',
          capabilities: {
            videoInline: true,
            sceneKeyframes: false,
            audio: false,
            asr: false,
            image: true,
            strictJsonSchema: true,
          },
          analyze: vi.fn(async () => {
            throw new SeedServiceError(
              'SEED_INCOMPLETE',
              'raw upstream incomplete detail',
            )
          }),
        },
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'video_inline' as const,
          keyframeCount: 0,
          warnings: [],
          cleanup,
        })),
      },
    )
    expect(result).toEqual({
      status: 502,
      body: {
        code: 'SEED_INCOMPLETE',
        error: 'Seed 2.1 Pro 输出未完成或被截断，请重试。',
      },
    })
    expect(JSON.stringify(result)).not.toContain('raw upstream')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('returns a sanitized coverage failure and confirms P02 was not executed', async () => {
    const cleanup = vi.fn(async () => undefined)
    const result = await analyzeSourceRequest(
      { mediaKind: 'video', mediaUrl: 'https://cdn.example/video.mp4' },
      {
        config,
        prepare: vi.fn(async () => ({
          parts: [],
          mode: 'video_inline_keyframes' as const,
          keyframeCount: 8,
          durationSeconds: 130.8,
          warnings: [],
          cleanup,
        })),
        analyze: vi.fn(async () => {
          throw new Mm01CoverageError({
            status: 'blocked',
            durationSec: 130.8,
            coveredSec: 11,
            coverageRatio: 11 / 130.8,
            directSceneCount: 4,
            oversizedSceneCount: 0,
            headGapSec: 0,
            tailGapSec: 119.8,
            maxGapSec: 119.8,
            intervals: [{ startSec: 0, endSec: 11 }],
            thresholds: {
              minimumCoverageRatio: 0.8,
              maximumHeadGapSec: 2,
              maximumTailGapSec: 10,
              maximumGapSec: 13.08,
              maximumSceneSpanSec: 15,
            },
            reasonCodes: [
              'coverage_ratio_below_threshold',
              'tail_gap_exceeds_threshold',
              'max_gap_exceeds_threshold',
            ],
          })
        }) as typeof analyzeWithGemini,
      },
    )

    expect(result).toEqual({
      status: 502,
      body: {
        code: 'MM01_INSUFFICIENT_COVERAGE',
        error:
          'MM01 有效画面时间轴覆盖 8.4%（11.0 / 130.8 秒，最低要求 80%）：有效画面覆盖低于门槛；未充分触达片尾；时间轴存在过大盲区。为避免误判，P02 未执行。请重试或对长视频进行分段分析。',
      },
    })
    expect(JSON.stringify(result)).not.toContain('coverage_ratio_below_threshold')
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe('multimodal status', () => {
  it('reports the required MM01 -> C01 -> P02 model pipeline to an authorized caller', () => {
    const runtime: MultimodalRuntime = {
      profile: 'gemini',
      provider: 'gemini',
      model: config.model,
      apiKey: config.apiKey,
      capabilities: {
        videoInline: true,
        sceneKeyframes: true,
        audio: true,
        asr: true,
        image: true,
        strictJsonSchema: true,
      },
      downstream: {
        configured: true,
        c01Model: 'gpt-5-mini',
        p02Model: 'gpt-5-mini',
      },
      analyze: vi.fn(async () => analysis),
    }
    expect(multimodalStatus(runtime).body).toMatchObject({
      configured: true,
      model: 'gemini-3.1-pro-preview-thinking',
      downstream: {
        configured: true,
        c01Model: 'gpt-5-mini',
        p02Model: 'gpt-5-mini',
      },
      pipeline: {
        mm01: true,
        contextResearch: true,
        p02FormattedPrompt: true,
        p02: true,
        modelCalls: 3,
      },
    })
  })

  it('does not report the full chain as configured when downstream is absent', () => {
    expect(multimodalStatus(config).body).toMatchObject({
      configured: false,
      downstream: {
        configured: false,
        c01Model: '',
        p02Model: '',
      },
    })
  })

  it('does not reveal model configuration to an unauthorized caller', () => {
    expect(
      multimodalStatus(config, {
        enabled: true,
        authorized: false,
        requiresAccessToken: true,
      }).body,
    ).toMatchObject({ configured: false, model: '', authorized: false })
  })
})
