import type {
  MultimodalAnalysisBundle,
  SourceMediaKind,
} from './contracts/multimodalAnalysis.ts'
import type { ImageAnalysisPack } from './contracts/imageAnalysis.ts'
import type { ArtifactReference } from './contracts/artifacts.ts'

export type Platform = 'tiktok' | 'meta'
export type TranscriptStatus =
  | 'ok'
  | 'partial'
  | 'missing'
  | 'failed'
  | 'conflict'
  | 'skipped'
export type TranscriptSource =
  | 'provider'
  | 'model'
  | 'gemini'
  | 'human'
  | 'none'
export type TranscriptVerification =
  | 'verified'
  | 'unverified'
  | 'conflict'
  | 'not_applicable'
export type CuratedSourceField =
  | 'theme'
  | 'oneLiner'
  | 'title'
  | 'transcript'
  | 'visualDescription'
export type MultimodalAnalysisStatus =
  | 'analyzing'
  | 'complete'
  | 'degraded'
  | 'skipped'
  | 'failed'

export interface TranscriptConflict {
  providerTranscript: string
  modelTranscript: string
  reason: string
}
/** 制作形态：海报 / 聊天记录 / 视频 */
export type ProduceForm = 'poster' | 'chat' | 'video'
export type MediaFormat = ProduceForm
export type TopicTag = 'travel' | 'cross_culture' | 'language_learning'
export type TrendPeriod = 'day' | 'week' | 'month'
export type PeriodicKind = 'game' | 'anime' | 'idol' | 'variety'

export type IntentFeature =
  | 'chat'
  | 'live-caption'
  | 'translator'
  | 'f2f'
  | 'group-tutorial'

export type CrawlSource = 'likes_top' | 'views_top' | 'topic_tag' | 'periodic'

export type SourceMarketEvidence =
  | 'video_language'
  | 'post_language'
  | 'unknown'
export type SourceMarketConfidence = 'high' | 'medium' | 'low' | 'unknown'
export type TargetMarketSource = 'source_default' | 'user_override'

export type MemeAxis = 'emotion' | 'plot'

export type EmotionTone =
  | 'sweet'
  | 'heartbreak'
  | 'funny'
  | 'warm'
  | 'hype'
  | 'awkward'

export type PlotDevice =
  | 'skit'
  | 'twist'
  | 'short_joke'
  | 'satire'
  | 'misunderstanding'
  | 'slice'

export type SellFitKind = 'direct' | 'rewrite' | 'none'
export type PlacementMode = 'soft' | 'hard'
export type HookStrength = 'strong' | 'medium' | 'weak'

export type CoreSemanticRole =
  | 'premise'
  | 'hook'
  | 'conflict'
  | 'narrative_engine'
  | 'payoff'
  | 'evidence_carrier'
  | 'style'

export type CoreNecessity =
  | 'must_keep'
  | 'should_keep'
  | 'replaceable'
  | 'disposable'

export type ContentRiskType =
  | 'none'
  | 'sensitive_topic'
  | 'factual_uncertainty'
  | 'unsafe_depiction'
  | 'prohibited_behavior'
  | 'brand_copyright'
  | 'identity_privacy'

export type CoreHandling = 'retain' | 'qualify' | 'transform' | 'remove'

export type CorePreservationStrength =
  | 'semantic'
  | 'functional_equivalent'
  | 'exact'
  | 'exact_qualified'

export type CoreRealizationChannel = 'visible' | 'audible'

export type SceneAssetCategory =
  | 'physicalSetting'
  | 'socialConfiguration'
  | 'audienceIdentity'
  | 'emotionalAtmosphere'
  | 'visualStyle'

export type SceneAssetInheritance =
  | 'keep'
  | 'keep_or_adapt'
  | 'transform'
  | 'replaceable'
  | 'drop'

export type SceneAssetProductRelevance = 'direct' | 'indirect' | 'none'

