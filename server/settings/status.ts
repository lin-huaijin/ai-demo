import { parseMultimodalProfile } from '../multimodal/profiles.ts'
import { downstreamTextConfigFromEnv } from '../multimodal/downstreamText.ts'

export interface ApiSettingsStatus {
  services: {
    scrapecreators: { configured: boolean }
    foreplay: { configured: boolean }
    gemini: { configured: boolean; model: string }
    downstream: {
      configured: boolean
      c01Model: string
      p02Model: string
      protocol: 'openai-responses' | 'gemini-native'
    }
    multimodal: {
      activeProfile: 'gemini' | 'kimi-k3' | 'seed-2.1-pro' | 'fusion'
      profiles: {
        gemini: {
          configured: boolean
          providerConfigured: boolean
          provider: 'gemini'
          model: string
          audio: true
        }
        'kimi-k3': {
          configured: boolean
          providerConfigured: boolean
          provider: 'kimi'
          model: string
          audio: false
        }
        'seed-2.1-pro': {
          configured: boolean
          providerConfigured: boolean
          provider: 'seed'
          model: string
          audio: false
        }
        fusion: {
          configured: boolean
          providerConfigured: boolean
          provider: 'fusion'
          model: string
          audio: true
        }
      }
    }
    intentShorts: { configured: boolean }
  }
}

export type ApiSettingsStatusResult =
  | { status: 200; body: ApiSettingsStatus }
  | {
      status: 500
      body: { error: string; code: 'MULTIMODAL_CONFIG_INVALID' }
    }

export function apiSettingsStatus(
  env: Record<string, string | undefined> = process.env,
): ApiSettingsStatus {
  const activeProfile = parseMultimodalProfile(env.MULTIMODAL_DEFAULT_PROFILE)
  const geminiModel =
    env.GEMINI_MULTIMODAL_MODEL?.trim() ||
    env.GEMINI_MODEL?.trim() ||
    'gemini-3.1-pro-preview-thinking'
  const kimiModel = env.KIMI_MULTIMODAL_MODEL?.trim() || 'kimi-k3'
  const seedModel =
    env.SEED_MULTIMODAL_MODEL?.trim() || 'doubao-seed-2-1-pro-260628'
  const geminiConfigured = Boolean(env.GEMINI_API_KEY?.trim())
  const seedConfigured = Boolean(
    env.SEED_API_KEY?.trim() || env.ARK_API_KEY?.trim(),
  )
  const kimiConfigured = Boolean(env.KIMI_API_KEY?.trim())
  const downstream = downstreamTextConfigFromEnv(env)
  const downstreamConfigured = Boolean(downstream.apiKey)
  return {
    services: {
      scrapecreators: {
        configured: Boolean(env.SCRAPECREATORS_API_KEY?.trim()),
      },
      foreplay: { configured: Boolean(env.FOREPLAY_API_KEY?.trim()) },
      gemini: {
        configured: geminiConfigured,
        model: geminiModel,
      },
      downstream: {
        configured: downstreamConfigured,
        c01Model: downstream.c01Model,
        p02Model: downstream.p02Model,
        protocol: downstream.protocol ?? 'openai-responses',
      },
      multimodal: {
        activeProfile,
        profiles: {
          gemini: {
            configured: geminiConfigured && downstreamConfigured,
            providerConfigured: geminiConfigured,
            provider: 'gemini',
            model: geminiModel,
            audio: true,
          },
          'kimi-k3': {
            configured: kimiConfigured && downstreamConfigured,
            providerConfigured: kimiConfigured,
            provider: 'kimi',
            model: kimiModel,
            audio: false,
          },
          'seed-2.1-pro': {
            configured: seedConfigured && downstreamConfigured,
            providerConfigured: seedConfigured,
            provider: 'seed',
            model: seedModel,
            audio: false,
          },
          fusion: {
            configured:
              geminiConfigured && seedConfigured && downstreamConfigured,
            providerConfigured: geminiConfigured && seedConfigured,
            provider: 'fusion',
            model: `${geminiModel} × ${seedModel}`,
            audio: true,
          },
        },
      },
      intentShorts: {
        configured: Boolean(
          env.INTENT_SHORTS_API_BASE_URL?.trim() &&
            (env.INTENT_SHORTS_ACCESS_PASSWORD?.trim() ||
              env.INTENT_SHORTS_ADMIN_PASSWORD?.trim()) &&
            env.INTENT_SHORTS_BRIDGE_ACCESS_TOKEN?.trim(),
        ),
      },
    },
  }
}

/** Stable, non-throwing envelope shared by the local and deployed routes. */
export function apiSettingsStatusResult(
  env: Record<string, string | undefined> = process.env,
): ApiSettingsStatusResult {
  try {
    return { status: 200, body: apiSettingsStatus(env) }
  } catch {
    return {
      status: 500,
      body: {
        error: '多模态模型服务端配置无效。',
        code: 'MULTIMODAL_CONFIG_INVALID',
      },
    }
  }
}
