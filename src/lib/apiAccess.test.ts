import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRuntimeApiCredentials,
  getRuntimeApiCredentials,
  getRuntimeMultimodalProfile,
  runtimeApiHeaders,
  runtimeIntentShortsHeaders,
  setRuntimeApiCredentials,
  setRuntimeApiSettings,
  setRuntimeMultimodalProfile,
  subscribeRuntimeApiSettings,
} from './apiAccess.ts'

afterEach(() => clearRuntimeApiCredentials())

describe('runtime API credentials', () => {
  it('routes each temporary key only to its intended same-origin bridge', () => {
    setRuntimeApiCredentials({
      scrapeCreatorsApiKey: 'scrape-key',
      foreplayApiKey: 'foreplay-key',
      geminiApiKey: 'gemini-key',
      kimiApiKey: 'kimi-key',
      seedApiKey: 'seed-key',
      downstreamApiKey: 'downstream-key',
      teamAccessToken: 'team-token',
      intentShortsBridgeToken: 'shorts-token',
    })

    expect(runtimeApiHeaders({}, 'scrapecreators')).toEqual({
      authorization: 'Bearer team-token',
      'x-intent-provider-key': 'scrape-key',
    })
    expect(runtimeApiHeaders({}, 'foreplay')).toEqual({
      authorization: 'Bearer team-token',
      'x-intent-provider-key': 'foreplay-key',
    })
    expect(runtimeApiHeaders({}, 'gemini')).toEqual({
      authorization: 'Bearer team-token',
      'x-intent-multimodal-profile': 'gemini',
      'x-intent-gemini-key': 'gemini-key',
      'x-intent-downstream-key': 'downstream-key',
    })
    setRuntimeMultimodalProfile('kimi-k3')
    expect(runtimeApiHeaders({}, 'multimodal')).toEqual({
      authorization: 'Bearer team-token',
      'x-intent-multimodal-profile': 'kimi-k3',
      'x-intent-kimi-key': 'kimi-key',
      'x-intent-downstream-key': 'downstream-key',
    })
    setRuntimeMultimodalProfile('seed-2.1-pro')
    expect(runtimeApiHeaders({}, 'multimodal')).toEqual({
      authorization: 'Bearer team-token',
      'x-intent-multimodal-profile': 'seed-2.1-pro',
      'x-intent-seed-key': 'seed-key',
      'x-intent-downstream-key': 'downstream-key',
    })
    setRuntimeMultimodalProfile('fusion')
    expect(runtimeApiHeaders({}, 'multimodal')).toEqual({
      authorization: 'Bearer team-token',
      'x-intent-multimodal-profile': 'fusion',
      'x-intent-gemini-key': 'gemini-key',
      'x-intent-seed-key': 'seed-key',
      'x-intent-downstream-key': 'downstream-key',
    })
    expect(runtimeIntentShortsHeaders()).toEqual({
      authorization: 'Bearer shorts-token',
    })
  })

  it('trims values, notifies subscribers, and clears all in-memory secrets', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRuntimeApiSettings(listener)
    setRuntimeApiCredentials({ geminiApiKey: '  key  ' })
    expect(getRuntimeApiCredentials().geminiApiKey).toBe('key')
    expect(listener).toHaveBeenCalledTimes(1)

    clearRuntimeApiCredentials()
    expect(Object.values(getRuntimeApiCredentials()).every((value) => !value)).toBe(
      true,
    )
    expect(getRuntimeMultimodalProfile()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('applies the selected model and its key with one atomic notification', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRuntimeApiSettings(listener)
    setRuntimeApiSettings(
      { geminiApiKey: 'gemini-key', kimiApiKey: '  kimi-key  ' },
      'kimi-k3',
    )

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getRuntimeMultimodalProfile()).toBe('kimi-k3')
    expect(runtimeApiHeaders({}, 'multimodal')).toEqual({
      'x-intent-multimodal-profile': 'kimi-k3',
      'x-intent-kimi-key': 'kimi-key',
    })
    expect(JSON.stringify(runtimeApiHeaders({}, 'multimodal'))).not.toContain(
      'gemini-key',
    )
    unsubscribe()
  })

  it('never forwards unrelated model keys outside the selected profile', () => {
    setRuntimeApiSettings(
      {
        geminiApiKey: 'gemini-key',
        kimiApiKey: 'kimi-key',
        seedApiKey: 'seed-key',
        downstreamApiKey: 'downstream-key',
      },
      'seed-2.1-pro',
    )

    const headers = runtimeApiHeaders({}, 'multimodal')
    expect(headers).toEqual({
      'x-intent-multimodal-profile': 'seed-2.1-pro',
      'x-intent-seed-key': 'seed-key',
      'x-intent-downstream-key': 'downstream-key',
    })
    expect(JSON.stringify(headers)).not.toContain('gemini-key')
    expect(JSON.stringify(headers)).not.toContain('kimi-key')
  })

  it('keeps the downstream key in memory and forwards it only with multimodal calls', () => {
    setRuntimeApiSettings(
      { geminiApiKey: 'gemini-key', downstreamApiKey: ' downstream-key ' },
      'gemini',
    )

    expect(getRuntimeApiCredentials().downstreamApiKey).toBe('downstream-key')
    expect(runtimeApiHeaders({}, 'multimodal')).toMatchObject({
      'x-intent-downstream-key': 'downstream-key',
    })
    expect(runtimeApiHeaders({}, 'scrapecreators')).not.toHaveProperty(
      'x-intent-downstream-key',
    )
    expect(runtimeApiHeaders()).not.toHaveProperty('x-intent-downstream-key')
  })
})