export interface SceneAsset {
  /** 物理场景：地点、空间、室内/户外、前后台、屏幕/现实空间等。 */
  physicalSetting: string
  /** 社交构型：人物数量、关系、互动结构、谁对谁说/看/回应。 */
  socialConfiguration: string
  /** 受众身份/群体标签：只能来自明确文字、口播或上下文，不得从外貌推断。 */
  audienceIdentity: string
  /** 情绪气候：尴尬、安全感、归属、惊讶、压迫、轻松等观看氛围。 */
  emotionalAtmosphere: string
  /** 视觉样式：真人口播、自拍、App UI、动画、蒙太奇、字幕样式、镜头语言等。 */
  visualStyle: string
}

export interface SceneAssetInheritanceDecision {
  asset: SceneAssetCategory
  decision: SceneAssetInheritance
  productRelevance: SceneAssetProductRelevance
  reason: string
  downstreamRequirement: string
  risk?: string
}

export type SourceAdLoopType =
  | 'product_ad'
  | 'story_ad'
  | 'lifestyle_positioning'
  | 'pure_meme'

export type SourceAdProofRole =
  | 'core_solution'
  | 'supporting_demo'
  | 'vibe_only'
  | 'absent'

export type ResultActionType =
  | 'avoidance'
  | 'confirmation'
  | 'completion'
  | 'connection'
  | 'learning'
  | 'emotional_release'
  | 'none'

export type AdLoopInheritanceMode =
  | 'product_swap'
  | 'product_swap_slice'
  | 'proof_reframe'
  | 'proof_repair'
  | 'rewrite'
  | 'structure_build'
  | 'hard'

export interface ResultActionContract {
  taskGoal: string
  userPain: string
  emotionalShift: string
  type: ResultActionType
  action: string
  allowedResultActions: string[]
  forbiddenResultActions: string[]
  reason: string
}

export interface SourceAdLoop {
  hasPainHook: boolean
  hasProductProof: boolean
  hasResultAction: boolean
  hasCta: boolean
  hasCompleteLoop: boolean
  loopType: SourceAdLoopType
  proofRole: SourceAdProofRole
  inheritanceMode: AdLoopInheritanceMode
  painHook: string
  productProof: string
  resultAction: ResultActionContract
  cta: string
  doNotReinventResolution: boolean
  reason: string
}

export interface AdLoopExecution {
  inheritanceMode: AdLoopInheritanceMode
  preserveProofSlot: boolean
  preserveResultAction: boolean
  resultActionContract: ResultActionContract
  doNotReinventResolution: boolean
  reason: string
  downstreamRequirement: string
}

export interface CoreElement {
  id: string
  content: string
  semanticRole: CoreSemanticRole
  necessity: CoreNecessity
  riskType: ContentRiskType
  handling: CoreHandling
  preservationStrength: CorePreservationStrength
  requiredSurfaceTokens: string[]
  requiredQualifierTokens: string[]
  retentionRequirement: string
  transformationBoundary: string
  evidenceRefs: string[]
}

export interface CoreDependency {
  from: string
  to: string
  relation: 'causes' | 'motivates' | 'escalates' | 'enables_payoff' | 'visually_proves'
}

export interface CoreHandlingDecision {
  coreId: string
  decision: CoreHandling | 'omit'
  reason: string
  downstreamRequirement: string
}

export interface RiskTransformationContract {
  retainedSensitiveCore: Array<{
    coreId: string
    retentionRequirement: string
    allowedTreatment: string
  }>
  restrictedExpressions: Array<{ content: string; reason: string }>
  requiredTransformations: Array<{
    coreId: string
    originalExpression: string
    safeTransformation: string
    mustPreserve: string
  }>
  factRequirements: Array<{
    claim: string
    requirement: 'verify' | 'qualify' | 'omit_specific_claim'
  }>
}

export interface CoreCoverageItem {
  coreId: string
  necessity: CoreNecessity
  status: 'retained' | 'qualified' | 'transformed' | 'omitted'
  realization: string
  realizationChannels: CoreRealizationChannel[]
  equivalence: string
  omissionReason: string
}

export interface CreativeContract {
  hook: string
  mechanism: string
  payoff: string
  mustKeep: string[]
  canChange: string[]
  mustAvoid: string[]
  sourceTask: string
}

