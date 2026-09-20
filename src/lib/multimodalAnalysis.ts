import {
  parseMultimodalAnalysisApiResponse,
  type Mm01AnalysisPack,
  type Mm01ModalityStatus,
  type MultimodalAnalysisBundle,
  type PreparedMediaMode,
  type SourceMediaKind,
} from '../contracts/multimodalAnalysis.ts'
import { MARKETS } from '../data/markets'
import type {
  CuratedSourceField,
  HotItem,
  TranscriptConflict,
  TranscriptSource,
  TranscriptStatus,
  TranscriptVerification,
} from '../types'
import { runtimeApiHeaders } from './apiAccess'
import { parseArtifactReference, parseArtifactWarning } from './artifacts.ts'
import {
  imageAnalysisVisualDescription,
  parseImageAnalysisApiResponse,
} from './imageAnalysis.ts'
import {
  UNKNOWN_MARKET_ID,
  resolveSourceMarket,
  targetMarketForSource,
} from './marketRouting'

export interface MultimodalAnalysisRequest {
  mediaKind: SourceMediaKind
  sourceUrl?: string
  mediaUrl?: string
  mediaUrls?: string[]
  videoUrls?: string[]
  imageUrls?: string[]
  platform?: 'tiktok' | 'meta' | 'youtube' | 'unknown'
  marketId?: string
  marketLanguages?: string[]
  title?: string
  caption?: string
  providerTranscript?: string
  durationSeconds?: number
}

export interface MultimodalServiceStatus {
  configured: boolean
  provider: 'gemini' | 'kimi' | 'seed' | 'fusion'
  profile: 'gemini' | 'kimi-k3' | 'seed-2.1-pro' | 'fusion'
  model: string
  enabled: boolean
  authorized: boolean
  requiresAccessToken: boolean
  downstream: {
    configured: boolean
    c01Model: string
    p02Model: string
  }
  capabilities: {
    videoInline: boolean
    sceneKeyframes: boolean
    audio: boolean
    asr: boolean
    image: boolean
    strictJsonSchema: boolean
  }
  pipeline: {
    mm01: true
    contextResearch: true
    p02FormattedPrompt: true
    p02: true
    modelCalls: number
  }
}

export function fusionSeedInputSummary(
  fusion: NonNullable<MultimodalAnalysisBundle['diagnostics']['fusion']>,
): string {
  if (fusion.seedInputMode === 'video_and_keyframes') {
    return `Seed 按 ${fusion.seedVideoFps} fps 检查全时长视频画面 + ${fusion.seedFrameCount} 张时间标注关键帧`
  }
  if (fusion.seedInputMode === 'video_only') {
    return `Seed 按 ${fusion.seedVideoFps} fps 检查全时长视频画面`
  }
  if (fusion.seedInputMode === 'keyframes_only') {
    return `Seed 仅检查 ${fusion.seedFrameCount} 张时间标注关键帧`
  }
  return `Seed 检查 ${fusion.seedFrameCount} 张图片`
}

export function geminiVideoProcessingSummary(
  diagnostics: MultimodalAnalysisBundle['diagnostics'],
): string | undefined {
  if (
    !isWholeVideoMediaMode(diagnostics.mediaMode) ||
    diagnostics.geminiVideoFps === undefined ||
    diagnostics.geminiMediaResolution === undefined
  ) {
    return undefined
  }
  const resolutionLabel = {
    MEDIA_RESOLUTION_LOW: '低',
    MEDIA_RESOLUTION_MEDIUM: '中',
    MEDIA_RESOLUTION_HIGH: '高',
  }[diagnostics.geminiMediaResolution]
  return `Gemini 视频采样 ${diagnostics.geminiVideoFps} fps · 媒体解析档位 ${resolutionLabel}`
}

function isWholeVideoMediaMode(mediaMode: PreparedMediaMode): boolean {
  return mediaMode === 'video_inline_keyframes' || mediaMode === 'video_inline'
}

function modalityIsUsable(status: Mm01ModalityStatus['audio']): boolean {
  return status === 'ok' || status === 'partial'
}

