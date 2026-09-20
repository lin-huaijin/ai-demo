import { describe, expect, it } from 'vitest'
import type { HotItem, IntentFeature } from '../types.ts'
import { assessSellFit, breakdownInspiration, extractCoreMeme } from './breakdown.ts'

function item(overrides: Partial<HotItem> = {}): HotItem {
  return {
    id: 'item-1',
    marketId: 'id',
    platform: 'tiktok',
    title: '一段普通素材',
    likes: 80_000,
    views: 800_000,
    source: 'likes_top',
    topicTags: [],
    formatFit: ['video'],
    oneLiner: '人物完成一个动作后露出惊讶表情',
    suggestedFeature: 'chat',
    collectedAt: '2026-07-21T00:00:00.000Z',
    dedupeKey: 'item-1',
    ...overrides,
  }
}

describe('breakdown media and fit consistency', () => {
  it('uses explicit mediaKind instead of stale transcript state for hard eligibility', () => {
    const still = item({ mediaKind: 'image', transcriptStatus: 'ok' })
    const stillFit = assessSellFit(still, extractCoreMeme(still))
    expect(stillFit.placementOptions).not.toContain('hard')

    const video = item({ mediaKind: 'video', transcriptStatus: 'skipped' })
    const videoFit = assessSellFit(video, extractCoreMeme(video))
    expect(videoFit.placementOptions).toEqual(['hard'])
  })

  it('keeps hard-only feature ranking aligned with fitKind=none', () => {
    const source = item({ mediaKind: 'video' })
    const fit = assessSellFit(source, extractCoreMeme(source))

    expect(fit.kind).toBe('none')
    expect(fit.featureRanking?.length).toBeGreaterThan(0)
    expect(fit.featureRanking?.every((candidate) => candidate.fitKind === 'none')).toBe(
      true,
    )
  })

  it('attaches product proof and social payoff metadata to feature choices', () => {
    const source = item({
      mediaKind: 'video',
      oneLiner: '用户在私信里不知道怎么回复外语消息，想用 AI 改得更自然',
      suggestedFeature: 'chat',
    })
    const fit = assessSellFit(source, extractCoreMeme(source))

    expect(fit.selectedCapability).toBeTruthy()
    expect(fit.socialPayoff).toContain('conversation')
    expect(fit.relationshipOutcome).not.toContain('translation complete')
    expect(fit.productCapabilityGate?.selectedCapability).toBeTruthy()
    expect(fit.featureRanking?.[0].proofMode).toBeTruthy()
  })

  it('lets live understanding tasks outrank legacy chat hints', () => {
    const source = item({
      mediaKind: 'video',
      oneLiner:
        '舞者跟随高能音乐做手势舞，外语口令号召大家一起加入动作，旁观者听不懂但想参与。',
      suggestedFeature: 'chat',
    })
    const meme = extractCoreMeme(source)
    const fit = assessSellFit(source, meme)

    expect(meme.creativeContract?.sourceTask).toContain('理解现场语言')
    expect(fit.featureRanking?.[0].feature).toBe('live-caption')
    expect(fit.feature).toBe('live-caption')
    expect(fit.proofTask).toContain('Demo App Live Caption')
    expect(fit.socialOutcome).toContain('参与')
  })

  it('does not treat generic understanding as a live-caption task', () => {
    const source = item({
      mediaKind: 'video',
      oneLiner:
        '主角误解当地规则，随后逐步理解规则背后的社交含义，最后完成一个反转。',
      suggestedFeature: 'chat',
    })
    const meme = extractCoreMeme(source)

    expect(meme.creativeContract?.sourceTask).not.toContain('理解现场语言')
  })

  it('does not silently default a signal-free legacy row to f2f', () => {
    const source = item({
      mediaKind: 'video',
      suggestedFeature: undefined as unknown as IntentFeature,
    })
    const fit = assessSellFit(source, extractCoreMeme(source))

    expect(fit.hardPlacementFeature).toBe('chat')
    expect(fit.hardPlacementFeature).not.toBe('f2f')
  })

  it('prefers validated P02 narrativeMechanics over regex-generated defaults', () => {
    const source = item({
      mediaKind: 'video',
      multimodalAnalysis: {
        p02: {
          narrativeMechanics: {
            audienceReason: 'P02 观众原因',
            narrativeEngine: 'P02 叙事引擎',
            payoffLogic: 'P02 兑现逻辑',
            replaceableSurface: ['P02 可替换'],
            forbiddenSurface: ['P02 禁止'],
          },
        },
      } as unknown as NonNullable<HotItem['multimodalAnalysis']>,
    })
    const result = breakdownInspiration(source)

    expect(result.meme.audienceReason).toBe('P02 观众原因')
    expect(result.meme.narrativeEngine).toBe('P02 叙事引擎')
    expect(result.meme.payoffLogic).toBe('P02 兑现逻辑')
    expect(result.meme.replaceableSurface).toEqual(['P02 可替换'])
    expect(result.meme.forbiddenSurface).toEqual(['P02 禁止'])
  })
})
