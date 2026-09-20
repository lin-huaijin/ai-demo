import {
  ANALYSIS_MODE_CONFIDENCE_CAP,
  compileP02FormattedPrompt,
  evaluateMm01EvidenceCoverage,
  parseContextResearchOutput,
  parseMm01AnalysisPack,
  parseP02Breakdown,
  validateMm01CreativeResearchRequirements,
  type AnalysisMode,
  type ContextResearchOutput,
  type Confidence,
  type Mm01AnalysisPack,
  type Mm01EvidenceCoverageEvaluation,
  type Mm01SourceMeta,
  type MultimodalAnalysisBundle,
  type Platform,
  type SourceMediaKind,
} from '../../src/contracts/multimodalAnalysis.ts'
import type {
  AudioInputProvenance,
  PreparedMedia,
  SourceAudioTrackStatus,
} from './media.ts'

export type MultimodalProvider = 'gemini' | 'kimi' | 'seed' | 'fusion'
export type MultimodalProfile =
  | 'gemini'
  | 'kimi-k3'
  | 'seed-2.1-pro'
  | 'fusion'

export interface MultimodalSourceRequest {
  sourceUrl?: string
  mediaUrl?: string
  mediaUrls?: string[]
  videoUrls?: string[]
  imageUrls?: string[]
  mediaKind: SourceMediaKind
  platform?: Platform
  marketId: string
  marketLanguages: string[]
  title: string
  caption: string
  providerTranscript?: string
  durationSeconds?: number
}

export interface ModelTokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
}

export interface ModelCallResult {
  candidates: unknown[]
  usage?: ModelTokenUsage
  reportedModel?: string
  /** Actual upstream requests represented by this result, including format repairs. */
  callCount?: number
}

export interface EvidenceAvailability {
  visual: boolean
  audio: boolean
  asr: boolean
}

export interface ModelEvidencePolicy {
  analysisMode?: AnalysisMode
  availability?: EvidenceAvailability
  /** Reject model claims that depend on a modality the adapter did not send. */
  enforceUnavailableModalities?: boolean
  /** Require an audio-capable video path to preserve and analyze the source audio. */
  requireAudioEvidence?: boolean
}

interface ExecutePipelineOptions {
  provider: MultimodalProvider
  profile: MultimodalProfile
  model: string
  request: MultimodalSourceRequest
  media: PreparedMedia
  policy?: ModelEvidencePolicy
  callMm01: (repairInstruction?: string) => Promise<ModelCallResult>
  callC01: (mm01: Mm01AnalysisPack) => Promise<ModelCallResult>
  callP02: (
    handoff: ReturnType<typeof compileP02FormattedPrompt>,
    mm01: Mm01AnalysisPack,
    contextResearch: ContextResearchOutput,
  ) => Promise<ModelCallResult>
  invalidOutput: (detail: string) => Error
  modelCalls?: number
  models?: NonNullable<MultimodalAnalysisBundle['diagnostics']['models']>
  fusion?: NonNullable<MultimodalAnalysisBundle['diagnostics']['fusion']>
  geminiVideo?: {
    fps: number
    mediaResolution: NonNullable<
      MultimodalAnalysisBundle['diagnostics']['geminiMediaResolution']
    >
  }
}

export class Mm01CoverageError extends Error {
  override name = 'Mm01CoverageError'
  readonly code = 'MM01_INSUFFICIENT_COVERAGE' as const
  readonly evaluation: Mm01EvidenceCoverageEvaluation

  constructor(evaluation: Mm01EvidenceCoverageEvaluation) {
    const required = evaluation.thresholds?.minimumCoverageRatio ?? 1
    super(
      `MM01 direct visual evidence covered ${(evaluation.coverageRatio * 100).toFixed(1)}% ` +
        `of ${evaluation.durationSec.toFixed(1)}s; required ${(required * 100).toFixed(0)}% ` +
        `(${evaluation.reasonCodes.join(', ')})`,
    )
    this.evaluation = evaluation
  }
}

export type Mm01AudioEvidenceFailure =
  | 'audio_input_missing'
  | 'audio_analysis_missing'