export function analysisModeSummary(status: Mm01ModalityStatus): string {
  if (status.analysisMode === 'full_video') return '完整视频'
  if (status.analysisMode === 'compressed_video') return '压缩视频'
  if (status.analysisMode === 'text_fallback') return '纯文本降级'

  const framesUsable = status.videoFrames !== 'failed'
  const audioUsable =
    modalityIsUsable(status.audio) || modalityIsUsable(status.asr)
  if (framesUsable && audioUsable) return '关键帧 + 音频'
  if (framesUsable) return '仅关键帧（音频不可用）'
  if (audioUsable) return '仅音频（画面不可用）'
  return '媒体证据不可用'
}

export interface FusionGeminiLaneSummary {
  focusLabel: string
  inputSummary: string
  description: string
}

function geminiVisualInputLabel(mediaMode: PreparedMediaMode): string | undefined {
  if (mediaMode === 'video_inline_keyframes') {
    return '完整视频与时间标注关键帧'
  }
  if (mediaMode === 'video_inline') return '完整视频'
  if (mediaMode === 'video_frames_audio' || mediaMode === 'video_frames') {
    return '时间标注关键帧'
  }
  if (mediaMode === 'image_inline') return '原图'
  return undefined
}

function diagnosticsCarryAudio(
  diagnostics: MultimodalAnalysisBundle['diagnostics'],
): boolean {
  if (
    diagnostics.sourceAudioTrack === 'absent' ||
    diagnostics.sourceAudioTrack === 'not_applicable' ||
    diagnostics.audioInputProvenance === 'none' ||
    (diagnostics.sourceAudioTrack === 'present' &&
      diagnostics.audioInputProvenance === 'unknown')
  ) {
    return false
  }
  if (
    diagnostics.audioInputProvenance === 'inline_video' ||
    diagnostics.audioInputProvenance === 'separate_audio'
  ) {
    return true
  }
  return (
    diagnostics.mediaMode === 'video_inline_keyframes' ||
    diagnostics.mediaMode === 'video_inline' ||
    diagnostics.mediaMode === 'video_frames_audio' ||
    diagnostics.mediaMode === 'video_audio'
  )
}

export function fusionGeminiLaneSummary(
  diagnostics: MultimodalAnalysisBundle['diagnostics'],
  status: Mm01ModalityStatus,
): FusionGeminiLaneSummary {
  const visualInput = geminiVisualInputLabel(diagnostics.mediaMode)
  const visualUsable = Boolean(visualInput) && status.videoFrames !== 'failed'
  const audioSupplied = diagnosticsCarryAudio(diagnostics)
  const audioUsable = audioSupplied && modalityIsUsable(status.audio)
  const asrUsable = audioSupplied && modalityIsUsable(status.asr)
  const focusParts: string[] = []

  if (visualUsable) {
    focusParts.push(
      isWholeVideoMediaMode(diagnostics.mediaMode)
        ? diagnostics.mediaMode === 'video_inline_keyframes'
          ? '完整视频 / 关键帧'
          : '完整视频'
        : diagnostics.mediaMode === 'image_inline'
          ? '原图'
          : '关键帧',
    )
  }
  if (audioUsable) focusParts.push('音频')
  if (asrUsable) focusParts.push('ASR')
  focusParts.push('语义')

  let visualSummary: string
  if (visualUsable && visualInput) {
    visualSummary = `使用${visualInput}`
  } else if (visualInput) {
    visualSummary = `收到${visualInput}输入，但画面分析失败`
  } else if (diagnostics.mediaMode === 'text_only') {
    visualSummary = '仅获得文本上下文，未获得视频画面'
  } else {
    visualSummary = '未获得可用视频画面'
  }

  let audioSummary: string
  if (audioUsable && asrUsable) {
    audioSummary = '结合可用音轨与 ASR'
  } else if (audioUsable) {
    audioSummary = '结合可用音轨；ASR 不可用'
  } else if (asrUsable) {
    audioSummary = '结合可用 ASR；音频描述不可用'
  } else if (audioSupplied) {
    audioSummary = '音频与 ASR 均未形成可用证据'
  } else {
    audioSummary = '本次未提供音轨或 ASR'
  }

  const inputSummary = `Gemini ${visualSummary}，${audioSummary}`
  return {
    focusLabel: focusParts.join(' / '),
    inputSummary,
    description: `${inputSummary}，负责复核视觉候选、暗线与语义，并完成 MM01 综合理解和后续事实拆解。`,
  }
}

