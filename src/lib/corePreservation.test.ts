import { describe, expect, it } from 'vitest'
import type { HotItem } from '../types'
import { buildPromptChain } from '../prompts/pipeline'
import { assessSellFit, extractCoreMeme } from './breakdown'

function itemFixture(): HotItem {
  return {
    id: 'core-preservation',
    sourceMarketId: 'us',
    marketId: 'us',
    platform: 'tiktok',
    title: '外来者逐步理解一条当地规则后的反转',
    likes: 20_000,
    views: 200_000,
    source: 'likes_top',
    topicTags: ['cross_culture', 'travel'],
    formatFit: ['video'],
    oneLiner: '主角先误解当地规则，随后逐步学习语境，最终在理解规则后完成开场期待的反转。',
    suggestedFeature: 'translator',
    collectedAt: '2026-01-01',
    dedupeKey: 'core-preservation',
    transcriptStatus: 'ok',
    transcript: 'A short cross-cultural conversation with a final reversal.',
  }
}

describe('core preservation contracts', () => {
  it('extracts a traceable core signature and dependency graph', () => {
    const meme = extractCoreMeme(itemFixture())
    expect(meme.coreSignature).toEqual(['C1', 'C2', 'C3'])
    expect(meme.coreElements?.filter((element) => element.necessity === 'must_keep'))
      .toHaveLength(3)
    expect(meme.coreDependencies).toContainEqual({
      from: 'C2',
      to: 'C3',
      relation: 'enables_payoff',
    })
  })

  it('keeps sensitive must-keep topics in the handling plan', () => {
    const item = itemFixture()
    const meme = extractCoreMeme(item)
    meme.coreElements = [
      ...(meme.coreElements ?? []),
      {
        id: 'R1',
        content: '承担核心冲突的敏感文化主题',
        semanticRole: 'premise',
        necessity: 'must_keep',
        riskType: 'sensitive_topic',
        handling: 'qualify',
        preservationStrength: 'exact_qualified',
        requiredSurfaceTokens: ['SURFACE_TOKEN_R1'],
        requiredQualifierTokens: ['QUALIFIER_TOKEN_R1'],
        retentionRequirement: '保留主题，只限定语境和表达方式。',
        transformationBoundary: '不得删除主题；移除危险行为和冒犯措辞。',
        evidenceRefs: ['seg_01'],
      },
    ]
    meme.coreSignature = [...(meme.coreSignature ?? []), 'R1']

    const fit = assessSellFit(item, meme)
    expect(fit.coreHandlingPlan?.find((entry) => entry.coreId === 'R1')?.decision)
      .toBe('qualify')
    expect(fit.riskTransformationContract?.retainedSensitiveCore)
      .toContainEqual({
        coreId: 'R1',
        retentionRequirement: '保留主题，只限定语境和表达方式。',
        allowedTreatment: '不得删除主题；移除危险行为和冒犯措辞。',
      })
  })

  it('hands adopted narrative inferences to P05 and core element meanings to P09', () => {
    const item = itemFixture()
    const meme = extractCoreMeme(item)
    const fit = assessSellFit(item, meme)
    const steps = buildPromptChain(item, {
      hotItemId: item.id,
      meme,
      fit,
      brokenDownAt: '2026-01-01',
    })

    const p05 = steps.find((step) => step.id === 'P05')?.prompt ?? ''
    const p09 = steps.find((step) => step.id === 'P09')?.prompt ?? ''
    expect(p05).toContain('已采纳的语境支持叙事推断')
    expect(p05).toContain('反事实必要性测试')
    expect(p09).toContain('coreElements：')
    expect(p09).toContain(meme.coreElements?.[0]?.content)
    expect(p09).toContain('coreSignature 中每个 id 都必须在 coreElements 中读取其具体语义')
  })

  it('scores semantic retention and prevents generic rewrite instructions', () => {
    const item = itemFixture()
    item.topicTags = []
    item.title = '旅行场景中的规则反转'
    const meme = extractCoreMeme(item)
    const fit = assessSellFit(item, meme)
    expect(fit.featureRanking?.every((candidate) =>
      typeof candidate.coreRetentionScore === 'number')).toBe(true)
    if (fit.rewrittenScene) {
      expect(fit.rewrittenScene).toContain('不得改成无关的普通功能演示')
    }
  })

})