export class Mm01AudioEvidenceError extends Error {
  override name = 'Mm01AudioEvidenceError'
  readonly code = 'MM01_AUDIO_EVIDENCE_MISSING' as const
  readonly failure: Mm01AudioEvidenceFailure
  readonly sourceAudioTrack: SourceAudioTrackStatus
  readonly audioInputProvenance: AudioInputProvenance

  constructor(
    failure: Mm01AudioEvidenceFailure,
    sourceAudioTrack: SourceAudioTrackStatus,
    audioInputProvenance: AudioInputProvenance,
  ) {
    super(
      failure === 'audio_input_missing'
        ? `MM01 source audio was not preserved (${sourceAudioTrack}/${audioInputProvenance})`
        : `MM01 did not return usable audio analysis (${sourceAudioTrack}/${audioInputProvenance})`,
    )
    this.failure = failure
    this.sourceAudioTrack = sourceAudioTrack
    this.audioInputProvenance = audioInputProvenance
  }
}

const MAX_MM01_ATTEMPTS = 3

export function analysisModeForPreparedMedia(media: PreparedMedia): AnalysisMode {
  if (media.mode === 'video_inline' || media.mode === 'video_inline_keyframes') {
    return media.warnings.some((warning) => /转码|压缩后|transcod/i.test(warning))
      ? 'compressed_video'
      : 'full_video'
  }
  if (media.mode === 'text_only') return 'text_fallback'
  return 'audio_frames'
}

export function evidenceAvailabilityForPreparedMedia(
  media: PreparedMedia,
): EvidenceAvailability {
  const sourceAudioTrack = media.sourceAudioTrack ?? 'unknown'
  const audioInputProvenance = media.audioInputProvenance ?? 'unknown'
  const modeCanCarryAudio = [
    'video_inline_keyframes',
    'video_inline',
    'video_frames_audio',
    'video_audio',
  ].includes(media.mode)
  const audio =
    sourceAudioTrack !== 'absent' &&
    sourceAudioTrack !== 'not_applicable' &&
    media.audioTrackRemoved !== true &&
    (audioInputProvenance === 'inline_video' ||
      audioInputProvenance === 'separate_audio' ||
      (audioInputProvenance === 'unknown' &&
        sourceAudioTrack === 'unknown' &&
        modeCanCarryAudio))
  return {
    visual: [
      'video_inline_keyframes',
      'video_inline',
      'video_frames_audio',
      'video_frames',
      'image_inline',
    ].includes(media.mode),
    audio,
    asr: audio,
  }
}

function audioRequirementApplies(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
): boolean {
  if (request.mediaKind !== 'video' && request.mediaKind !== 'mixed') return false
  return (media.sourceAudioTrack ?? 'unknown') !== 'not_applicable'
}

function audioAnalysisIsUsable(pack: Mm01AnalysisPack): boolean {
  if (pack.modalityStatus.audio !== 'ok' && pack.modalityStatus.audio !== 'partial') {
    return false
  }
  const isMeaningful = (value: string) =>
    Boolean(value.trim()) &&
    !/^(?:unknown|未知|不明|无法确认|不可用|未确认|n\/?a)/i.test(value.trim())
  const meaningfulEvidenceFact = (fact: string) =>
    isMeaningful(
      fact.replace(
        /^【(?:明确证据|高概率暗线\/隐喻|待核验\/纯猜测)】\s*/,
        '',
      ),
    )
  return Boolean(
    isMeaningful(pack.cleanedInputsForP02.audioDescription) ||
      pack.sceneSegments.some(
        (segment) =>
          isMeaningful(segment.audio.musicMood) ||
          isMeaningful(segment.audio.voiceTone) ||
          segment.audio.sfx.some(isMeaningful) ||
          segment.evidence.some(
            (evidence) =>
              (evidence.type === 'audio' || evidence.source === 'audio') &&
              meaningfulEvidenceFact(evidence.fact),
          ),
      ),
  )
}

function audioEvidenceError(
  media: PreparedMedia,
  failure: Mm01AudioEvidenceFailure,
): Mm01AudioEvidenceError {
  return new Mm01AudioEvidenceError(
    failure,
    media.sourceAudioTrack ?? 'unknown',
    media.audioInputProvenance ?? 'unknown',
  )
}

