import { describe, expect, it } from 'vitest'
import { providerKindForPath } from './vitePlugin.ts'

describe('providerKindForPath', () => {
  it('claims only the two local provider prefixes', () => {
    expect(providerKindForPath('/api/scrape/v2/tiktok/video')).toBe('scrape')
    expect(providerKindForPath('/api/foreplay/discovery/ads')).toBe('foreplay')
    expect(providerKindForPath('/api/scrape-creators')).toBeNull()
    expect(providerKindForPath('/api/multimodal/analyze')).toBeNull()
  })
})
