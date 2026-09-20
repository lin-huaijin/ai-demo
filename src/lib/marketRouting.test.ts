import { describe, expect, it } from 'vitest'
import { DEMO_HOT_ITEMS } from '../data/hotPool'
import { breakdownInspiration } from './breakdown'
import {
  inferLanguageMarket,
  resolveSourceMarket,
  targetMarketForSource,
  validateMarketRules,
} from './marketRouting'
import { buildPromptChain, VIDEO_BREAKDOWN_CHAIN } from '../prompts/pipeline'

describe('source market routing', () => {
  it('uses video language before conflicting post language', () => {
    const result = resolveSourceMarket(
      'こんにちは、これはビデオの会話です',
      'Aku dan kamu ngobrol di caption ini',
    )

    expect(result).toMatchObject({
      sourceMarketId: 'jp',
      sourceLanguage: 'ja-JP',
      sourceMarketEvidence: 'video_language',
    })
  })

  it('falls back to post language when video has no language evidence', () => {
    const result = resolveSourceMarket('', 'This is the post caption for you')

    expect(result).toMatchObject({
      sourceMarketId: 'us',
      sourceLanguage: 'en',
      sourceMarketEvidence: 'post_language',
    })
  })

  it('does not treat a destination country name as language evidence', () => {
    expect(inferLanguageMarket('日本')).toBeNull()
    expect(inferLanguageMarket('Brasil')).toBeNull()
  })

  it('defaults target market to source and preserves an explicit override', () => {
    expect(targetMarketForSource('auto', 'id')).toEqual({
      marketId: 'id',
      targetMarketSource: 'source_default',
    })
    expect(targetMarketForSource('jp', 'id')).toEqual({
      marketId: 'jp',
      targetMarketSource: 'user_override',
    })
  })
})

describe('prompt market rules', () => {
  it('keeps C01 mandatory between MM01 and the deterministic P02F compiler', () => {
    const item = DEMO_HOT_ITEMS.find((candidate) => candidate.transcriptStatus !== 'skipped')
    expect(item).toBeDefined()

    const videoSteps = buildPromptChain(item!, breakdownInspiration(item!))
      .filter((step) => VIDEO_BREAKDOWN_CHAIN.includes(step.id as (typeof VIDEO_BREAKDOWN_CHAIN)[number]))
      .map((step) => ({ id: step.id, active: step.active }))

    expect(videoSteps).toEqual(
      VIDEO_BREAKDOWN_CHAIN.map((id) => ({ id, active: true })),
    )
    expect(videoSteps.map((step) => step.id)).toEqual(['MM01', 'C01', 'P02F', 'P02'])
  })

  it('writes the protagonist market and native language into production prompts', () => {
    const base = DEMO_HOT_ITEMS.find((item) => item.marketId === 'id')
    expect(base).toBeDefined()
    const item = {
      ...base!,
      sourceMarketId: 'id',
      sourceLanguage: 'id-ID',
      sourceMarketEvidence: 'video_language' as const,
      sourceMarketConfidence: 'high' as const,
      targetMarketSource: 'source_default' as const,
    }
    const steps = buildPromptChain(item, breakdownInspiration(item))

    for (const promptId of ['P09', 'P10', 'P11'] as const) {
      const prompt = steps.find((step) => step.id === promptId)?.prompt ?? ''
      expect(prompt).toContain('主角市场：印尼（id）')
      expect(prompt).toContain('主角母语：id-ID')
      expect(validateMarketRules(item, prompt)).toMatchObject({
        sourceMarketValid: true,
        protagonistConstraintValid: true,
      })
    }
  })

  it('reports unknown source market without a model call', () => {
    const item = {
      ...DEMO_HOT_ITEMS[0],
      sourceMarketId: 'unknown',
      marketId: 'unknown',
    }
    expect(validateMarketRules(item, '')).toMatchObject({
      sourceMarketValid: false,
      protagonistConstraintValid: false,
    })
  })
})