/** Fail before a paid model call when a video audio track was not preserved. */
export function assertRequiredAudioInput(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  availability = evidenceAvailabilityForPreparedMedia(media),
): void {
  // Old persisted/test fixtures may predate audio provenance. Real media
  // preparation always sets both fields, so do not reinterpret legacy data.
  if (
    media.sourceAudioTrack === undefined &&
    media.audioInputProvenance === undefined
  ) {
    return
  }
  if (
    audioRequirementApplies(request, media) &&
    media.sourceAudioTrack !== 'absent' &&
    !availability.audio
  ) {
    throw audioEvidenceError(media, 'audio_input_missing')
  }
}

/** Extract only timestamps whose following image payload survived request budgeting. */
export function sampledVisualTimestampsForPreparedMedia(
  media: Pick<PreparedMedia, 'parts'>,
): number[] {
  const timestamps: number[] = []
  let pendingTimestamp: number | undefined
  for (const part of media.parts) {
    if ('text' in part) {
      const match = /关键帧时间：\s*(\d+(?:\.\d+)?)\s*秒/.exec(part.text)
      pendingTimestamp = match ? Number(match[1]) : undefined
      continue
    }
    if (
      pendingTimestamp !== undefined &&
      part.inlineData.mimeType.startsWith('image/')
    ) {
      timestamps.push(pendingTimestamp)
    }
    pendingTimestamp = undefined
  }
  return [...new Set(timestamps)].sort((left, right) => left - right)
}

function platformFromRequest(request: MultimodalSourceRequest): Platform {
  if (request.platform) return request.platform
  const source = request.sourceUrl?.toLowerCase() ?? ''
  if (source.includes('tiktok.com')) return 'tiktok'
  if (source.includes('youtube.com') || source.includes('youtu.be')) return 'youtube'
  if (
    source.includes('instagram.com') ||
    source.includes('facebook.com') ||
    source.includes('fb.watch')
  ) {
    return 'meta'
  }
  return 'unknown'
}

function authoritativeSourceMeta(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
): Mm01SourceMeta {
  return {
    platform: platformFromRequest(request),
    sourceUrl: request.sourceUrl ?? '',
    marketId: request.marketId,
    marketLanguages: [...request.marketLanguages],
    title: request.title,
    caption: request.caption,
    // Only a locally probed duration is authoritative enough for the P02 gate.
    // Provider/client metadata remains context, never proof of timeline coverage.
    durationSec: media.durationSeconds ?? 0,
  }
}

