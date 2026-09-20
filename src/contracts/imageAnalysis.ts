import type { Platform } from './multimodalAnalysis.ts'

export type ImageAnalysisModule = 'IM01_IMAGE_ANALYSIS_PACK'
export type ImageAnalysisConfidence = 'high' | 'medium' | 'low'
export type ImageAnalysisAspectRatio =
  | '1:1'
  | '4:5'
  | '9:16'
  | '16:9'
  | 'unknown'

export interface ImageAnalysisSourceMeta {
  platform: Platform
  sourceUrl: string
  imageUrl: string
  marketId: string
  marketLanguages: string[]
  title: string
  caption: string
}

export interface ImageAnalysisBox {
  xPct: number
  yPct: number
  wPct: number
  hPct: number
}

export interface ImageVisualInventoryItem {
  id: string
  type:
    | 'person'
    | 'phone'
    | 'app_ui'
    | 'product'
    | 'logo'
    | 'background'
    | 'icon'
    | 'button'
    | 'food'
    | 'object'
    | 'other'
  description: string
  absolutePosition: ImageAnalysisBox
  relativePosition: string
  visualRole:
    | 'hook'
    | 'proof'
    | 'context'
    | 'decoration'
    | 'brand_signal'
    | 'cta'
    | 'supporting'
  confidence: ImageAnalysisConfidence
}

export interface ImageOcrBlock {
  id: string
  text: string
  language: string
  absolutePosition: ImageAnalysisBox
  relativePosition: string
  fontScale: 'hero' | 'large' | 'medium' | 'small' | 'micro'
  textRole:
    | 'headline'
    | 'subhead'
    | 'body'
    | 'cta'
    | 'badge'
    | 'logo_text'
    | 'app_ui_text'
    | 'disclaimer'
    | 'price'
    | 'claim'
    | 'unknown'
  verbatimSensitivity:
    | 'safe'
    | 'brand'
    | 'product'
    | 'personal'
    | 'legal_claim'
    | 'sensitive'
    | 'unknown'
  confidence: ImageAnalysisConfidence
}

export interface ImageAnalysisPack {
  module: ImageAnalysisModule
  sourceMeta: ImageAnalysisSourceMeta
  imageGeometry: {
    aspectRatio: ImageAnalysisAspectRatio
    width: number
    height: number
    safeArea: string
  }
  visualInventory: ImageVisualInventoryItem[]
  ocrBlocks: ImageOcrBlock[]
  layoutMap: {
    composition: string
    readingOrder: string[]
    primaryFocus: string
    secondaryFocus: string
    ctaLocation: string
    phoneUiLocation: string
    textImageRelationship: string
  }
  styleProfile: {
    visualStyle: string
    colorPalette: string[]
    typographyStyle: string
    mood: string
    platformFeel: string
  }
  semanticRead: {
    literalMessage: string
    impliedMessage: string
    userPain: string
    promisedOutcome: string
    emotionalDrivers: string[]
    targetAudienceSignals: string[]
    adLoop: {
      painHook: string
      proofMoment: string
      resultPromise: string
      cta: string
    }
  }
  riskAndCleanup: {
    sourceBrandSignals: string[]
    sourceProductSignals: string[]
    sourceCtaSignals: string[]
    sensitiveSignals: string[]
    copyrightSignals: string[]
    unverifiedClaims: string[]
    mustNotCarryToPrompt: string[]
    safeAbstractions: string[]
  }
  notes: string
  confidence: ImageAnalysisConfidence
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  return value
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${path} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((entry, index) => stringValue(entry, `${path}[${index}]`))
}

function box(value: unknown, path: string): ImageAnalysisBox {
  const parsed = record(value, path)
  const result = {
    xPct: numberValue(parsed.xPct, `${path}.xPct`),
    yPct: numberValue(parsed.yPct, `${path}.yPct`),
    wPct: numberValue(parsed.wPct, `${path}.wPct`),
    hPct: numberValue(parsed.hPct, `${path}.hPct`),
  }
  for (const [key, coordinate] of Object.entries(result)) {
    if (coordinate < 0 || coordinate > 100) {
      throw new Error(`${path}.${key} must be between 0 and 100`)
    }
  }
  return result
}