export interface RewritePlan {
  preserve: string
  insertAt: string
  proofBeat: string
  resultBeat: string
}

export interface ApprovedCoreRealization {
  premise: string
  conflict: string
  narrativeEngine: string
  payoff: string
  safeSurface: string
}

export interface ProductCapabilityGate {
  feature: IntentFeature
  status: 'verified' | 'unverified'
  verifiedCapabilities: string[]
  unverifiedCapabilities: string[]
  coreResolutionRole: 'allowed' | 'supporting_only' | 'forbidden'
  primaryPromise?: string
  proofMode?: string
  featureRole?: string
  relationshipOutcomes?: string[]
  selectedCapability?: string
  socialPayoff?: string
  hardBoundaries?: string[]
  forbiddenClaims?: string[]
  reason: string
}

export interface Market {
  id: string
  name: string
  nameEn: string
  priority: number
  regionCode: string
  languages: string[]
}

export interface HotItem {
  id: string
  /** 素材语言市场：视频语言优先，帖文语言兜底。 */
  sourceMarketId?: string
  sourceLanguage?: string
  sourceMarketEvidence?: SourceMarketEvidence
  sourceMarketConfidence?: SourceMarketConfidence
  /** marketId 继续作为最终投放市场，以兼容现有 Shorts / 提示词链。 */
  targetMarketSource?: TargetMarketSource
  marketId: string
  /** auto waits for verified MM01 ASR/OCR; explicit is the user's campaign context. */
  marketSelection?: 'auto' | 'explicit'
  platform: Platform
  title: string
  likes: number
  views: number
  source: CrawlSource
  topicTags: TopicTag[]
  periodicKind?: PeriodicKind
  formatFit: ProduceForm[]
  /** 50–200 字故事拆解（字幕+标题等） */
  oneLiner: string
  suggestedFeature: IntentFeature
  collectedAt: string
  dedupeKey: string
  /** 原灵感帖链接 */
  sourceUrl?: string
  /** 可由服务端下载的原始素材；与帖子链接、落地页分开保存。 */
  mediaUrl?: string
  /** 兼容旧调用方的有序素材合集。 */
  mediaUrls?: string[]
  /** 独立的视频素材，不包含同一视频的 CDN 备用地址。 */
  videoUrls?: string[]
  /** 独立的静态图片素材。 */
  imageUrls?: string[]
  thumbnailUrl?: string
  mediaKind?: SourceMediaKind
  durationSeconds?: number
  /** Provider 原始标题正文；不与模型生成的一句话故事混用。 */
  caption?: string
  /** 广告落地页；不得覆盖素材来源或媒体直链。 */
  landingUrl?: string
  /** Foreplay 的广告运行时长元数据，不等同于播放量或视频时长。 */
  runningDuration?: number
  /** live = ScrapeCreators 实拉；fallback = 失败兜底可手改 */
  recognition?: 'live' | 'fallback'
  recognitionError?: string
  /** 素材主题（多由字幕+标题推断） */
  theme?: string
  /** 清洗后的口播/字幕正文 */
  transcript?: string
  /** Provider 返回的原始字幕候选，始终与当前采用的字幕分开保存。 */
  providerTranscript?: string
  /** MM01 音轨 ASR 返回的字幕候选，供证据核验与人工复查。 */
  modelTranscript?: string
  transcriptStatus?: TranscriptStatus
  transcriptSource?: TranscriptSource
  transcriptVerification?: TranscriptVerification
  /** Provider 字幕与音轨证据不一致时，双方候选留档但不进入旧解析链路。 */
  transcriptConflict?: TranscriptConflict
  /** 画面理解：抽帧/OCR 得到的视觉描述（画面动作、场景、屏幕叠字等），供 P02 兼顾「演了什么」 */
  visualDescription?: string
  /** 同事链路的 MM01 -> C01 -> P02F -> P02 完整结构化结果。 */
  multimodalAnalysis?: MultimodalAnalysisBundle
  /** 图片专用 IM01 原图识别包；不进入视频 MM01/C01/P02 链路。 */
  imageAnalysis?: ImageAnalysisPack
  /** Durable local archive pointer; media and large results remain server-side. */
  artifact?: ArtifactReference
  /** Archive failure is observable without turning a successful MM01 into an analysis error. */
  artifactWarning?: string
  curatedSourceFields?: CuratedSourceField[]
  multimodalAnalysisStatus?: MultimodalAnalysisStatus
  multimodalAnalysisError?: string
}