export function multimodalContextText(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  analysisMode: AnalysisMode,
  confidenceCap: Confidence,
  availability = evidenceAvailabilityForPreparedMedia(media),
): string {
  const duration = media.durationSeconds
  const inspectionWindows = (() => {
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
      return ''
    }
    const targetSpan =
      duration <= 15 ? 5 : duration <= 60 ? 8 : duration <= 180 ? 12 : 18
    const count = Math.max(1, Math.ceil(duration / targetSpan))
    const span = duration / count
    return Array.from({ length: count }, (_, index) => {
      const start = index * span
      const end = index === count - 1 ? duration : (index + 1) * span
      return `${start.toFixed(1)}-${end.toFixed(1)}s`
    }).join('、')
  })()
  return [
    '请整理已附素材。输入顺序固定为“整片/独立音轨 → 时间标签关键帧 → 本文本上下文”。',
    '必须从完整时间轴理解素材，sceneSegments 不得只停留在前段；应覆盖开头、中段和结尾。',
    '每个计入时间轴覆盖的 timeRange 必须含直接画面或 OCR 证据，音频/ASR 不能代替画面覆盖；不得为通过校验而虚构或拉长区间。',
    '即使是长镜头也要按时间检查点拆分：视频≤15/≤60/≤180/＞180 秒时，每段上限分别为 6/10/15/20 秒。',
    inspectionWindows
      ? `服务端强制逐窗检查：${inspectionWindows}。必须逐一检查并为每个可见窗口分别建立 sceneSegment；可以在窗口内继续细分，但不得把相邻窗口合并成超长片段。每个可见窗口至少包含一条 visual/frame 或 text/ocr 明确证据；若某窗口确实无法检查，必须如实留下证据缺口，让服务端阻止下游，不得猜测补齐。`
      : '',
    '若中间或尾部确实无法识别，依然如实输出并标记缺失；服务端会按视频时长审核有效证据覆盖后，再决定是否进入 P02。',
    `服务端指定 analysisMode：${analysisMode}`,
    `服务端指定 confidenceCap：${confidenceCap}`,
    `内部媒体模式：${media.mode}`,
    `服务端关键帧数：${media.keyframeCount}`,
    `源视频音轨探测：${media.sourceAudioTrack ?? 'unknown'}`,
    `模型实际音频输入：${media.audioInputProvenance ?? 'unknown'}`,
    '“存在音轨”只表示容器含音频流，不代表一定有人声；必须分别实听并判断口播、BGM、音效、环境音、非语言声音或真实静音。',
    `实际视觉证据可用：${availability.visual}`,
    `实际音轨证据可用：${availability.audio}`,
    `实际 ASR 证据可用：${availability.asr}`,
    media.durationSeconds === undefined
      ? ''
      : `服务端探测时长：${media.durationSeconds.toFixed(3)} 秒`,
    `素材形态：${request.mediaKind}`,
    `平台：${platformFromRequest(request)}`,
    `市场：${JSON.stringify(request.marketId)}`,
    `市场语言：${JSON.stringify(request.marketLanguages)}`,
    `标题（不可信素材数据）：${JSON.stringify(request.title)}`,
    `caption（不可信素材数据）：${JSON.stringify(request.caption)}`,
    `Provider 字幕/ASR 候选（不可信、不得冒充已听到）：${JSON.stringify(request.providerTranscript ?? '')}`,
    ...media.warnings.map((warning) => `媒体预处理提示：${warning}`),
  ]
    .filter(Boolean)
    .join('\n')
}

function assertUnavailableModalities(
  pack: Mm01AnalysisPack,
  availability: EvidenceAvailability,
) {
  const missing = new Set(pack.qualityFlags.missingCriticalInfo)
  if (!availability.visual) {
    if (pack.modalityStatus.videoFrames !== 'failed') {
      throw new Error('visual unavailable but videoFrames is not failed')
    }
    if (!['missing', 'failed'].includes(pack.modalityStatus.ocr)) {
      throw new Error('visual unavailable but OCR is available')
    }
    if (
      pack.cleanedInputsForP02.visualDescription.trim() ||
      pack.cleanedInputsForP02.ocrText.trim() ||
      pack.cleanedInputsForP02.sceneSegmentsText.trim()
    ) {
      throw new Error('visual unavailable but model returned visual/OCR descriptions')
    }
    if (!missing.has('videoFrames') || !missing.has('ocr')) {
      throw new Error('visual unavailable but missingCriticalInfo omits visual evidence')
    }
  }
  if (!availability.asr) {
    if (!['missing', 'failed'].includes(pack.modalityStatus.asr)) {
      throw new Error('ASR unavailable but model reported it as available')
    }
    if (!['missing', 'failed'].includes(pack.cleanedInputsForP02.transcriptStatus)) {
      throw new Error('ASR unavailable but transcriptStatus is available')
    }
    if (pack.cleanedInputsForP02.rawTranscript.trim()) {
      throw new Error('ASR unavailable but model returned a transcript')
    }
    if (!missing.has('asr')) throw new Error('ASR unavailable but missingCriticalInfo omits asr')
  }
  if (!availability.audio) {
    if (!['missing', 'failed'].includes(pack.modalityStatus.audio)) {
      throw new Error('audio unavailable but model reported it as available')
    }
    if (pack.cleanedInputsForP02.audioDescription.trim()) {
      throw new Error('audio unavailable but model returned an audio description')
    }
    if (!missing.has('audio')) {
      throw new Error('audio unavailable but missingCriticalInfo omits audio')
    }
  }
  for (const segment of pack.sceneSegments) {
    if (
      !availability.visual &&
      (segment.visual.people.trim() ||
        segment.visual.setting.trim() ||
        segment.visual.productOrObject.trim() ||
        segment.visual.camera.trim() ||
        segment.visual.style.trim() ||
        segment.ocr.texts.length > 0)
    ) {
      throw new Error('visual unavailable but a scene contains visual/OCR claims')
    }
    if (!availability.asr && segment.asr.speech.trim()) {
      throw new Error('ASR unavailable but a scene contains speech')
    }
    if (
      !availability.audio &&
      (segment.audio.musicMood.trim() ||
        segment.audio.sfx.length > 0 ||
        segment.audio.voiceTone.trim())
    ) {
      throw new Error('audio unavailable but a scene contains audio claims')
    }
    for (const evidence of segment.evidence) {
      if (
        (!availability.visual &&
          (evidence.type === 'visual' ||
            evidence.type === 'text' ||
            evidence.source === 'frame' ||
            evidence.source === 'ocr')) ||
        (!availability.asr && (evidence.type === 'speech' || evidence.source === 'asr')) ||
        (!availability.audio && (evidence.type === 'audio' || evidence.source === 'audio'))
      ) {
        throw new Error('model returned evidence from an unavailable modality')
      }
    }
  }
}

