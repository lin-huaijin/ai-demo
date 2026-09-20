import { describe, expect, it } from 'vitest'
import { matchesArchiveQuery } from './archiveSearch.ts'

const candidate = {
  id: 'asset-001',
  title: '便利店里的反差挑战',
  summary: '人物在结尾完成身份反转',
  sourceUrl: 'https://www.tiktok.com/@creator/video/123',
  platform: 'TikTok',
  market: '日本 Japan',
  category: '跨文化交流',
}

describe('matchesArchiveQuery', () => {
  it.each(['asset-001', '反差', '身份反转', '@creator', 'TIKTOK', '日本', '跨文化'])(
    'matches archive fields with %s',
    (query) => {
      expect(matchesArchiveQuery(candidate, query)).toBe(true)
    },
  )

  it('treats surrounding whitespace as insignificant', () => {
    expect(matchesArchiveQuery(candidate, '  反差  ')).toBe(true)
  })

  it('returns false for an unrelated query', () => {
    expect(matchesArchiveQuery(candidate, '不存在的测试关键词xyz')).toBe(false)
  })
})