export interface BatchMultimodalAnalysisSummary {
  items: HotItem[]
  complete: number
  degraded: number
  skipped: number
  failed: number
}

export interface TranscriptReconciliation {
  transcript?: string
  providerTranscript?: string
  modelTranscript?: string
  status: TranscriptStatus
  source: TranscriptSource
  verification: TranscriptVerification
  conflict?: TranscriptConflict
}

export interface ApplyMultimodalAnalysisOptions {
  preserveFields?: ReadonlySet<CuratedSourceField>
}

export interface AnalyzeHotItemOptions extends ApplyMultimodalAnalysisOptions {
  fetchImpl?: typeof fetch
}

export const CURATED_SOURCE_FIELDS = [
  'theme',
  'oneLiner',
  'title',
  'transcript',
  'visualDescription',
] as const satisfies readonly CuratedSourceField[]

function normalizedTranscript(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

/** Character bigrams work for both whitespace-delimited and CJK transcripts. */
export function transcriptSimilarity(left: string, right: string): number {
  const a = normalizedTranscript(left)
  const b = normalizedTranscript(right)
  if (!a || !b) return 0
  if (a === b) return 1

  const shorter = a.length <= b.length ? a : b
  const longer = a.length > b.length ? a : b
  const containmentRatio = shorter.length / longer.length
  if (longer.includes(shorter) && containmentRatio >= 0.35) {
    return Math.max(0.75, containmentRatio)
  }
  if (a.length === 1 || b.length === 1) return 0

  const pairs = (value: string) => {
    const result = new Map<string, number>()
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2)
      result.set(pair, (result.get(pair) ?? 0) + 1)
    }
    return result
  }
  const aPairs = pairs(a)
  const bPairs = pairs(b)
  let overlap = 0
  for (const [pair, count] of aPairs) {
    overlap += Math.min(count, bPairs.get(pair) ?? 0)
  }
  return (2 * overlap) / (a.length + b.length - 2)
}

function quarantineTranscript(
  providerTranscript: string,
  modelTranscript: string,
  reason: string,
): TranscriptReconciliation {
  return {
    transcript: undefined,
    providerTranscript: providerTranscript || undefined,
    modelTranscript: modelTranscript || undefined,
    status: 'conflict',
    source: 'none',
    verification: 'conflict',
    conflict: { providerTranscript, modelTranscript, reason },
  }
}

/**
 * Provider text is only allowed downstream after the media audio corroborates
 * it. Missing ASR is not treated as agreement: both candidates are retained
 * for review and neither is allowed into the legacy regex pipeline.
 */
export function reconcileTranscriptEvidence(
  item: HotItem,
  analysis: MultimodalAnalysisBundle,
  transcriptWasCurated = false,
): TranscriptReconciliation {
  const mm01 = analysis.mm01
  const modelTranscript = mm01.cleanedInputsForP02.rawTranscript.trim()
  const providerTranscript =
    item.providerTranscript?.trim() ||
    (item.transcriptSource !== 'gemini' &&
    item.transcriptSource !== 'model' &&
    item.transcriptSource !== 'human'
      ? item.transcript?.trim()
      : '') ||
    ''

  if (transcriptWasCurated) {
    const transcript = item.transcript?.trim() || undefined
    return {
      transcript,
      providerTranscript: item.providerTranscript,
      modelTranscript: modelTranscript || undefined,
      status: transcript ? 'ok' : 'missing',
      source: 'human',
      verification: 'verified',
    }
  }

  const asrUnavailable =
    mm01.modalityStatus.asr === 'missing' ||
    mm01.modalityStatus.asr === 'failed' ||
    mm01.cleanedInputsForP02.transcriptStatus === 'missing' ||
    mm01.cleanedInputsForP02.transcriptStatus === 'failed'

  if (providerTranscript) {
    if (asrUnavailable || !modelTranscript) {
      return quarantineTranscript(
        providerTranscript,
        modelTranscript,
        'Provider 返回了字幕，但 MM01 未取得可用于核验的音轨 ASR。',
      )
    }
    if (transcriptSimilarity(providerTranscript, modelTranscript) < 0.55) {
      return quarantineTranscript(
        providerTranscript,
        modelTranscript,
        'Provider 字幕与 MM01 音轨 ASR 的字符二元组相似度低于 0.55。',
      )
    }
    return {
      transcript: providerTranscript,
      providerTranscript,
      modelTranscript,
      status:
        mm01.cleanedInputsForP02.transcriptStatus === 'partial'
          ? 'partial'
          : 'ok',
      source: 'provider',
      verification: 'verified',
    }
  }

  if (asrUnavailable || !modelTranscript) {
    return {
      modelTranscript: modelTranscript || undefined,
      status:
        mm01.cleanedInputsForP02.transcriptStatus === 'failed'
          ? 'failed'
          : 'missing',
      source: 'none',
      verification: 'not_applicable',
    }
  }

  return {
    transcript: modelTranscript,
    modelTranscript,
    status:
      mm01.cleanedInputsForP02.transcriptStatus === 'partial'
        ? 'partial'
        : 'ok',
    source: 'model',
    verification: 'verified',
  }
}

