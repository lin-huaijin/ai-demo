import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  multimodalRuntimeForRequest,
  parseMultimodalProfile,
} from './profiles.ts'

describe('multimodal profile routing', () => {
  it('keeps Gemini as the server default', () => {
    expect(parseMultimodalProfile()).toBe('gemini')
    expect(
      multimodalRuntimeForRequest(
        { headers: {} },
        { GEMINI_API_KEY: 'gemini-server-key' },
      ),
    ).toMatchObject({
      profile: 'gemini',
      provider: 'gemini',
      apiKey: 'gemini-server-key',
      downstream: { protocol: 'openai-responses' },
    })
  })

  it('captures the server-owned Gemini-native downstream route', () => {
    expect(
      multimodalRuntimeForRequest(
        {
          headers: {
            'x-intent-downstream-key': 'session-downstream-key',
            'x-intent-downstream-protocol': 'openai-responses',
          },
        },
        {
          GEMINI_API_KEY: 'gemini-server-key',
          DOWNSTREAM_MODEL_PROTOCOL: 'gemini-native',
          DOWNSTREAM_MODEL_API_BASE_URL: 'https://api.moonshot.cn/v1beta',
        },
      ),
    ).toMatchObject({
      downstream: {
        configured: true,
        protocol: 'gemini-native',
      },
    })
  })

  it('selects Kimi only when explicitly requested and never reuses a Gemini key', () => {
    const runtime = multimodalRuntimeForRequest(
      {
        headers: {
          'x-intent-multimodal-profile': 'kimi-k3',
          'x-intent-kimi-key': 'kimi-session-key',
          'x-intent-gemini-key': 'gemini-session-key',
        },
      },
      {
        GEMINI_API_KEY: 'gemini-server-key',
        KIMI_API_BASE_URL: 'https://api.moonshot.cn/v1',
        KIMI_API_ALLOWED_HOSTS: 'api.moonshot.cn',
        FFMPEG_BIN: process.execPath,
        FFPROBE_BIN: process.execPath,
      },
    )

    expect(runtime).toMatchObject({
      profile: 'kimi-k3',
      provider: 'kimi',
      model: 'kimi-k3',
      apiKey: 'kimi-session-key',
      capabilities: { audio: false, asr: false, videoInline: true },
    })
  })

  it('reports Kimi video capabilities conservatively without FFmpeg', () => {
    const missing = join(process.cwd(), 'definitely-missing-media-binary')
    const runtime = multimodalRuntimeForRequest(
      { headers: { 'x-intent-multimodal-profile': 'kimi-k3' } },
      {
        KIMI_API_KEY: 'kimi-key',
        FFMPEG_BIN: missing,
        FFPROBE_BIN: missing,
      },
    )
    expect(runtime.capabilities).toMatchObject({
      videoInline: false,
      sceneKeyframes: false,
      image: true,
      audio: false,
    })
  })

  it('honors a server-default Kimi profile when the browser sends no override', () => {
    expect(
      multimodalRuntimeForRequest(
        { headers: {} },
        {
          MULTIMODAL_DEFAULT_PROFILE: 'kimi-k3',
          GEMINI_API_KEY: 'gemini-key',
          KIMI_API_KEY: 'kimi-key',
        },
      ),
    ).toMatchObject({
      profile: 'kimi-k3',
      provider: 'kimi',
      apiKey: 'kimi-key',
    })
  })

  it('routes Seed and Fusion with dedicated per-request keys', () => {
    const env = {
      GEMINI_API_KEY: 'gemini-server-key',
      SEED_API_KEY: 'seed-server-key',
      FFMPEG_BIN: process.execPath,
      FFPROBE_BIN: process.execPath,
    }
    expect(
      multimodalRuntimeForRequest(
        {
          headers: {
            'x-intent-multimodal-profile': 'seed-2.1-pro',
            'x-intent-seed-key': 'seed-session-key',
            'x-intent-gemini-key': 'gemini-session-key',
          },
        },
        env,
      ),
    ).toMatchObject({
      profile: 'seed-2.1-pro',
      provider: 'seed',
      model: 'doubao-seed-2-1-pro-260628',
      apiKey: 'seed-session-key',
      capabilities: { videoInline: true, audio: false, asr: false },
    })

    expect(
      multimodalRuntimeForRequest(
        {
          headers: {
            'x-intent-multimodal-profile': 'fusion',
            'x-intent-seed-key': 'seed-session-key',
            'x-intent-gemini-key': 'gemini-session-key',
          },
        },
        env,
      ),
    ).toMatchObject({
      profile: 'fusion',
      provider: 'fusion',
      apiKey: 'gemini-session-key',
      capabilities: {
        videoInline: true,
        sceneKeyframes: true,
        audio: true,
        asr: true,
      },
    })
  })

  it('does not report Fusion configured unless both model keys exist', () => {
    expect(
      multimodalRuntimeForRequest(
        { headers: { 'x-intent-multimodal-profile': 'fusion' } },
        { GEMINI_API_KEY: 'gemini-only' },
      ).apiKey,
    ).toBe('')
    expect(
      multimodalRuntimeForRequest(
        { headers: { 'x-intent-multimodal-profile': 'fusion' } },
        { SEED_API_KEY: 'seed-only' },
      ).apiKey,
    ).toBe('')
  })

  it('rejects browser-controlled unknown profiles', () => {
    expect(() =>
      multimodalRuntimeForRequest(
        { headers: { 'x-intent-multimodal-profile': 'custom-upstream' } },
        {},
      ),
    ).toThrow(/配置无效/)
  })
})
