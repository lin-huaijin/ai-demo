export type RuntimeApiCredential =
  | 'scrapeCreatorsApiKey'
  | 'foreplayApiKey'
  | 'geminiApiKey'
  | 'kimiApiKey'
  | 'seedApiKey'
  | 'downstreamApiKey'
  | 'teamAccessToken'
  | 'intentShortsBridgeToken'

export type RuntimeMultimodalProfile =
  | 'gemini'
  | 'kimi-k3'
  | 'seed-2.1-pro'
  | 'fusion'
export type RuntimeApiTarget =
  | 'scrapecreators'
  | 'foreplay'
  | 'gemini'
  | 'multimodal'

export interface RuntimeApiCredentials {
  scrapeCreatorsApiKey: string
  foreplayApiKey: string
  geminiApiKey: string
  kimiApiKey: string
  seedApiKey: string
  downstreamApiKey: string
  teamAccessToken: string
  intentShortsBridgeToken: string
}
const EMPTY_CREDENTIALS: RuntimeApiCredentials = {
  scrapeCreatorsApiKey: '',
  foreplayApiKey: '',
  geminiApiKey: '',
  kimiApiKey: '',
  seedApiKey: '',
  downstreamApiKey: '',
  teamAccessToken: '',
  intentShortsBridgeToken: '',
}

let runtimeCredentials = { ...EMPTY_CREDENTIALS }
let runtimeMultimodalProfile: RuntimeMultimodalProfile | undefined
const listeners = new Set<() => void>()

function notifyRuntimeSettingsChanged() {
  listeners.forEach((listener) => listener())
}

/**
 * Runtime credentials deliberately live only in module memory. API keys must
 * never be written to localStorage, sessionStorage, URLs, or the public bundle.
 */
export function setRuntimeApiCredentials(
  patch: Partial<RuntimeApiCredentials>,
) {
  runtimeCredentials = {
    ...runtimeCredentials,
    ...Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, value?.trim() ?? '']),
    ),
  }
  notifyRuntimeSettingsChanged()
}

/** Apply credentials and model selection atomically so status refreshes cannot race. */
export function setRuntimeApiSettings(
  patch: Partial<RuntimeApiCredentials>,
  profile: RuntimeMultimodalProfile,
) {
  runtimeCredentials = {
    ...runtimeCredentials,
    ...Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, value?.trim() ?? '']),
    ),
  }
  runtimeMultimodalProfile = profile
  notifyRuntimeSettingsChanged()
}

export function getRuntimeApiCredentials(): RuntimeApiCredentials {
  return { ...runtimeCredentials }
}

export function getRuntimeMultimodalProfile(): RuntimeMultimodalProfile | undefined {
  return runtimeMultimodalProfile
}

export function setRuntimeMultimodalProfile(profile: RuntimeMultimodalProfile) {
  runtimeMultimodalProfile = profile
  notifyRuntimeSettingsChanged()
}

export function clearRuntimeApiCredentials() {
  runtimeCredentials = { ...EMPTY_CREDENTIALS }
  runtimeMultimodalProfile = undefined
  notifyRuntimeSettingsChanged()
}

export function subscribeRuntimeApiSettings(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shared Beta access code. Kept in memory only; never bundled or persisted. */
export function setRuntimeApiAccessToken(value: string) {
  setRuntimeApiCredentials({ teamAccessToken: value })
}

export function setRuntimeIntentShortsBridgeAccessToken(value: string) {
  setRuntimeApiCredentials({ intentShortsBridgeToken: value })
}

export function runtimeApiHeaders(
  headers: Record<string, string> = {},
  target?: RuntimeApiTarget,
): Record<string, string> {
  const result = { ...headers }
  if (runtimeCredentials.teamAccessToken) {
    result.authorization = `Bearer ${runtimeCredentials.teamAccessToken}`
  }
  const providerKey =
    target === 'scrapecreators'
      ? runtimeCredentials.scrapeCreatorsApiKey
      : target === 'foreplay'
        ? runtimeCredentials.foreplayApiKey
        : ''
  if (providerKey) result['x-intent-provider-key'] = providerKey
  if (target === 'gemini' || target === 'multimodal') {
    const profile = target === 'gemini' ? 'gemini' : runtimeMultimodalProfile
    if (profile) result['x-intent-multimodal-profile'] = profile
    if (profile === 'fusion') {
      if (runtimeCredentials.geminiApiKey) {
        result['x-intent-gemini-key'] = runtimeCredentials.geminiApiKey
      }
      if (runtimeCredentials.seedApiKey) {
        result['x-intent-seed-key'] = runtimeCredentials.seedApiKey
      }
    } else if (profile === 'seed-2.1-pro' && runtimeCredentials.seedApiKey) {
      result['x-intent-seed-key'] = runtimeCredentials.seedApiKey
    } else if (profile === 'kimi-k3' && runtimeCredentials.kimiApiKey) {
      result['x-intent-kimi-key'] = runtimeCredentials.kimiApiKey
    } else if (profile === 'gemini' && runtimeCredentials.geminiApiKey) {
      result['x-intent-gemini-key'] = runtimeCredentials.geminiApiKey
    }
    if (runtimeCredentials.downstreamApiKey) {
      result['x-intent-downstream-key'] = runtimeCredentials.downstreamApiKey
    }
  }
  return result
}

export function runtimeIntentShortsHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return runtimeCredentials.intentShortsBridgeToken
    ? {
        ...headers,
        authorization: `Bearer ${runtimeCredentials.intentShortsBridgeToken}`,
      }
    : headers
}