export function curatedSourceFieldsInPatch(
  patch: Partial<HotItem>,
): CuratedSourceField[] {
  return CURATED_SOURCE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(patch, field),
  )
}

function sameStrings(left?: string[], right?: string[]): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

/** Reject an async response when any authoritative request/human input moved. */
export function multimodalAnalysisInputChanged(
  requested: HotItem,
  current: HotItem,
): boolean {
  const requestedCurated = new Set(requested.curatedSourceFields ?? [])
  return (
    requested.id !== current.id ||
    requested.sourceMarketId !== current.sourceMarketId ||
    requested.sourceLanguage !== current.sourceLanguage ||
    requested.targetMarketSource !== current.targetMarketSource ||
    requested.marketId !== current.marketId ||
    requested.mediaKind !== current.mediaKind ||
    requested.sourceUrl !== current.sourceUrl ||
    requested.mediaUrl !== current.mediaUrl ||
    !sameStrings(requested.mediaUrls, current.mediaUrls) ||
    !sameStrings(requested.videoUrls, current.videoUrls) ||
    !sameStrings(requested.imageUrls, current.imageUrls) ||
    requested.durationSeconds !== current.durationSeconds ||
    requested.caption !== current.caption ||
    requested.providerTranscript !== current.providerTranscript ||
    CURATED_SOURCE_FIELDS.some((field) => requested[field] !== current[field]) ||
    (current.curatedSourceFields ?? []).some(
      (field) => !requestedCurated.has(field),
    )
  )
}

export function isVideoHotItem(item: HotItem): boolean {
  if (item.mediaKind === 'video') return true
  if (item.mediaKind === 'mixed') return Boolean(item.videoUrls?.length)
  if (item.mediaKind) return false
  return item.transcriptStatus !== 'skipped'
}

export function isImageHotItem(item: HotItem): boolean {
  if (item.mediaKind === 'image' || item.mediaKind === 'carousel') return true
  if (item.mediaKind === 'mixed') {
    return !item.videoUrls?.length && Boolean(item.imageUrls?.length)
  }
  if (item.mediaKind) return false
  return (
    item.transcriptStatus === 'skipped' &&
    Boolean(item.mediaUrl || item.mediaUrls?.length || item.imageUrls?.length)
  )
}

const TRUSTED_ASR_LANGUAGE_MARKETS: ReadonlyArray<
  readonly [RegExp, string]
