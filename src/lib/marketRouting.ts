import { MARKETS } from '../data/markets'
import type {
  HotItem,
  SourceMarketConfidence,
  SourceMarketEvidence,
} from '../types'

export const AUTO_MARKET_ID = 'auto'
export const UNKNOWN_MARKET_ID = 'unknown'

export interface LanguageMarketMatch {
  language: string
  marketId: string
  confidence: Exclude<SourceMarketConfidence, 'unknown'>
}

export interface SourceMarketResolution {
  sourceLanguage: string
  sourceMarketId: string
  sourceMarketEvidence: SourceMarketEvidence
  sourceMarketConfidence: SourceMarketConfidence
}

const ENGLISH_WORDS = new Set([
  'a', 'about', 'and', 'are', 'can', 'for', 'from', 'hello', 'how', 'i',
  'in', 'is', 'it', 'my', 'of', 'on', 'that', 'the', 'this', 'to', 'we',
  'what', 'with', 'you', 'your',
])
const STRONG_ENGLISH_WORDS = new Set([
  'about', 'are', 'can', 'from', 'hello', 'how', 'is', 'my', 'that', 'the',
  'this', 'we', 'what', 'with', 'you', 'your',
])

function looksLikeEnglish(text: string): boolean {
  const words = text.toLocaleLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []
  if (words.length === 0) return false
  const commonCount = words.filter((word) => ENGLISH_WORDS.has(word)).length
  return (
    words.some((word) => STRONG_ENGLISH_WORDS.has(word)) || commonCount >= 2
  )
}

/**
 * Infer a supported language market from language-bearing text only.
 * Country names, destinations, hashtags, themes and visual style are not
 * evidence here.
 */
export function inferLanguageMarket(text: string): LanguageMarketMatch | null {
  const value = text.trim()
  if (!value) return null
  const hay = value.toLocaleLowerCase()

  if (/[\uac00-\ud7af]/.test(value) || /한국어/.test(hay)) {
    return { language: 'ko-KR', marketId: 'kr', confidence: 'high' }
  }
  if (/[\u3040-\u30ff]/.test(value) || /日本語/.test(hay)) {
    return { language: 'ja-JP', marketId: 'jp', confidence: 'high' }
  }
  if (/[\u0e00-\u0e7f]/.test(value)) {
    return { language: 'th-TH', marketId: 'th', confidence: 'high' }
  }
  if (/[\u0600-\u06ff]/.test(value)) {
    return { language: 'ar', marketId: 'gcc', confidence: 'high' }
  }
  if (/[\u0900-\u097f]/.test(value)) {
    return { language: 'hi-IN', marketId: 'in', confidence: 'high' }
  }
  if (/tiếng việt/.test(hay) || /[ăâđêôơư]/i.test(value)) {
    return { language: 'vi-VN', marketId: 'vn', confidence: 'high' }
  }
  if (/bahasa indonesia|\baku\b|\bkamu\b|\bnggak\b|\bgak\b/.test(hay)) {
    return { language: 'id-ID', marketId: 'id', confidence: 'medium' }
  }
  if (/bahasa melayu|\bawak\b|\btak\b|\bterima kasih\b/.test(hay)) {
    return { language: 'ms-MY', marketId: 'my', confidence: 'medium' }
  }
  if (/tagalog|filipino|\bako\b|\bikaw\b|\bsalamat\b|\bmahal\b/.test(hay)) {
    return { language: 'fil', marketId: 'ph', confidence: 'medium' }
  }
  if (/português|\bvo[cç]ê\b|\bobrigad[oa]\b|\bnão\b|\bpara\b/.test(hay)) {
    return { language: 'pt-BR', marketId: 'br', confidence: 'medium' }
  }
  if (looksLikeEnglish(value)) {
    return { language: 'en', marketId: 'us', confidence: 'medium' }
  }

  return null
}

/** Video language is authoritative; post language is only a fallback. */
export function resolveSourceMarket(
  videoLanguageText: string,
  postLanguageText: string,
): SourceMarketResolution {
  const video = inferLanguageMarket(videoLanguageText)
  if (video) {
    return {
      sourceLanguage: video.language,
      sourceMarketId: video.marketId,
      sourceMarketEvidence: 'video_language',
      sourceMarketConfidence: video.confidence,
    }
  }

  const post = inferLanguageMarket(postLanguageText)
  if (post) {
    return {
      sourceLanguage: post.language,
      sourceMarketId: post.marketId,
      sourceMarketEvidence: 'post_language',
      sourceMarketConfidence:
        post.confidence === 'high' ? 'medium' : post.confidence,
    }
  }

  return {
    sourceLanguage: UNKNOWN_MARKET_ID,
    sourceMarketId: UNKNOWN_MARKET_ID,
    sourceMarketEvidence: 'unknown',
    sourceMarketConfidence: 'unknown',
  }
}

export function targetMarketForSource(
  requestedTargetMarketId: string,
  sourceMarketId: string,
) {
  return requestedTargetMarketId === AUTO_MARKET_ID
    ? {
        marketId: sourceMarketId,
        targetMarketSource: 'source_default' as const,
      }
    : {
        marketId: requestedTargetMarketId,
        targetMarketSource: 'user_override' as const,
      }
}

export interface MarketRuleValidation {
  sourceMarketValid: boolean
  protagonistConstraintValid: boolean
  protagonistMarketId: string
  protagonistNativeLanguage: string
}

export function protagonistMarketContext(item: HotItem): {
  marketId: string
  marketName: string
  nativeLanguage: string
} {
  const market = MARKETS.find((candidate) => candidate.id === item.marketId)
  return {
    marketId: item.marketId,
    marketName: market?.name ?? item.marketId,
    nativeLanguage: market?.languages[0] ?? UNKNOWN_MARKET_ID,
  }
}

/** Local string/field checks only; this never invokes a model. */
export function validateMarketRules(
  item: HotItem,
  productionPrompt: string,
): MarketRuleValidation {
  const protagonist = protagonistMarketContext(item)
  const sourceMarketId = item.sourceMarketId ?? item.marketId
  return {
    sourceMarketValid: MARKETS.some(
      (market) => market.id === sourceMarketId,
    ),
    protagonistConstraintValid:
      productionPrompt.includes(
        `主角市场：${protagonist.marketName}（${protagonist.marketId}）`,
      ) &&
      productionPrompt.includes(`主角母语：${protagonist.nativeLanguage}`),
    protagonistMarketId: protagonist.marketId,
    protagonistNativeLanguage: protagonist.nativeLanguage,
  }
}