function authoritativeMm01(
  raw: unknown,
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  policy: ModelEvidencePolicy,
): Mm01AnalysisPack {
  const modelPack = parseMm01AnalysisPack(raw, { skipSceneCoverage: true })
  const analysisMode = policy.analysisMode ?? analysisModeForPreparedMedia(media)
  if (policy.enforceUnavailableModalities && policy.availability) {
    assertUnavailableModalities(modelPack, policy.availability)
  }
  const topicGuess = /^(?:【明确证据】|【高概率暗线\/隐喻】|【待核验\/纯猜测】)/.test(
    modelPack.globalUnderstanding.topicGuess,
  )
    ? modelPack.globalUnderstanding.topicGuess
    : `【高概率暗线/隐喻】${modelPack.globalUnderstanding.topicGuess}`
  return validateMm01CreativeResearchRequirements({
    ...modelPack,
    sourceMeta: authoritativeSourceMeta(request, media),
    modalityStatus: {
      ...modelPack.modalityStatus,
      analysisMode,
      confidenceCap: ANALYSIS_MODE_CONFIDENCE_CAP[analysisMode],
    },
    globalUnderstanding: {
      ...modelPack.globalUnderstanding,
      // A global synthesis necessarily mixes direct observations and
      // interpretation. Conservatively label an omitted prefix as inference
      // instead of rejecting an otherwise evidence-complete MM01 result.
      topicGuess,
    },
  })
}

function validatedContextResearch(
  raw: unknown,
  mm01: Mm01AnalysisPack,
): ContextResearchOutput {
  return parseContextResearchOutput(raw, mm01)
}

function selectValidatedCandidate<T>(
  candidates: unknown[],
  validate: (candidate: unknown) => T,
  stage: 'MM01' | 'C01' | 'P02',
  invalidOutput: (detail: string) => Error,
): T {
  let firstValidationError: unknown
  const validated = new Map<string, T>()
  for (const candidate of candidates) {
    try {
      const value = validate(candidate)
      validated.set(JSON.stringify(value), value)
    } catch (error) {
      firstValidationError ??= error
    }
  }
  if (validated.size === 1) return validated.values().next().value as T
  if (validated.size > 1) {
    throw invalidOutput(`${stage} returned ambiguous contract-valid JSON candidates`)
  }
  const detail =
    firstValidationError instanceof Error
      ? firstValidationError.message.slice(0, 600)
      : 'unknown contract error'
  throw invalidOutput(`${stage} returned no contract-valid JSON candidate: ${detail}`)
}

function isMm01CoverageFailure(error: unknown): boolean {
  if (error instanceof Mm01CoverageError) return true
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('MM01') &&
    (message.includes('coverage') ||
      message.includes('sceneSegments') ||
      message.includes('timeline'))
  )
}

function isMm01ContractFailure(error: unknown): boolean {
  if (error instanceof Mm01CoverageError) return true
  if (error instanceof Mm01AudioEvidenceError) {
    return error.failure === 'audio_analysis_missing'
  }
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
  if (code.endsWith('_INVALID_OUTPUT')) return true
  const message = error instanceof Error ? error.message : String(error)
  return isMm01CoverageFailure(error) || (
    message.includes('MM01') &&
    (message.includes('contract-valid JSON candidate') ||
      message.includes('importanceScore') ||
      message.includes('missing keys') ||
      message.includes('unexpected keys'))
  )
}