> = [
  [/^(?:ja|ja-jp|jpn|japanese|日本語)$/i, 'jp'],
  [/^(?:ko|ko-kr|kor|korean|한국어)$/i, 'kr'],
  [/^(?:th|th-th|tha|thai|ภาษาไทย)$/i, 'th'],
  [/^(?:vi|vi-vn|vie|vietnamese|tiếng việt)$/i, 'vn'],
  [/^(?:id|id-id|ind|indonesian|bahasa indonesia)$/i, 'id'],
  [/^(?:ms|ms-my|msa|malay|bahasa melayu)$/i, 'my'],
  [/^(?:fil|fil-ph|tl|tgl|tagalog|filipino)$/i, 'ph'],
  [/^(?:hi|hi-in|hin|hindi|हिन्दी|हिंदी)$/i, 'in'],
  [/^(?:ar|ara|arabic|العربية)$/i, 'gcc'],
  [/^(?:pt-br|brazilian portuguese|português brasileiro)$/i, 'br'],
  [/^(?:en-us|american english)$/i, 'us'],
]

function marketFromTrustedLanguageTag(tag: string): string | undefined {
  const normalized = tag.trim().replaceAll('_', '-').toLowerCase()
  return TRUSTED_ASR_LANGUAGE_MARKETS.find(([pattern]) =>
    pattern.test(normalized),
  )?.[1]
}

function scriptMarketCandidates(text: string): string[] {
  const candidates = new Set<string>()
  if (/[\uac00-\ud7af]/u.test(text)) candidates.add('kr')
  // Kana is unambiguous enough for Japanese; Han characters alone are not.
  if (/[\u3040-\u30ff]/u.test(text) || /日本語/u.test(text)) candidates.add('jp')
  if (/[\u0e00-\u0e7f]/u.test(text)) candidates.add('th')
  if (/[\u0600-\u06ff]/u.test(text)) candidates.add('gcc')
  if (/[\u0900-\u097f]/u.test(text)) candidates.add('in')
  // These letters distinguish Vietnamese from ordinary Latin-script copy.
  if (/[ăâđêôơư]/iu.test(text)) candidates.add('vn')
  return [...candidates]
}

/** Infer an automatic market only from MM01 evidence that actually came from ASR/OCR. */
export function inferMarketIdFromMm01Evidence(mm01: Mm01AnalysisPack): string {
  const candidates = new Set<string>()
  const asrAvailable =
    (mm01.modalityStatus.asr === 'ok' || mm01.modalityStatus.asr === 'partial') &&
    (mm01.cleanedInputsForP02.transcriptStatus === 'ok' ||
      mm01.cleanedInputsForP02.transcriptStatus === 'partial')
  if (asrAvailable) {
    const transcriptParts = [mm01.cleanedInputsForP02.rawTranscript]
    for (const segment of mm01.sceneSegments) {
      if (!segment.asr.speech.trim()) continue
      transcriptParts.push(segment.asr.speech)
      const market = marketFromTrustedLanguageTag(segment.asr.language)
      if (market) candidates.add(market)
    }
    for (const market of scriptMarketCandidates(transcriptParts.join('\n'))) {
      candidates.add(market)
    }
  }

  const ocrAvailable =
    mm01.modalityStatus.ocr === 'ok' || mm01.modalityStatus.ocr === 'partial'
  if (ocrAvailable) {
    const ocrText = [
      mm01.cleanedInputsForP02.ocrText,
      ...mm01.sceneSegments.flatMap((segment) => segment.ocr.texts),
    ].join('\n')
    for (const market of scriptMarketCandidates(ocrText)) candidates.add(market)
  }

  return candidates.size === 1 ? [...candidates][0] : UNKNOWN_MARKET_ID
}

export function multimodalAnalysisRequestFromHotItem(
  item: HotItem,
): MultimodalAnalysisRequest {
  const analysisMarketId = item.sourceMarketId ?? item.marketId
  const marketLanguages = MARKETS.find(
    (market) => market.id === analysisMarketId,
  )?.languages
  const inferredKind: SourceMediaKind =
    item.transcriptStatus === 'skipped' ? 'image' : 'video'
  return {
    mediaKind: item.mediaKind ?? inferredKind,
    sourceUrl: item.sourceUrl,
    mediaUrl: item.mediaUrl,
    mediaUrls: item.mediaUrls,
    videoUrls: item.videoUrls,
    imageUrls: item.imageUrls,
    platform: item.platform,
    marketId: analysisMarketId,
    marketLanguages,
    title: item.title,
    caption: item.caption ?? '',
    providerTranscript:
      item.providerTranscript ??
      (item.transcriptSource === 'provider' || !item.transcriptSource
        ? item.transcript
        : undefined),
    durationSeconds: item.durationSeconds,
  }
}

