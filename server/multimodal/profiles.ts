import type { IncomingMessage } from 'node:http'
import { existsSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import type { MultimodalAnalysisBundle } from '../../src/contracts/multimodalAnalysis.ts'
import {
  analyzeWithGemini,
  geminiConfigForRequest,
  geminiConfigFromEnv,
  type GeminiConfig,
} from './gemini.ts'
import {
  analyzeWithKimi,
  kimiConfigForRequest,
  kimiConfigFromEnv,
  type KimiConfig,
} from './kimi.ts'
import {
  analyzeWithSeed,
  seedConfigForRequest,
  seedConfigFromEnv,
  type SeedConfig,
} from './seed.ts'
import {
  analyzeWithFusion,
  fusionModelLabel,
  type FusionConfig,
} from './fusion.ts'
import type { PreparedMedia } from './media.ts'
import {
  downstreamTextConfigForRequest,
  downstreamTextConfigFromEnv,
  type DownstreamTextConfig,
} from './downstreamText.ts'
import type {
  MultimodalProfile,
  MultimodalProvider,
  MultimodalSourceRequest,
} from './modelCore.ts'

export interface MultimodalCapabilities {
  videoInline: boolean
  sceneKeyframes: boolean
  audio: boolean
  asr: boolean
  image: boolean
  strictJsonSchema: boolean
}

export interface MultimodalRuntime {
  profile: MultimodalProfile
  provider: MultimodalProvider
  model: string
  apiKey: string
  capabilities: MultimodalCapabilities
  downstream?: {
    configured: boolean
    c01Model: string
    p02Model: string
    protocol: 'openai-responses' | 'gemini-native'
  }
  analyze: (
    request: MultimodalSourceRequest,
    media: PreparedMedia,
  ) => Promise<MultimodalAnalysisBundle>
}

function downstreamSummary(config: DownstreamTextConfig) {
  return {
    configured: Boolean(config.apiKey),
    c01Model: config.c01Model,
    p02Model: config.p02Model,
    protocol: config.protocol ?? 'openai-responses',
  }
}

function executableAvailable(
  command: string,
  env: Record<string, string | undefined>,
): boolean {
  const candidate = command.trim()
  if (!candidate) return false
  if (isAbsolute(candidate) || candidate.includes('/') || candidate.includes('\\')) {
    return existsSync(candidate)
  }
  const rawPath = env.PATH ?? env.Path ?? env.path ?? process.env.PATH ?? ''
  const extensions =
    process.platform === 'win32'
      ? (env.PATHEXT ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
      : ['']
  const candidates =
    process.platform === 'win32' && extname(candidate)
      ? [candidate]
      : extensions.map((extension) => `${candidate}${extension.toLowerCase()}`)
  return rawPath.split(delimiter).some((entry) => {
    const directory = entry.trim().replace(/^"|"$/g, '')
    return Boolean(directory) && candidates.some((name) => existsSync(join(directory, name)))
  })
}

function ffmpegAvailable(env: Record<string, string | undefined>): boolean {
  return executableAvailable(env.FFMPEG_BIN?.trim() || 'ffmpeg', env)
}

function sceneKeyframesAvailable(env: Record<string, string | undefined>): boolean {
  return (
    ffmpegAvailable(env) &&
    executableAvailable(env.FFPROBE_BIN?.trim() || 'ffprobe', env)
  )
}

export function parseMultimodalProfile(value?: string): MultimodalProfile {
  const normalized = value?.trim().toLowerCase() || 'gemini'
  if (
    normalized === 'gemini' ||
    normalized === 'kimi-k3' ||
    normalized === 'seed-2.1-pro' ||
    normalized === 'fusion'
  ) return normalized
  throw new Error(
    'MULTIMODAL_DEFAULT_PROFILE 仅支持 gemini、kimi-k3、seed-2.1-pro 或 fusion',
  )
}

function profileHeader(
  request: Pick<IncomingMessage, 'headers'>,
): MultimodalProfile | undefined {
  const raw = request.headers['x-intent-multimodal-profile']
  if (raw === undefined) return undefined
  if (Array.isArray(raw) || typeof raw !== 'string') {
    throw new Error('多模态模型配置无效')
  }
  const normalized = raw.trim().toLowerCase()
  if (
    normalized !== 'gemini' &&
    normalized !== 'kimi-k3' &&
    normalized !== 'seed-2.1-pro' &&
    normalized !== 'fusion'
  ) {
    throw new Error('多模态模型配置无效')
  }
  return normalized
}

function seedRuntime(
  config: SeedConfig,
  env: Record<string, string | undefined>,
  downstream = downstreamTextConfigFromEnv(env),
): MultimodalRuntime {
  return {
    profile: 'seed-2.1-pro',
    provider: 'seed',
    model: config.model,
    apiKey: config.apiKey,
    capabilities: {
      videoInline: true,
      sceneKeyframes: sceneKeyframesAvailable(env),
      audio: false,
      asr: false,
      image: true,
      strictJsonSchema: true,
    },
    downstream: downstreamSummary(downstream),
    analyze: (request, media) =>
      analyzeWithSeed(request, media, config, fetch, downstream),
  }
}

function fusionRuntime(
  config: FusionConfig,
  env: Record<string, string | undefined>,
  downstream = downstreamTextConfigFromEnv(env),
): MultimodalRuntime {
  return {
    profile: 'fusion',
    provider: 'fusion',
    model: fusionModelLabel(config),
    // Runtime consumers only test presence. Both secrets stay captured in analyze.
    apiKey:
      config.gemini.apiKey && config.seed.apiKey ? config.gemini.apiKey : '',
    capabilities: {
      videoInline: true,
      sceneKeyframes: sceneKeyframesAvailable(env),
      audio: true,
      asr: true,
      image: true,
      strictJsonSchema: true,
    },
    downstream: downstreamSummary(downstream),
    analyze: (request, media) =>
      analyzeWithFusion(request, media, config, fetch, downstream),
  }
}

function geminiRuntime(
  config: GeminiConfig,
  env: Record<string, string | undefined>,
  downstream = downstreamTextConfigFromEnv(env),
): MultimodalRuntime {
  return {
    profile: 'gemini',
    provider: 'gemini',
    model: config.model,
    apiKey: config.apiKey,
    capabilities: {
      videoInline: true,
      sceneKeyframes: sceneKeyframesAvailable(env),
      audio: true,
      asr: true,
      image: true,
      strictJsonSchema: true,
    },
    downstream: downstreamSummary(downstream),
    analyze: (request, media) =>
      analyzeWithGemini(request, media, config, fetch, downstream),
  }
}

function kimiRuntime(
  config: KimiConfig,
  env: Record<string, string | undefined>,
  downstream = downstreamTextConfigFromEnv(env),
): MultimodalRuntime {
  return {
    profile: 'kimi-k3',
    provider: 'kimi',
    model: config.model,
    apiKey: config.apiKey,
    capabilities: {
      videoInline: ffmpegAvailable(env),
      sceneKeyframes: sceneKeyframesAvailable(env),
      audio: false,
      asr: false,
      image: true,
      strictJsonSchema: true,
    },
    downstream: downstreamSummary(downstream),
    analyze: (request, media) =>
      analyzeWithKimi(request, media, config, fetch, downstream),
  }
}

export function multimodalRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env,
  profile = parseMultimodalProfile(env.MULTIMODAL_DEFAULT_PROFILE),
): MultimodalRuntime {
  if (profile === 'kimi-k3') return kimiRuntime(kimiConfigFromEnv(env), env)
  if (profile === 'seed-2.1-pro') return seedRuntime(seedConfigFromEnv(env), env)
  if (profile === 'fusion') {
    return fusionRuntime(
      { gemini: geminiConfigFromEnv(env), seed: seedConfigFromEnv(env) },
      env,
    )
  }
  return geminiRuntime(geminiConfigFromEnv(env), env)
}

export function multimodalRuntimeForRequest(
  request: Pick<IncomingMessage, 'headers'>,
  env: Record<string, string | undefined> = process.env,
): MultimodalRuntime {
  const profile =
    profileHeader(request) ?? parseMultimodalProfile(env.MULTIMODAL_DEFAULT_PROFILE)
  const downstream = downstreamTextConfigForRequest(request, env)
  if (profile === 'kimi-k3') {
    return kimiRuntime(kimiConfigForRequest(request, env), env, downstream)
  }
  if (profile === 'seed-2.1-pro') {
    return seedRuntime(seedConfigForRequest(request, env), env, downstream)
  }
  if (profile === 'fusion') {
    return fusionRuntime(
      {
        gemini: geminiConfigForRequest(request, env),
        seed: seedConfigForRequest(request, env),
      },
      env,
      downstream,
    )
  }
  return geminiRuntime(geminiConfigForRequest(request, env), env, downstream)
}