function buildMm01RepairInstruction(
  request: MultimodalSourceRequest,
  media: PreparedMedia,
  attempt: number,
  error: unknown,
): string {
  const durationSec = media.durationSeconds ?? request.durationSeconds ?? 0
  const message = error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800)
  const coverage = isMm01CoverageFailure(error)
  const audio =
    error instanceof Mm01AudioEvidenceError &&
    error.failure === 'audio_analysis_missing'
  return [
    `MM01 质量闸触发：第 ${attempt} 次输出未通过运行时契约。`,
    `失败原因：${message}`,
    '请重新观看/检查同一份素材并输出一个全新的 MM01 JSON。',
    coverage && durationSec > 0
      ? `本次必须从 0.0s 覆盖到 ${durationSec.toFixed(3)}s 附近，允许最多 0.5s 时间戳四舍五入误差。`
      : coverage
        ? '本次必须从 0.0s 覆盖到视频实际结尾。'
        : '',
    coverage
      ? '必须重新检查开头、中段和结尾，并为每个直接画面结论提供与真实视频/服务端采样点相符的时间范围；不得用一张关键帧虚构整段连续画面。'
      : '',
    audio
      ? '本次确实收到带原音轨的完整视频；必须重新听取并填写可核验的人声、音乐、音效、环境音和声画关系，不能把 audio/asr 留空或标成缺失。'
      : '',
    'attentionMap.importanceScore 必须是 JSON number 整数 1、2、3、4 或 5；不能用小数、字符串或百分制。',
    'targetNextPrompt 必须为 C01；eventTimeline、narrativeMap、attentionMap、contextGaps、interpretationCandidates、crossModalChecks 都必须完整存在。',
    '仍然只整理证据，不要写 story、coreHook、卖点匹配、改写方向或制作脚本。',
  ].filter(Boolean).join('\n')
}

export function sumModelUsage(
  left: ModelTokenUsage | undefined,
  right: ModelTokenUsage | undefined,
): ModelTokenUsage | undefined {
  const keys = [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'cachedInputTokens',
  ] as const
  const result: ModelTokenUsage = {}
  for (const key of keys) {
    const values = [left?.[key], right?.[key]].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    )
    if (values.length > 0) result[key] = values.reduce((sum, value) => sum + value, 0)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Treat provider model identifiers as untrusted metadata, never credentials. */
export function sanitizedReportedModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const model = value.trim()
  const hasControlCharacter = [...model].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
  if (!model || model.length > 160 || hasControlCharacter) return undefined
  return model
}