/**
 * Project strict MM01/C01/P02 output into the existing HotItem inputs. The full
 * bundle remains attached for evidence/audit while the old parser still owns
 * all downstream CoreMeme/SellFit contracts.
 */
export function applyMultimodalAnalysisToHotItem(
  item: HotItem,
  analysis: MultimodalAnalysisBundle,
  options: ApplyMultimodalAnalysisOptions = {},
): HotItem {
  const preserveFields =
    options.preserveFields ??
    (item.curatedSourceFields
      ? new Set<CuratedSourceField>(item.curatedSourceFields)
      : undefined)
  const transcriptWasCurated = preserveFields?.has('transcript') ?? false
  const reconciled = reconcileTranscriptEvidence(
    item,
    analysis,
    transcriptWasCurated,
  )
  const hasTranscriptConflict = reconciled.verification === 'conflict'

  const theme = preserveFields?.has('theme')
    ? item.theme
    : hasTranscriptConflict
      ? item.theme
      : analysis.p02.theme || item.theme
  const oneLiner = preserveFields?.has('oneLiner')
    ? item.oneLiner
    : hasTranscriptConflict
      ? item.oneLiner
      : analysis.p02.story || item.oneLiner
  const transcript = transcriptWasCurated
    ? item.transcript
    : hasTranscriptConflict
      ? undefined
      : analysis.p02.subtitleBody.trim() || reconciled.transcript
  const visualDescription = preserveFields?.has('visualDescription')
    ? item.visualDescription
    : analysis.mm01.cleanedInputsForP02.visualDescription ||
      item.visualDescription
  const degraded =
    analysis.mm01.modalityStatus.analysisMode === 'text_fallback' ||
    analysis.mm01.qualityFlags.needsHumanReview ||
    analysis.contextResearch.qualityFlags.needsHumanReview ||
    hasTranscriptConflict
  const resolvedSourceMarket = resolveSourceMarket(
    [
      hasTranscriptConflict
        ? ''
        : analysis.mm01.cleanedInputsForP02.rawTranscript,
      analysis.mm01.cleanedInputsForP02.ocrText,
      hasTranscriptConflict ? '' : (transcript ?? ''),
    ].join(' '),
    '',
  )
  const trustedMarketId = inferMarketIdFromMm01Evidence(analysis.mm01)
  const sourceMarket =
    trustedMarketId === UNKNOWN_MARKET_ID
      ? resolvedSourceMarket
      : {
          sourceMarketId: trustedMarketId,
          sourceLanguage:
            MARKETS.find((market) => market.id === trustedMarketId)
              ?.languages[0] ?? 'unknown',
          sourceMarketEvidence: 'video_language' as const,
          sourceMarketConfidence: 'high' as const,
        }
  const targetWasExplicit =
    item.marketSelection === 'explicit' ||
    item.targetMarketSource === 'user_override'
  const targetMarket =
    targetWasExplicit
      ? {
          marketId: item.marketId,
          targetMarketSource: 'user_override' as const,
        }
      : targetMarketForSource('auto', sourceMarket.sourceMarketId)

  return {
    ...item,
    ...sourceMarket,
    ...targetMarket,
    marketSelection: targetWasExplicit ? 'explicit' : 'auto',
    theme,
    oneLiner,
    transcript,
    providerTranscript: reconciled.providerTranscript,
    modelTranscript: reconciled.modelTranscript,
    transcriptStatus: reconciled.status,
    transcriptSource: reconciled.source,
    transcriptVerification: reconciled.verification,
    transcriptConflict: reconciled.conflict,
    visualDescription,
    multimodalAnalysis: analysis,
    curatedSourceFields: preserveFields
      ? Array.from(preserveFields)
      : item.curatedSourceFields,
    multimodalAnalysisStatus: degraded ? 'degraded' : 'complete',
    multimodalAnalysisError: undefined,
  }
}

