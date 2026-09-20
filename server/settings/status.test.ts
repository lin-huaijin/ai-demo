import { describe, expect, it } from 'vitest'
import { apiSettingsStatus, apiSettingsStatusResult } from './status.ts'

describe('apiSettingsStatus', () => {
  it('exposes configuration state without exposing credentials', () => {
    const result = apiSettingsStatus({
      SCRAPECREATORS_API_KEY: 'scrape-secret',
      GEMINI_API_KEY: 'gemini-secret',
      GEMINI_MULTIMODAL_MODEL: 'gemini-custom',
      KIMI_API_KEY: 'kimi-secret',
      SEED_API_KEY: 'seed-secret',
      SEED_MULTIMODAL_MODEL: 'seed-custom',
      DOWNSTREAM_MODEL_API_KEY: 'downstream-secret',
      C01_SEARCH_MODEL: 'context-model',
      P02_TEXT_MODEL: 'breakdown-model',
      INTENT_SHORTS_API_BASE_URL: 'https://shorts.example.com',
      INTENT_SHORTS_ACCESS_PASSWORD: 'upstream-secret',
      INTENT_SHORTS_BRIDGE_ACCESS_TOKEN: 'bridge-secret',
    })

    expect(result).toEqual({
      services: {
        scrapecreators: { configured: true },
        foreplay: { configured: false },
        gemini: { configured: true, model: 'gemini-custom' },
        downstream: {
          configured: true,
          c01Model: 'context-model',
          p02Model: 'breakdown-model',
          protocol: 'openai-responses',
        },
        multimodal: {
          activeProfile: 'gemini',
          profiles: {
            gemini: {
              configured: true,
              providerConfigured: true,
              provider: 'gemini',
              model: 'gemini-custom',
              audio: true,
            },
            'kimi-k3': {
              configured: true,
              providerConfigured: true,
              provider: 'kimi',
              model: 'kimi-k3',
              audio: false,
            },
            'seed-2.1-pro': {
              configured: true,
              providerConfigured: true,
              provider: 'seed',
              model: 'seed-custom',
              audio: false,
            },
            fusion: {
              configured: true,
              providerConfigured: true,
              provider: 'fusion',
              model: 'gemini-custom × seed-custom',
              audio: true,
            },
          },
        },
        intentShorts: { configured: true },
      },
    })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('reports the default deep-analysis model before settings load', () => {
    expect(apiSettingsStatus({}).services.gemini.model).toBe(
      'gemini-3.1-pro-preview-thinking',
    )
    expect(apiSettingsStatus({}).services.multimodal.activeProfile).toBe('gemini')
    expect(apiSettingsStatus({}).services.multimodal.profiles['kimi-k3']).toMatchObject({
      configured: false,
      providerConfigured: false,
      model: 'kimi-k3',
      audio: false,
    })
    expect(
      apiSettingsStatus({}).services.multimodal.profiles['seed-2.1-pro'],
    ).toMatchObject({
      configured: false,
      providerConfigured: false,
      model: 'doubao-seed-2-1-pro-260628',
      audio: false,
    })
    expect(apiSettingsStatus({}).services.multimodal.profiles.fusion).toMatchObject({
      configured: false,
      providerConfigured: false,
      provider: 'fusion',
      audio: true,
    })
  })

  it('recognizes the official Ark API key alias without exposing it', () => {
    const result = apiSettingsStatus({
      ARK_API_KEY: 'ark-secret',
      DOWNSTREAM_MODEL_API_KEY: 'downstream-secret',
    })

    expect(
      result.services.multimodal.profiles['seed-2.1-pro'].configured,
    ).toBe(true)
    expect(result.services.multimodal.profiles.fusion.configured).toBe(false)
    expect(JSON.stringify(result)).not.toContain('ark-secret')
    expect(JSON.stringify(result)).not.toContain('downstream-secret')
  })

  it('does not report a runnable profile until the required downstream chain is configured', () => {
    const withoutDownstream = apiSettingsStatus({
      GEMINI_API_KEY: 'gemini-secret',
    })
    expect(withoutDownstream.services.multimodal.profiles.gemini).toMatchObject({
      configured: false,
      providerConfigured: true,
    })
    expect(withoutDownstream.services.downstream).toMatchObject({
      configured: false,
      c01Model: 'gpt-5-mini',
      p02Model: 'gpt-5-mini',
      protocol: 'openai-responses',
    })

    const complete = apiSettingsStatus({
      GEMINI_API_KEY: 'gemini-secret',
      DOWNSTREAM_MODEL_API_KEY: 'downstream-secret',
    })
    expect(complete.services.multimodal.profiles.gemini.configured).toBe(true)
    expect(complete.services.downstream.configured).toBe(true)
  })

  it('reports the server-owned Gemini-native downstream protocol without credentials', () => {
    const result = apiSettingsStatus({
      DOWNSTREAM_MODEL_PROTOCOL: 'gemini-native',
      DOWNSTREAM_MODEL_API_KEY: 'downstream-secret',
      DOWNSTREAM_MODEL_API_BASE_URL: 'https://api.moonshot.cn/v1beta',
      C01_SEARCH_MODEL: 'gemini-context',
      P02_TEXT_MODEL: 'gemini-breakdown',
    })

    expect(result.services.downstream).toEqual({
      configured: true,
      c01Model: 'gemini-context',
      p02Model: 'gemini-breakdown',
      protocol: 'gemini-native',
    })
    expect(JSON.stringify(result)).not.toContain('downstream-secret')
    expect(JSON.stringify(result)).not.toContain('api.moonshot.cn')
  })

  it('uses the same strict server-default profile parser as the runtime', () => {
    expect(
      apiSettingsStatus({ MULTIMODAL_DEFAULT_PROFILE: 'kimi-k3' }).services
        .multimodal.activeProfile,
    ).toBe('kimi-k3')
    expect(
      apiSettingsStatus({
        MULTIMODAL_DEFAULT_PROFILE: 'fusion',
        GEMINI_API_KEY: 'gemini-key',
        SEED_API_KEY: 'seed-key',
      }).services.multimodal.activeProfile,
    ).toBe('fusion')
    expect(() =>
      apiSettingsStatus({ MULTIMODAL_DEFAULT_PROFILE: 'unknown-model' }),
    ).toThrow(/gemini.*kimi-k3.*seed-2\.1-pro.*fusion/)
  })

  it('returns a stable sanitized 500 envelope for an invalid server default', () => {
    expect(
      apiSettingsStatusResult({ MULTIMODAL_DEFAULT_PROFILE: 'unknown-model' }),
    ).toEqual({
      status: 500,
      body: {
        error: '多模态模型服务端配置无效。',
        code: 'MULTIMODAL_CONFIG_INVALID',
      },
    })
  })
})