export interface CoreMeme {
  core: string
  creativeContract?: CreativeContract
  audienceReason: string
  narrativeEngine: string
  payoffLogic: string
  hotSceneCore?: string
  hookCore?: string
  transferableCore?: string
  sourceSemanticCore?: string
  replaceableSurface: string[]
  forbiddenSurface: string[]
  riskDetails?: string[]
  sceneAsset?: SceneAsset
  assetInheritanceDecision?: SceneAssetInheritanceDecision[]
  sourceAdLoop?: SourceAdLoop
  coreElements?: CoreElement[]
  coreDependencies?: CoreDependency[]
  coreSignature?: string[]
  axis: MemeAxis
  emotionTone?: EmotionTone
  plotDevice?: PlotDevice
  axisReason: string
  hookStrength: HookStrength
  hookReason: string
}

export interface SellFitAssessment {
  kind: SellFitKind
  feature?: IntentFeature
  hardPlacementFeature?: IntentFeature
  featureRanking?: FeatureFitCandidate[]
  reason: string
  primaryPromise?: string
  proofMode?: string
  featureRole?: string
  relationshipOutcome?: string
  selectedCapability?: string
  socialPayoff?: string
  proofTask?: string
  socialOutcome?: string
  rewritePlan?: RewritePlan
  rewrittenScene?: string
  coreHandlingPlan?: CoreHandlingDecision[]
  riskTransformationContract?: RiskTransformationContract
  productCapabilityGate?: ProductCapabilityGate
  adLoopExecution?: AdLoopExecution
  coreCoverage?: CoreCoverageItem[]
  approvedCoreRealization?: ApprovedCoreRealization
  placementOptions: PlacementMode[]
  recommendedPlacement?: PlacementMode
  keepInHotPool: boolean
  returnToHotPool: boolean
  enterScreening: boolean
}

export interface FeatureFitCandidate {
  feature: IntentFeature
  priority: number
  matchScore: number
  primaryPromise?: string
  proofMode?: string
  featureRole?: string
  relationshipOutcome?: string
  selectedCapability?: string
  socialPayoff?: string
  coreRetentionScore?: number
  semanticTradeoff?: string
  coreRealization?: string
  fitKind: SellFitKind
  whyFit: string
  heroProofMoment: string
  rewriteCost: 'low' | 'medium' | 'high'
  risk: string
}

export interface InspirationBreakdown {
  hotItemId: string
  meme: CoreMeme
  fit: SellFitAssessment
  brokenDownAt: string
}

export interface TrendSummary {
  marketId: string
  period: TrendPeriod
  text: string
  updatedAt: string
}

export type MatchStatus =
  | 'matched'
  | 'screened_in'
  | 'screened_out'
  | 'producing'
  | 'pushed'
  | 'rejected'

export interface ContentReview {
  offensePass: boolean
  stereotypePass: boolean
  sellPointClear: boolean
  hasHook: boolean
  hasSellBeat: boolean
  hasDownloadCta: boolean
  notes: string[]
  passed: boolean
}

export interface MatchedCard {
  id: string
  hotItemId: string
  sourceMarketId: string
  targetMarketSource: TargetMarketSource
  isCrossMarketRewrite: boolean
  marketId: string
  platform: Platform
  produceForm: ProduceForm
  feature: IntentFeature
  title: string
  sourceStory: string
  softStory: string
  oneLiner: string
  fitKind: SellFitKind
  placementMode: PlacementMode
  placementOptions: PlacementMode[]
  placementReason: string
  meme: CoreMeme
  fitReason: string
  hook: string
  sellBeat: string
  downloadCta: string
  generatedScript: string
  review: ContentReview
  status: MatchStatus
  toolHint: string
  sourceUrl: string
  machineReviewNote?: string
}