function responseError(data: unknown, fallback: string): string {
  return data &&
    typeof data === 'object' &&
    'error' in data &&
    typeof (data as { error: unknown }).error === 'string'
    ? (data as { error: string }).error
    : fallback
}

function responseCode(data: unknown): string {
  return data &&
    typeof data === 'object' &&
    'code' in data &&
    typeof (data as { code: unknown }).code === 'string'
    ? (data as { code: string }).code
    : ''
}

function normalizeMultimodalServiceStatus(
  data: unknown,
): MultimodalServiceStatus {
  if (!data || typeof data !== 'object') throw new Error('多模态状态格式无效')
  const raw = data as Record<string, unknown>
  const capabilities =
    raw.capabilities && typeof raw.capabilities === 'object'
      ? (raw.capabilities as Record<string, unknown>)
      : {}
  const pipeline =
    raw.pipeline && typeof raw.pipeline === 'object'
      ? (raw.pipeline as Record<string, unknown>)
      : {}
  const downstream =
    raw.downstream && typeof raw.downstream === 'object'
      ? (raw.downstream as Record<string, unknown>)
      : {}
  const legacyCalls = pipeline.geminiCalls
  const legacy =
    raw.provider === undefined &&
    raw.profile === undefined &&
    typeof legacyCalls === 'number'
  const redacted =
    raw.authorized === false && raw.provider === '' && raw.profile === ''
  if (
    !legacy &&
    !redacted &&
    !(
      (raw.provider === 'gemini' && raw.profile === 'gemini') ||
      (raw.provider === 'kimi' && raw.profile === 'kimi-k3') ||
      (raw.provider === 'seed' && raw.profile === 'seed-2.1-pro') ||
      (raw.provider === 'fusion' && raw.profile === 'fusion')
    )
  ) {
    throw new Error('多模态状态中的 provider/profile 不匹配')
  }
  const provider =
    raw.provider === 'kimi' ||
    raw.provider === 'seed' ||
    raw.provider === 'fusion'
      ? raw.provider
      : 'gemini'
  const profile = legacy || redacted
    ? 'gemini'
    : raw.profile === 'kimi-k3'
      ? 'kimi-k3'
      : raw.profile === 'seed-2.1-pro'
        ? 'seed-2.1-pro'
        : raw.profile === 'fusion'
          ? 'fusion'
          : 'gemini'
  const modelCalls = legacy ? legacyCalls : pipeline.modelCalls
  if (typeof modelCalls !== 'number' || !Number.isInteger(modelCalls) || modelCalls < 3) {
    throw new Error('多模态状态中的模型调用次数无效')
  }
  return {
    configured: raw.configured === true && downstream.configured === true,
    provider,
    profile,
    model: typeof raw.model === 'string' ? raw.model : '',
    enabled: raw.enabled === true,
    authorized: raw.authorized === true,
    requiresAccessToken: raw.requiresAccessToken === true,
    downstream: {
      configured: downstream.configured === true,
      c01Model:
        typeof downstream.c01Model === 'string' ? downstream.c01Model : '',
      p02Model:
        typeof downstream.p02Model === 'string' ? downstream.p02Model : '',
    },
    capabilities: {
      videoInline: capabilities.videoInline === true,
      sceneKeyframes: capabilities.sceneKeyframes === true,
      audio: capabilities.audio === true,
      asr:
        typeof capabilities.asr === 'boolean'
          ? capabilities.asr
          : capabilities.audio === true,
      image: capabilities.image === true,
      strictJsonSchema: capabilities.strictJsonSchema !== false,
    },
    pipeline: {
      mm01: true,
      contextResearch: true,
      p02FormattedPrompt: true,
      p02: true,
      modelCalls,
    },
  }
}

