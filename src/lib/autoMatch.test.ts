import { describe, expect, it } from 'vitest'
import { DEMO_HOT_ITEMS } from '../data/hotPool.ts'
import {
  preserveReviewedMatch,
  rebuildCardForForm,
  runBreakdownAndMatch,
} from './autoMatch.ts'

describe('preserveReviewedMatch', () => {
  it('keeps a human screening decision and compatible form selection', () => {
    const generated = runBreakdownAndMatch(DEMO_HOT_ITEMS, [], []).matches[0]
    expect(generated).toBeDefined()
    const selectedForm = generated.produceForm === 'poster' ? 'video' : 'poster'
    const previous = {
      ...rebuildCardForForm(generated, selectedForm),
      status: 'screened_in' as const,
    }
    const refreshed = { ...generated, title: '刷新后的内容标题' }

    const preserved = preserveReviewedMatch(refreshed, previous)

    expect(preserved.title).toBe('刷新后的内容标题')
    expect(preserved.status).toBe('screened_in')
    expect(preserved.produceForm).toBe(previous.produceForm)
  })

  it('does not preserve an automatic pre-screening status', () => {
    const generated = runBreakdownAndMatch(DEMO_HOT_ITEMS, [], []).matches[0]
    const refreshed = { ...generated, status: 'rejected' as const }
    expect(preserveReviewedMatch(refreshed, generated)).toBe(refreshed)
  })
})