const CONFIDENCE = ['high', 'medium', 'low'] as const
const ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9', 'unknown'] as const
const VISUAL_TYPES = [
  'person',
  'phone',
  'app_ui',
  'product',
  'logo',
  'background',
  'icon',
  'button',
  'food',
  'object',
  'other',
] as const
const VISUAL_ROLES = [
  'hook',
  'proof',
  'context',
  'decoration',
  'brand_signal',
  'cta',
  'supporting',
] as const
const FONT_SCALES = ['hero', 'large', 'medium', 'small', 'micro'] as const
const TEXT_ROLES = [
  'headline',
  'subhead',
  'body',
  'cta',
  'badge',
  'logo_text',
  'app_ui_text',
  'disclaimer',
  'price',
  'claim',
  'unknown',
] as const
const SENSITIVITY = [
  'safe',
  'brand',
  'product',
  'personal',
  'legal_claim',
  'sensitive',
  'unknown',
] as const

export function parseImageAnalysisPack(value: unknown): ImageAnalysisPack {
  const root = record(value, 'IM01')
  const sourceMeta = record(root.sourceMeta, 'IM01.sourceMeta')
  const imageGeometry = record(root.imageGeometry, 'IM01.imageGeometry')
  const layoutMap = record(root.layoutMap, 'IM01.layoutMap')
  const styleProfile = record(root.styleProfile, 'IM01.styleProfile')
  const semanticRead = record(root.semanticRead, 'IM01.semanticRead')
  const adLoop = record(semanticRead.adLoop, 'IM01.semanticRead.adLoop')
  const riskAndCleanup = record(root.riskAndCleanup, 'IM01.riskAndCleanup')

  const visualInventory = Array.isArray(root.visualInventory)
    ? root.visualInventory.map((entry, index) => {
        const item = record(entry, `IM01.visualInventory[${index}]`)
        return {
          id: stringValue(item.id, `IM01.visualInventory[${index}].id`),
          type: enumValue(item.type, VISUAL_TYPES, `IM01.visualInventory[${index}].type`),
          description: stringValue(item.description, `IM01.visualInventory[${index}].description`),
          absolutePosition: box(item.absolutePosition, `IM01.visualInventory[${index}].absolutePosition`),
          relativePosition: stringValue(item.relativePosition, `IM01.visualInventory[${index}].relativePosition`),
          visualRole: enumValue(item.visualRole, VISUAL_ROLES, `IM01.visualInventory[${index}].visualRole`),
          confidence: enumValue(item.confidence, CONFIDENCE, `IM01.visualInventory[${index}].confidence`),
        }
      })
    : (() => {
        throw new Error('IM01.visualInventory must be an array')
      })()

  const ocrBlocks = Array.isArray(root.ocrBlocks)
    ? root.ocrBlocks.map((entry, index) => {
        const item = record(entry, `IM01.ocrBlocks[${index}]`)
        return {
          id: stringValue(item.id, `IM01.ocrBlocks[${index}].id`),
          text: stringValue(item.text, `IM01.ocrBlocks[${index}].text`),
          language: stringValue(item.language, `IM01.ocrBlocks[${index}].language`),
          absolutePosition: box(item.absolutePosition, `IM01.ocrBlocks[${index}].absolutePosition`),
          relativePosition: stringValue(item.relativePosition, `IM01.ocrBlocks[${index}].relativePosition`),
          fontScale: enumValue(item.fontScale, FONT_SCALES, `IM01.ocrBlocks[${index}].fontScale`),
          textRole: enumValue(item.textRole, TEXT_ROLES, `IM01.ocrBlocks[${index}].textRole`),
          verbatimSensitivity: enumValue(
            item.verbatimSensitivity,
            SENSITIVITY,
            `IM01.ocrBlocks[${index}].verbatimSensitivity`,
          ),
          confidence: enumValue(item.confidence, CONFIDENCE, `IM01.ocrBlocks[${index}].confidence`),
        }
      })
    : (() => {
        throw new Error('IM01.ocrBlocks must be an array')
      })()

  return {
    module: enumValue(root.module, ['IM01_IMAGE_ANALYSIS_PACK'] as const, 'IM01.module'),
    sourceMeta: {
      platform: enumValue(sourceMeta.platform, ['tiktok', 'meta', 'youtube', 'unknown'] as const, 'IM01.sourceMeta.platform'),
      sourceUrl: stringValue(sourceMeta.sourceUrl, 'IM01.sourceMeta.sourceUrl'),
      imageUrl: stringValue(sourceMeta.imageUrl, 'IM01.sourceMeta.imageUrl'),
      marketId: stringValue(sourceMeta.marketId, 'IM01.sourceMeta.marketId'),
      marketLanguages: stringArray(sourceMeta.marketLanguages, 'IM01.sourceMeta.marketLanguages'),
      title: stringValue(sourceMeta.title, 'IM01.sourceMeta.title'),
      caption: stringValue(sourceMeta.caption, 'IM01.sourceMeta.caption'),
    },
    imageGeometry: {
      aspectRatio: enumValue(imageGeometry.aspectRatio, ASPECT_RATIOS, 'IM01.imageGeometry.aspectRatio'),
      width: numberValue(imageGeometry.width, 'IM01.imageGeometry.width'),
      height: numberValue(imageGeometry.height, 'IM01.imageGeometry.height'),
      safeArea: stringValue(imageGeometry.safeArea, 'IM01.imageGeometry.safeArea'),
    },
    visualInventory,
    ocrBlocks,
    layoutMap: {
      composition: stringValue(layoutMap.composition, 'IM01.layoutMap.composition'),
      readingOrder: stringArray(layoutMap.readingOrder, 'IM01.layoutMap.readingOrder'),
      primaryFocus: stringValue(layoutMap.primaryFocus, 'IM01.layoutMap.primaryFocus'),
      secondaryFocus: stringValue(layoutMap.secondaryFocus, 'IM01.layoutMap.secondaryFocus'),
      ctaLocation: stringValue(layoutMap.ctaLocation, 'IM01.layoutMap.ctaLocation'),
      phoneUiLocation: stringValue(layoutMap.phoneUiLocation, 'IM01.layoutMap.phoneUiLocation'),
      textImageRelationship: stringValue(layoutMap.textImageRelationship, 'IM01.layoutMap.textImageRelationship'),
    },
    styleProfile: {
      visualStyle: stringValue(styleProfile.visualStyle, 'IM01.styleProfile.visualStyle'),
      colorPalette: stringArray(styleProfile.colorPalette, 'IM01.styleProfile.colorPalette'),
      typographyStyle: stringValue(styleProfile.typographyStyle, 'IM01.styleProfile.typographyStyle'),
      mood: stringValue(styleProfile.mood, 'IM01.styleProfile.mood'),
      platformFeel: stringValue(styleProfile.platformFeel, 'IM01.styleProfile.platformFeel'),
    },
    semanticRead: {
      literalMessage: stringValue(semanticRead.literalMessage, 'IM01.semanticRead.literalMessage'),
      impliedMessage: stringValue(semanticRead.impliedMessage, 'IM01.semanticRead.impliedMessage'),
      userPain: stringValue(semanticRead.userPain, 'IM01.semanticRead.userPain'),
      promisedOutcome: stringValue(semanticRead.promisedOutcome, 'IM01.semanticRead.promisedOutcome'),
      emotionalDrivers: stringArray(semanticRead.emotionalDrivers, 'IM01.semanticRead.emotionalDrivers'),
      targetAudienceSignals: stringArray(semanticRead.targetAudienceSignals, 'IM01.semanticRead.targetAudienceSignals'),
      adLoop: {
        painHook: stringValue(adLoop.painHook, 'IM01.semanticRead.adLoop.painHook'),
        proofMoment: stringValue(adLoop.proofMoment, 'IM01.semanticRead.adLoop.proofMoment'),
        resultPromise: stringValue(adLoop.resultPromise, 'IM01.semanticRead.adLoop.resultPromise'),
        cta: stringValue(adLoop.cta, 'IM01.semanticRead.adLoop.cta'),
      },
    },
    riskAndCleanup: {
      sourceBrandSignals: stringArray(riskAndCleanup.sourceBrandSignals, 'IM01.riskAndCleanup.sourceBrandSignals'),
      sourceProductSignals: stringArray(riskAndCleanup.sourceProductSignals, 'IM01.riskAndCleanup.sourceProductSignals'),
      sourceCtaSignals: stringArray(riskAndCleanup.sourceCtaSignals, 'IM01.riskAndCleanup.sourceCtaSignals'),
      sensitiveSignals: stringArray(riskAndCleanup.sensitiveSignals, 'IM01.riskAndCleanup.sensitiveSignals'),
      copyrightSignals: stringArray(riskAndCleanup.copyrightSignals, 'IM01.riskAndCleanup.copyrightSignals'),
      unverifiedClaims: stringArray(riskAndCleanup.unverifiedClaims, 'IM01.riskAndCleanup.unverifiedClaims'),
      mustNotCarryToPrompt: stringArray(riskAndCleanup.mustNotCarryToPrompt, 'IM01.riskAndCleanup.mustNotCarryToPrompt'),
      safeAbstractions: stringArray(riskAndCleanup.safeAbstractions, 'IM01.riskAndCleanup.safeAbstractions'),
    },
    notes: stringValue(root.notes, 'IM01.notes'),
    confidence: enumValue(root.confidence, CONFIDENCE, 'IM01.confidence'),
  }
}