export async function getMultimodalServiceStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<MultimodalServiceStatus> {
  const response = await fetchImpl('/api/multimodal/status', {
    headers: runtimeApiHeaders({}, 'multimodal'),
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok || !data) {
    throw new Error(
      responseError(data, `多模态服务状态不可用（HTTP ${response.status}）`),
    )
  }
  return normalizeMultimodalServiceStatus(data)
}

export async function analyzeHotItem(
  item: HotItem,
  options: AnalyzeHotItemOptions = {},
): Promise<HotItem> {
  const isVideo = isVideoHotItem(item)
  const isImage = isImageHotItem(item)
  if (!isVideo && !isImage) {
    return {
      ...item,
      multimodalAnalysisStatus: 'skipped',
      multimodalAnalysisError: 'MM01 仅增强视频和图片素材。',
    }
  }

  const hasMedia = Boolean(
    item.mediaUrl ||
      item.mediaUrls?.length ||
      item.videoUrls?.length ||
      item.imageUrls?.length,
  )
  const hasTextEvidence = Boolean(
    item.caption?.trim() ||
      item.providerTranscript?.trim() ||
      item.transcript?.trim(),
  )
  if (!hasMedia && !hasTextEvidence && item.recognition === 'fallback') {
    return {
      ...item,
      multimodalAnalysisStatus: 'skipped',
      multimodalAnalysisError:
        '抓取未取得真实视频或文本证据，已跳过以避免模型臆测。',
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const endpoint = isImage && !isVideo
      ? '/api/image/analyze'
      : '/api/multimodal/analyze'
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: runtimeApiHeaders(
        { 'content-type': 'application/json' },
        isImage && !isVideo ? 'gemini' : 'multimodal',
      ),
      body: JSON.stringify(multimodalAnalysisRequestFromHotItem(item)),
    })
    const data: unknown = await response.json().catch(() => null)
    const artifact = parseArtifactReference(data)
    const artifactWarning = parseArtifactWarning(data)
    if (!response.ok) {
      const code = responseCode(data)
      return {
        ...item,
        artifact: artifact ?? item.artifact,
        artifactWarning: artifactWarning ?? item.artifactWarning,
        multimodalAnalysisStatus:
          response.status === 503 ||
          code === 'KIMI_UNSUPPORTED_MEDIA' ||
          code === 'SEED_UNSUPPORTED_MEDIA'
            ? 'skipped'
            : 'failed',
        multimodalAnalysisError: responseError(data, `HTTP ${response.status}`),
      }
    }
    if (isImage && !isVideo) {
      const analysis = parseImageAnalysisApiResponse(data)
      return {
        ...item,
        imageAnalysis: analysis,
        visualDescription: options.preserveFields?.has('visualDescription')
          ? item.visualDescription
          : imageAnalysisVisualDescription(analysis),
        multimodalAnalysisStatus: 'complete',
        multimodalAnalysisError: undefined,
        artifact: artifact ?? item.artifact,
        artifactWarning,
      }
    }
    const analysis = parseMultimodalAnalysisApiResponse(data)
    return {
      ...applyMultimodalAnalysisToHotItem(item, analysis, options),
      artifact: artifact ?? item.artifact,
      artifactWarning,
    }
  } catch (error) {
    return {
      ...item,
      multimodalAnalysisStatus: 'failed',
      multimodalAnalysisError:
        error instanceof Error ? error.message : '多模态分析失败',
    }
  }
}

export async function analyzeHotItems(
  items: HotItem[],
  enabled: boolean,
  concurrency = 2,
): Promise<BatchMultimodalAnalysisSummary> {
  if (!enabled || items.length === 0) {
    const skipped = items.map((item) => ({
      ...item,
      multimodalAnalysisStatus: 'skipped' as const,
      multimodalAnalysisError: enabled
        ? item.multimodalAnalysisError
        : '本次未启用深度多模态分析。',
    }))
    return {
      items: skipped,
      complete: 0,
      degraded: 0,
      skipped: skipped.length,
      failed: 0,
    }
  }

  const result = new Array<HotItem>(items.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        result[index] = await analyzeHotItem(items[index])
      }
    },
  )
  await Promise.all(workers)

  return {
    items: result,
    complete: result.filter(
      (item) => item.multimodalAnalysisStatus === 'complete',
    ).length,
    degraded: result.filter(
      (item) => item.multimodalAnalysisStatus === 'degraded',
    ).length,
    skipped: result.filter(
      (item) => item.multimodalAnalysisStatus === 'skipped',
    ).length,
    failed: result.filter(
      (item) => item.multimodalAnalysisStatus === 'failed',
    ).length,
  }
}