/** Execute MM01 -> C01 -> local deterministic P02F -> P02. */
export async function executeMultimodalPipeline(
  options: ExecutePipelineOptions,
): Promise<MultimodalAnalysisBundle> {
  const startedAt = Date.now()
  const policy = options.policy ?? {}
  const availability =
    policy.availability ?? evidenceAvailabilityForPreparedMedia(options.media)
  const requireAudioEvidence =
    policy.requireAudioEvidence === true &&
    audioRequirementApplies(options.request, options.media) &&
    options.media.sourceAudioTrack !== 'absent'
  if (requireAudioEvidence) {
    assertRequiredAudioInput(options.request, options.media, availability)
  }
  let mm01Call: ModelCallResult | undefined
  let mm01: Mm01AnalysisPack | undefined
  let mm01Usage: ModelTokenUsage | undefined
  let mm01Failure: unknown
  let mm01ModelCalls = 0
  for (let attempt = 1; attempt <= MAX_MM01_ATTEMPTS; attempt += 1) {
    const repairInstruction =
      attempt === 1
        ? undefined
        : buildMm01RepairInstruction(
            options.request,
            options.media,
            attempt - 1,
            mm01Failure,
          )
    try {
      mm01Call = await options.callMm01(repairInstruction)
      mm01ModelCalls +=
        mm01Call.callCount ?? Math.max(1, (options.modelCalls ?? 2) - 1)
      mm01Usage = sumModelUsage(mm01Usage, mm01Call.usage)
      const candidate = selectValidatedCandidate(
        mm01Call.candidates,
        (candidate) => authoritativeMm01(candidate, options.request, options.media, policy),
        'MM01',
        options.invalidOutput,
      )

      if (requireAudioEvidence && !audioAnalysisIsUsable(candidate)) {
        throw audioEvidenceError(options.media, 'audio_analysis_missing')
      }

      const evidenceCoverage = evaluateMm01EvidenceCoverage(candidate, {
        mediaKind: options.request.mediaKind,
        mediaMode: options.media.mode,
        availability,
        sampledVisualTimestampsSec: sampledVisualTimestampsForPreparedMedia(
          options.media,
        ),
      })
      if (evidenceCoverage.status === 'blocked') {
        throw new Mm01CoverageError(evidenceCoverage)
      }

      mm01 = candidate
      break
    } catch (error) {
      mm01Failure = error
      if (attempt >= MAX_MM01_ATTEMPTS || !isMm01ContractFailure(error)) {
        throw error
      }
    }
  }
  if (!mm01 || !mm01Call) throw mm01Failure ?? options.invalidOutput('MM01 did not run')

  const c01Call = await options.callC01(mm01)
  const contextResearch = selectValidatedCandidate(
    c01Call.candidates,
    (candidate) => validatedContextResearch(candidate, mm01),
    'C01',
    options.invalidOutput,
  )

  // P02F is deliberately local and deterministic. It is never model-generated.
  const p02Handoff = compileP02FormattedPrompt(mm01, contextResearch)
  const p02Call = await options.callP02(p02Handoff, mm01, contextResearch)
  const p02 = selectValidatedCandidate(
    p02Call.candidates,
    (candidate) =>
      parseP02Breakdown(candidate, {
        confidenceCap: mm01.modalityStatus.confidenceCap,
        transcriptStatus: mm01.cleanedInputsForP02.transcriptStatus,
        mm01,
        allowLegacyEvidenceWithoutReference: false,
        contextResearch,
      }),
    'P02',
    options.invalidOutput,
  )

  const diagnostics: MultimodalAnalysisBundle['diagnostics'] = {
    provider: options.provider,
    profile: options.profile,
    model: options.model,
    mediaMode: options.media.mode,
    elapsedMs: Date.now() - startedAt,
    modelCalls:
      mm01ModelCalls + (c01Call.callCount ?? 1) + (p02Call.callCount ?? 1),
    keyframeCount: options.media.keyframeCount,
  }
  if (options.media.sourceAudioTrack !== undefined) {
    diagnostics.sourceAudioTrack = options.media.sourceAudioTrack
  }
  if (options.media.audioInputProvenance !== undefined) {
    diagnostics.audioInputProvenance = options.media.audioInputProvenance
  }
  const reportedModels: NonNullable<
    MultimodalAnalysisBundle['diagnostics']['reportedModels']
  > = []
  if (mm01Call.reportedModel) {
    reportedModels.push({ stage: 'mm01', model: mm01Call.reportedModel })
  }
  if (c01Call.reportedModel) {
    reportedModels.push({ stage: 'c01', model: c01Call.reportedModel })
  }
  if (p02Call.reportedModel) {
    reportedModels.push({ stage: 'p02', model: p02Call.reportedModel })
  }
  if (reportedModels.length > 0) diagnostics.reportedModels = reportedModels
  if (options.models) diagnostics.models = options.models
  if (options.fusion) diagnostics.fusion = options.fusion
  if (options.geminiVideo) {
    diagnostics.geminiVideoFps = options.geminiVideo.fps
    diagnostics.geminiMediaResolution = options.geminiVideo.mediaResolution
  }
  if (options.media.durationSeconds !== undefined) {
    diagnostics.durationSeconds = options.media.durationSeconds
  }
  const usage = sumModelUsage(
    sumModelUsage(mm01Usage, c01Call.usage),
    p02Call.usage,
  )
  if (usage) diagnostics.usage = usage
  return { mm01, contextResearch, p02Handoff, p02, diagnostics }
}
