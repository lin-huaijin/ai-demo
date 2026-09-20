import type {
  CoreMeme,
  CreativeContract,
  EmotionTone,
  FeatureFitCandidate,
  HotItem,
  InspirationBreakdown,
  IntentFeature,
  PlotDevice,
  RewritePlan,
  SellFitAssessment,
} from '../types'
import { SHORTS_FEATURE_SPECS } from '../data/features'

const EMOTION_RULES: { re: RegExp; tone: EmotionTone }[] = [
  { re: /甜|心动|告白/, tone: 'sweet' },
  { re: /虐|分手|心痛/, tone: 'heartbreak' },
  { re: /搞笑|笑死|社死|崩溃|meme/i, tone: 'funny' },
  { re: /温暖|感动|治愈|亲情/, tone: 'warm' },
  { re: /燃|热血|冲/, tone: 'hype' },
  { re: /尴尬|卡壳|无力/, tone: 'awkward' },
]

const PLOT_RULES: { re: RegExp; device: PlotDevice }[] = [
  { re: /反转/, device: 'twist' },
  { re: /讽刺|吐槽/, device: 'satire' },
  { re: /误会|谐音|假朋友/, device: 'misunderstanding' },
  { re: /段子|笑话|词卡|对比/, device: 'short_joke' },
  { re: /情景|故事|拦|点餐|问路|开黑/, device: 'skit' },
]

const LANG_SIGNAL =
  /翻译|语言|外语|英语|母语|跨语|沟通|口音|输入法|字幕|双语|说话|听不懂|词穷/

const SCENE_REWRITE_SIGNAL =
  /世界杯|球迷|开黑|游戏|偶像|粉丝|综艺|旅行|机场|点餐|公路|应援|见面/

const LIVE_UNDERSTANDING_SIGNAL =
  /听懂|听不懂|字幕|口令|号召|广播|喊话|现场|同传|caption|subtitle|transcribe|chant|call/i

const PARTICIPATION_FORMAT_SIGNAL =
  /(?:一起|加入|参与|跟上|join|participate).*(?:舞|动作|节奏|音乐|口令|现场|challenge|dance)|(?:舞|动作|节奏|音乐|口令|现场|challenge|dance).*(?:一起|加入|参与|跟上|join|participate)/i

const MESSAGE_TASK_SIGNAL =
  /聊天|私信|消息|气泡|评论|回复|不知道怎么说|尬聊|ai|buddy|dm|message|chat|comment|reply/i

const TEXT_TRANSLATION_TASK_SIGNAL =
  /翻译器|粘贴|麦克风|菜单|路牌|截图|图片翻译|拍照翻译|文字|translator|paste|image translation|menu|sign/i

const FEATURE_PRIORITY: IntentFeature[] = [
  'chat',
  'live-caption',
  'translator',
  'f2f',
  'group-tutorial',
]

function p02NarrativeMechanics(item: HotItem) {
  if (item.transcriptVerification === 'conflict') return undefined
  return item.multimodalAnalysis?.p02.narrativeMechanics
}

function isVideoItem(item: HotItem): boolean {
  if (item.mediaKind === 'video' || item.mediaKind === 'mixed') return true
  if (
    item.mediaKind === 'image' ||
    item.mediaKind === 'carousel' ||
    item.mediaKind === 'text'
  ) return false
  return item.transcriptStatus !== 'skipped'
}

function stamp() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function assessHookStrength(
  item: HotItem,
  signalHits: number,
): Pick<CoreMeme, 'hookStrength' | 'hookReason'> {
  const strongEngagement = item.likes >= 10_000 || item.views >= 100_000
  const breakoutEngagement = item.likes >= 50_000 || item.views >= 500_000
  const hasUsableClimax = signalHits > 0 || (item.transcript?.length ?? 0) >= 40

  if (hasUsableClimax && (breakoutEngagement || strongEngagement)) {
    return {
      hookStrength: 'strong',
      hookReason: '互动数据强，且素材中存在可独立保留的冲突、情绪峰值或反转，适合测试硬切。',
    }
  }
  if (strongEngagement && !hasUsableClimax) {
    return {
      hookStrength: 'medium',
      hookReason: '互动数据很强，但当前文本无法定位具体高潮；可进入硬植入候选，制作前须人工确认画面节拍或动作峰值。',
    }
  }
  if (hasUsableClimax) {
    return {
      hookStrength: 'medium',
      hookReason: '具备可识别的冲突或情绪推进，但爆点强度仍需人工确认。',
    }
  }
  return {
    hookStrength: 'weak',
    hookReason: '素材缺少清晰冲突、情绪峰值或数据证明，不建议单独承担硬植入开场。',
  }
}

function deriveSourceTask(text: string): string {
  if (
    LIVE_UNDERSTANDING_SIGNAL.test(text) ||
    PARTICIPATION_FORMAT_SIGNAL.test(text)
  ) {
    return '理解现场语言、声音或号召，并据此参与后续互动。'
  }
  if (MESSAGE_TASK_SIGNAL.test(text)) {
    return '理解或组织一条社交消息，让对话继续。'
  }
  if (TEXT_TRANSLATION_TASK_SIGNAL.test(text)) {
    return '把可见文字或待表达内容转成对方能理解的语言。'
  }
  return '把原素材的观看动机转成一次人与人之间可继续的互动。'
}

function buildCreativeContract(args: {
  hook: string
  mechanism: string
  payoff: string
  canChange: string[]
  mustAvoid: string[]
  sourceTask: string
}): CreativeContract {
  return {
    hook: args.hook,
    mechanism: args.mechanism,
    payoff: args.payoff,
    mustKeep: [args.hook, args.mechanism, args.payoff].filter(Boolean),
    canChange: args.canChange,
    mustAvoid: args.mustAvoid,
    sourceTask: args.sourceTask,
  }
}

/** 提取核心梗：情绪为主 vs 剧情故事为主（优先字幕故事） */
export function extractCoreMeme(item: HotItem): CoreMeme {
  const text = `${item.theme ?? ''} ${item.title} ${item.oneLiner} ${item.transcript ?? ''}`
  let emotionTone: EmotionTone | undefined
  let plotDevice: PlotDevice | undefined
  let emotionHits = 0
  let plotHits = 0

  for (const rule of EMOTION_RULES) {
    if (rule.re.test(text)) {
      emotionHits += 1
      emotionTone ??= rule.tone
    }
  }
  for (const rule of PLOT_RULES) {
    if (rule.re.test(text)) {
      plotHits += 1
      plotDevice ??= rule.device
    }
  }
  const rawSignalHits = emotionHits + plotHits

  // 图文段子默认偏剧情；强情绪 POV 偏情绪
  if (emotionHits === 0 && plotHits === 0) {
    if (item.formatFit.length === 1 && item.formatFit[0] === 'poster') {
      plotHits = 1
      plotDevice = 'short_joke'
    } else if (item.transcript) {
      plotHits = 1
      plotDevice = 'skit'
    } else {
      emotionHits = 1
      emotionTone = 'funny'
    }
  }

  const axis = plotHits >= emotionHits ? 'plot' : 'emotion'
  const coreSeed = item.theme
    ? `${item.theme}｜${item.oneLiner}`
    : item.oneLiner
  const core = coreSeed.slice(0, 56)
  const p02Mechanics = p02NarrativeMechanics(item)
  const audienceReason =
    p02Mechanics?.audienceReason || (axis === 'plot'
      ? '观众会继续看，是因为开场冲突或异常信息制造了后续反转/解释期待。'
      : '观众会继续看，是因为角色情绪或关系张力在开场形成代入感。')
  const narrativeEngine =
    p02Mechanics?.narrativeEngine || (axis === 'plot'
      ? `剧情靠${plotDevice ?? '冲突推进'}运转：先建立问题，再用动作、信息差或转折兑现结果。`
      : `情绪靠${emotionTone ?? '情绪递进'}运转：先建立感受，再通过互动或结果完成情绪落点。`)
  const payoffLogic =
    p02Mechanics?.payoffLogic || (axis === 'plot'
      ? '结尾必须让前面的冲突、信息差、道具或行为获得新含义，否则保核失败。'
      : '结尾必须让前面的情绪张力得到回应、反差或释放，否则保核失败。')
  const replaceableSurface = p02Mechanics?.replaceableSurface ?? [
    '具体地点',
    '具体道具',
    '人物外形',
    '表层话题',
    '视觉包装',
  ]
  const forbiddenSurface = p02Mechanics?.forbiddenSurface ?? [
    '原人物脸',
    '原品牌/商品',
    '原账号水印',
    '原台词逐字复刻',
    '原 CTA',
  ]
  const p02 = item.multimodalAnalysis?.p02
  const hotSceneCore = p02?.sourceFactSummary || item.oneLiner
  const hookCore = p02?.coreHook || item.theme || item.title
  const sourceSemanticCore = p02?.story || item.oneLiner
  const transferableCore = `${narrativeEngine} ${payoffLogic}`
  const sourceTask = deriveSourceTask(`${text} ${hotSceneCore} ${hookCore} ${transferableCore}`)
  const creativeContract = buildCreativeContract({
    hook: hookCore,
    mechanism: narrativeEngine,
    payoff: payoffLogic,
    canChange: replaceableSurface,
    mustAvoid: forbiddenSurface,
    sourceTask,
  })
  const sceneAsset: NonNullable<CoreMeme['sceneAsset']> = {
    physicalSetting: `由上游事实摘要承载的物理/屏幕场景：${hotSceneCore}`,
    socialConfiguration: '确定性 fallback 仅保守继承原片人物互动结构；具体人数与关系等待 P05 模型细分。',
    audienceIdentity: '未明确；确定性 fallback 不从外貌或表层风格推断身份/社群标签。',
    emotionalAtmosphere: audienceReason,
    visualStyle: '确定性 fallback 仅保守标记为可适配视觉包装；动画、App UI、口播等具体画风等待 P05 模型细分。',
  }
  const assetInheritanceDecision: NonNullable<CoreMeme['assetInheritanceDecision']> = [
    {
      asset: 'physicalSetting',
      decision: 'replaceable',
      productRelevance: 'indirect',
      reason: '物理场景通常是冲突载体，未经过模型细分前不默认整包继承。',
      downstreamRequirement: 'P06/P07 可替换空间，但必须保留同等冲突承载功能。',
      risk: '',
    },
    {
      asset: 'socialConfiguration',
      decision: 'keep_or_adapt',
      productRelevance: 'indirect',
      reason: '人物关系和互动链往往影响 audienceReason 与 narrativeEngine。',
      downstreamRequirement: '尽量保留关系形状；如改写，需说明如何继续驱动原叙事机制。',
      risk: '',
    },
    {
      asset: 'audienceIdentity',
      decision: 'transform',
      productRelevance: 'none',
      reason: '确定性 fallback 不足以证明身份/社群标签与产品直接相关，避免误继承投放人群身份。',
      downstreamRequirement: '不得保留未经明确证明且与产品无关的身份标签，只继承底层情绪或社交机制。',
      risk: 'identity_privacy',
    },
    {
      asset: 'emotionalAtmosphere',
      decision: 'keep_or_adapt',
      productRelevance: 'indirect',
      reason: '情绪气候通常是观众继续观看的关键资产。',
      downstreamRequirement: 'P07/P09 应把情绪气候落成可见表情、节奏、语气或音乐氛围。',
      risk: '',
    },
    {
      asset: 'visualStyle',
      decision: 'keep_or_adapt',
      productRelevance: 'indirect',
      reason: '视觉样式可能驱动停手与记忆点，但 fallback 无法精确确认具体画风。',
      downstreamRequirement: '若上游明确为动画、App UI、口播或字幕卡点，P07/P09 应保留或品牌化改造。',
      risk: '',
    },
  ]
  const sourceAdLoop: NonNullable<CoreMeme['sourceAdLoop']> = {
    hasPainHook: true,
    hasProductProof: false,
    hasResultAction: false,
    hasCta: false,
    hasCompleteLoop: false,
    loopType: 'pure_meme',
    proofRole: 'absent',
    inheritanceMode: 'rewrite',
    painHook: hookCore,
    productProof: '',
    resultAction: {
      taskGoal: '',
      userPain: '',
      emotionalShift: audienceReason,
      type: 'none',
      action: '',
      allowedResultActions: [],
      forbiddenResultActions: [],
      reason: '确定性 fallback 无法证明原素材已有完整产品广告闭环；等待 P05 模型细分。',
    },
    cta: '',
    doNotReinventResolution: false,
    reason: '确定性 fallback 只保守识别钩子，不把素材默认判为完整广告闭环。',
  }
  const coreElements: NonNullable<CoreMeme['coreElements']> = [
    {
      id: 'C1',
      content: sourceSemanticCore,
      semanticRole: 'premise',
      necessity: 'must_keep',
      riskType: 'none',
      handling: 'retain',
      preservationStrength: 'semantic',
      requiredSurfaceTokens: [],
      requiredQualifierTokens: [],
      retentionRequirement: '保留原素材建立冲突与观众期待的具体语义前提。',
      transformationBoundary: '可以调整人物、地点、品牌和措辞，不得改成无关的普通使用场景。',
      evidenceRefs: p02?.narrativeMechanics.evidenceRefs ?? [],
    },
    {
      id: 'C2',
      content: narrativeEngine,
      semanticRole: 'narrative_engine',
      necessity: 'must_keep',
      riskType: 'none',
      handling: 'retain',
      preservationStrength: 'functional_equivalent',
      requiredSurfaceTokens: [],
      requiredQualifierTokens: [],
      retentionRequirement: '保留原素材推动信息、动作或情绪升级的叙事机制。',
      transformationBoundary: '允许压缩节拍，不得改变冲突如何升级以及观众为何继续观看。',
      evidenceRefs: p02?.narrativeMechanics.evidenceRefs ?? [],
    },
    {
      id: 'C3',
      content: payoffLogic,
      semanticRole: 'payoff',
      necessity: 'must_keep',
      riskType: 'none',
      handling: 'retain',
      preservationStrength: 'functional_equivalent',
      requiredSurfaceTokens: [],
      requiredQualifierTokens: [],
      retentionRequirement: '结尾必须兑现原素材建立的同类期待、反转或情绪落点。',
      transformationBoundary: '可以更换视觉载体，不得把原反转降级成普通功能成功演示。',
      evidenceRefs: p02?.narrativeMechanics.evidenceRefs ?? [],
    },
    {
      id: 'C4',
      content: hotSceneCore,
      semanticRole: 'evidence_carrier',
      necessity: 'replaceable',
      riskType: 'none',
      handling: 'transform',
      preservationStrength: 'functional_equivalent',
      requiredSurfaceTokens: [],
      requiredQualifierTokens: [],
      retentionRequirement: '保留能够让观众识别冲突与结果的可拍动作或画面功能。',
      transformationBoundary: '具体人物、品牌、道具和视觉包装可以安全替换。',
      evidenceRefs: p02?.narrativeMechanics.evidenceRefs ?? [],
    },
  ]
  const structuredRiskElements: NonNullable<CoreMeme['coreElements']> = (
    p02?.riskAnnotations ?? []
  ).map((annotation, index) => {
    const topicIsCore =
      annotation.riskType === 'sensitive_topic' && annotation.riskScope === 'topic'
    return {
      id: `R${index + 1}`,
      content: annotation.content,
      semanticRole:
        annotation.riskScope === 'behavior'
          ? ('conflict' as const)
          : annotation.riskScope === 'visual_carrier'
            ? ('evidence_carrier' as const)
            : annotation.riskScope === 'wording'
              ? ('style' as const)
              : ('premise' as const),
      necessity: topicIsCore ? ('must_keep' as const) : ('replaceable' as const),
      riskType: annotation.riskType,
      handling:
        annotation.recommendedHandling === 'retain'
          ? ('retain' as const)
          : annotation.recommendedHandling === 'qualify' ||
              annotation.recommendedHandling === 'verify'
            ? ('qualify' as const)
            : annotation.recommendedHandling === 'transform'
              ? ('transform' as const)
              : ('remove' as const),
      preservationStrength: topicIsCore
        ? ('semantic' as const)
        : ('functional_equivalent' as const),
      requiredSurfaceTokens: [],
      requiredQualifierTokens: [],
      retentionRequirement: topicIsCore
        ? '保留该敏感主题承担的故事前提或核心冲突，只调整其具体表达方式。'
        : '按风险作用范围处理具体主张、行为、视觉载体或措辞。',
      transformationBoundary: topicIsCore
        ? '不得因主题敏感而删除；可以限定语境、核验事实并替换危险表现。'
        : '不得让具体风险处理反向删除与其相连的核心语义。',
      evidenceRefs: annotation.evidenceRefs,
    }
  })
  coreElements.push(...structuredRiskElements)
  const coreDependencies: NonNullable<CoreMeme['coreDependencies']> = [
    { from: 'C1', to: 'C2', relation: 'motivates' },
    { from: 'C2', to: 'C3', relation: 'enables_payoff' },
    { from: 'C4', to: 'C3', relation: 'visually_proves' },
    ...structuredRiskElements
      .filter((element) => element.necessity === 'must_keep')
      .map((element) => ({
        from: element.id,
        to: 'C2',
        relation: 'motivates' as const,
      })),
  ]
  const coreSignature = [
    'C1',
    'C2',
    'C3',
    ...structuredRiskElements
      .filter((element) => element.necessity === 'must_keep')
      .map((element) => element.id),
  ]
  const axisReason =
    axis === 'emotion'
      ? `以情绪为主（${emotionTone ?? '综合'}）：先抓住观众感受，再落故事点。`
      : `以剧情故事为主（${plotDevice ?? '综合'}）：梗点在段子/反转/误会等叙事装置。`
  const hookAssessment = assessHookStrength(item, rawSignalHits)

  return {
    core,
    creativeContract,
    audienceReason,
    narrativeEngine,
    payoffLogic,
    hotSceneCore,
    hookCore,
    transferableCore,
    sourceSemanticCore,
    replaceableSurface,
    forbiddenSurface,
    riskDetails: forbiddenSurface,
    sceneAsset,
    assetInheritanceDecision,
    sourceAdLoop,
    coreElements,
    coreDependencies,
    coreSignature,
    axis,
    emotionTone: axis === 'emotion' ? emotionTone : emotionTone,
    plotDevice: axis === 'plot' ? plotDevice : plotDevice,
    axisReason,
    ...hookAssessment,
  }
}

function scoreFeature(item: HotItem, feature: IntentFeature): number {
  const text = `${item.theme ?? ''} ${item.title} ${item.oneLiner} ${item.transcript ?? ''}`.toLowerCase()
  let score = item.suggestedFeature === feature ? 12 : 0
  if (feature === 'f2f' && /当面|面对面|分屏|问路|点餐|机场|旅行|hotel|airport|in-person|face to face/.test(text)) {
    score += 35
  }
  if (feature === 'live-caption' && /字幕|转录|听不懂|同传|会议|演讲|讲座|caption|subtitle|transcribe|live/.test(text)) {
    score += 35
  }
  if (feature === 'chat' && /聊天|私信|消息|气泡|交友|评论|回复|不知道怎么说|尬聊|ai|buddy|dm|message|chat|comment|crush/.test(text)) {
    score += 35
  }
  if (feature === 'translator' && /翻译器|粘贴|麦克风|菜单|路牌|截图|图片翻译|拍照翻译|translator|paste|image translation|menu|sign/.test(text)) {
    score += 35
  }
  if (feature === 'group-tutorial' && /群聊|群组|社群|粉丝群|多人|邀请|加群|二维码|关键词|tag|direct tag|group|community|invite|qr/.test(text)) {
    score += 35
  }
  if (item.topicTags.includes('travel') && feature === 'f2f') score += 14
  if (item.topicTags.includes('language_learning') && feature === 'live-caption') score += 10
  if (item.topicTags.includes('cross_culture') && feature === 'chat') score += 8
  if (item.periodicKind === 'game' && feature === 'chat') score += 12
  if (item.periodicKind === 'idol' && feature === 'group-tutorial') score += 12
  return score
}

function taskFitScore(feature: IntentFeature, sourceTask: string): number {
  if (!sourceTask) return 0
  if (
    feature === 'live-caption' &&
    /现场|声音|号召|参与|加入|听懂|看懂/.test(sourceTask)
  ) {
    return 42
  }
  if (feature === 'chat' && /消息|对话|回复|聊天/.test(sourceTask)) return 42
  if (feature === 'translator' && /可见文字|待表达内容|语言/.test(sourceTask)) return 34
  if (feature === 'f2f' && /面对面|当面|同一空间/.test(sourceTask)) return 34
  if (feature === 'group-tutorial' && /群体|加入|社群|多人/.test(sourceTask)) return 28
  return 0
}

function featureMetadata(
  feature: IntentFeature,
  text: string,
): Pick<
  FeatureFitCandidate,
  | 'primaryPromise'
  | 'proofMode'
  | 'featureRole'
  | 'relationshipOutcome'
  | 'selectedCapability'
  | 'socialPayoff'
> {
  const spec = SHORTS_FEATURE_SPECS[feature]
  const selectedCluster =
    spec.capabilityClusters.find((cluster) => {
      if (cluster.cluster === 'ai_buddy') return /ai|buddy|回复|不知道怎么说|尬聊/i.test(text)
      if (cluster.cluster === 'image_translation') return /图片|截图|菜单|路牌|拍照|image|menu|sign/i.test(text)
      if (cluster.cluster === 'trust_safety') return /官方|认证|安全|举报|管理|权限|badge|report|admin/i.test(text)
      return false
    }) ?? spec.capabilityClusters[0]

  return {
    primaryPromise: spec.primaryPromise,
    proofMode: spec.proofMode,
    featureRole: spec.featureRole,
    relationshipOutcome: spec.relationshipOutcomes[0] ?? '',
    selectedCapability: selectedCluster?.name ?? spec.label,
    socialPayoff: spec.socialPayoff,
  }
}

function buildFeatureRanking(
  item: HotItem,
  kind: SellFitAssessment['kind'],
  sourceTask = '',
): FeatureFitCandidate[] {
  const text = `${item.theme ?? ''} ${item.title} ${item.oneLiner} ${item.transcript ?? ''}`
  return FEATURE_PRIORITY.map((feature) => {
    const spec = SHORTS_FEATURE_SPECS[feature]
    const metadata = featureMetadata(feature, text)
    const score = scoreFeature(item, feature) + taskFitScore(feature, sourceTask)
    const normalized = Math.max(0.25, Math.min(0.95, (score + 45) / 100))
    const rewriteCost: FeatureFitCandidate['rewriteCost'] =
      score >= 45 ? 'low' : score >= 24 ? 'medium' : 'high'
    return {
      feature,
      priority: 0,
      matchScore: Number(normalized.toFixed(2)),
      ...metadata,
      coreRetentionScore: Number(
        Math.max(0.25, Math.min(0.98, normalized - (rewriteCost === 'high' ? 0.2 : rewriteCost === 'medium' ? 0.08 : 0))).toFixed(2),
      ),
      semanticTradeoff:
        rewriteCost === 'high'
          ? '产品证明需要较多场景改动，存在削弱原核心前提或结尾兑现逻辑的风险。'
          : '可在保留原核心前提、叙事机制和结尾兑现逻辑的条件下嵌入产品证明。',
      coreRealization:
        `产品证明应参与原冲突的理解、表达或连接过程，并收束到「${metadata.socialPayoff}」，不得另起一个普通功能演示故事。`,
      fitKind: kind,
      whyFit:
        feature === item.suggestedFeature
          ? `上游语义打标已建议该 Shorts 功能，且当前场景存在可承接的 ${metadata.selectedCapability} 证明点。`
          : `可测试 ${spec.label}，但需要检查原场景是否能自然展示 ${metadata.selectedCapability} 并兑现社交结果。`,
      heroProofMoment: spec.heroMoment,
      rewriteCost,
      risk:
        rewriteCost === 'high'
          ? '需要较多改写，可能损伤原 scene/hook；默认不作为首选。'
          : '需保证产品证明片段不少于 3 秒，避免 UI 一闪而过。',
    }
  })
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        FEATURE_PRIORITY.indexOf(a.feature) - FEATURE_PRIORITY.indexOf(b.feature),
    )
    .map((candidate, index) => ({ ...candidate, priority: index + 1 }))
}

function buildCoreRiskPlan(meme: CoreMeme) {
  const elements = meme.coreElements ?? []
  const coreHandlingPlan = elements.map((element) => ({
    coreId: element.id,
    decision:
      element.riskType === 'factual_uncertainty'
        ? ('qualify' as const)
        : element.riskType === 'unsafe_depiction' || element.riskType === 'prohibited_behavior'
          ? ('transform' as const)
          : element.handling,
    reason:
      element.necessity === 'must_keep'
        ? '该元素属于核心签名，风险处理只能限定或转换表达，不能直接删除。'
        : '按该元素的叙事作用和风险类型处理其具体表现方式。',
    downstreamRequirement: element.retentionRequirement,
  }))

  return {
    coreHandlingPlan,
    riskTransformationContract: {
      retainedSensitiveCore: elements
        .filter((element) => element.riskType === 'sensitive_topic')
        .map((element) => ({
          coreId: element.id,
          retentionRequirement: element.retentionRequirement,
          allowedTreatment: element.transformationBoundary,
        })),
      restrictedExpressions: (meme.riskDetails ?? meme.forbiddenSurface).map((content) => ({
        content,
        reason: '只限制具体高风险、侵权或不可继承的表达，不反向删除核心主题。',
      })),
      requiredTransformations: elements
        .filter((element) => element.handling === 'transform')
        .map((element) => ({
          coreId: element.id,
          originalExpression: element.content,
          safeTransformation: element.transformationBoundary,
          mustPreserve: element.retentionRequirement,
        })),
      factRequirements: elements
        .filter((element) => element.riskType === 'factual_uncertainty')
        .map((element) => ({
          claim: element.content,
          requirement: 'qualify' as const,
        })),
    },
  }
}

function pickTopFeature(
  item: HotItem,
  kind: SellFitAssessment['kind'],
  meme?: CoreMeme,
): { feature: IntentFeature; ranking: FeatureFitCandidate[] } {
  const ranking = buildFeatureRanking(item, kind, meme?.creativeContract?.sourceTask)
  const feature = ranking[0]?.feature ?? item.suggestedFeature
  return { feature, ranking }
}

function featureName(feature: IntentFeature): string {
  return SHORTS_FEATURE_SPECS[feature]?.label ?? feature
}

function verifiedProductCapabilityGate(feature: IntentFeature) {
  const spec = SHORTS_FEATURE_SPECS[feature]
  const defaultCluster = spec.capabilityClusters[0]
  return {
    feature,
    status: 'verified' as const,
    verifiedCapabilities: [
      spec.whatItIs,
      spec.heroMoment,
      spec.onScreenUi,
      ...spec.capabilityClusters.flatMap((cluster) => cluster.capabilities),
    ],
    unverifiedCapabilities: [],
    coreResolutionRole: 'allowed' as const,
    primaryPromise: spec.primaryPromise,
    proofMode: spec.proofMode,
    featureRole: spec.featureRole,
    relationshipOutcomes: spec.relationshipOutcomes,
    selectedCapability: defaultCluster?.name ?? spec.label,
    socialPayoff: spec.socialPayoff,
    hardBoundaries: spec.hardBoundaries,
    forbiddenClaims: spec.forbiddenClaims,
    reason:
      '仅允许使用仓库 Shorts 功能知识库中已验证的能力、证明瞬间、UI 结构和能力边界承担解决作用；功能证明必须服务最终社交结果。',
  }
}

function buildRewritePlan(
  feature: IntentFeature,
  meme: CoreMeme,
  selectedCapability = '',
): RewritePlan {
  const contract = meme.creativeContract
  const preserve = contract
    ? `${contract.hook}；${contract.mechanism}`
    : meme.core
  const sourceTask = contract?.sourceTask ?? '完成原素材驱动的互动任务。'
  const proofBeatByFeature: Record<IntentFeature, string> = {
    chat: `Demo App Chat / ${selectedCapability || 'AI Buddy'} 在原互动中帮用户组织或理解消息。`,
    'live-caption': 'Demo App Live Caption 把现场可听内容实时转成用户能理解的字幕。',
    translator: 'Demo App Translator 把可见文字或待表达内容转成对方能理解的语言。',
    f2f: 'Demo App Face to face 在同一空间里展示双方轮流理解和表达。',
    'group-tutorial': 'Demo App Group growth 让兴趣、关键词或邀请转成可加入的群体互动入口。',
  }
  return {
    preserve,
    insertAt: '在原钩子成立、用户任务出现之后进入产品证明，前2秒不出现产品名。',
    proofBeat: `${proofBeatByFeature[feature]} 证明任务：${sourceTask}`,
    resultBeat: '结尾必须拍到人与人之间继续聊天、回应、加入、参与或面对面开口的具体动作。',
  }
}

function rewriteSceneForFeature(
  item: HotItem,
  feature: IntentFeature,
  text: string,
  meme: CoreMeme,
) {
  const mustKeep = (meme.coreElements ?? [])
    .filter((element) => element.necessity === 'must_keep')
    .map((element) => element.content)
    .join('；')
  const preservation = mustKeep
    ? `保留核心签名所代表的故事前提、冲突和结尾作用（${mustKeep}），风险只转换具体表达，不得改成无关的普通功能演示。`
    : '保留原故事前提、冲突机制和结尾作用，不得改成无关的普通功能演示。'
  if (feature === 'chat') {
    return `改写：${preservation}在原冲突顶点加入一条外语消息、评论或不知道如何回复的社交卡点，Demo App Chat/AI Buddy 在同一线程里帮角色看懂或改好回复，让对话继续变轻松。`
  }
  if (feature === 'live-caption') {
    return `改写：${preservation}让原场景中的人物或环境声音成为需要理解的信息源，Demo App Live Caption 在字幕栏实时翻译，角色由听不懂转为能参与现场互动。`
  }
  if (feature === 'translator') {
    return `改写：${preservation}让角色需要把原冲突中的关键信息、菜单/路牌/截图文字或一句话翻成对方语言，Demo App Translator 给出可用译文，推动现实互动继续。`
  }
  if (feature === 'f2f') {
    return `改写：${preservation}让两人在原冲突中面对面卡在语言沟通上，手机居中展示 Face to Face 双卡片互译，让双方能轮流表达并继续交流。`
  }
  if (feature === 'group-tutorial') {
    return `改写：${preservation}仅在原叙事机制允许时把兴趣、邀请、关键词或多语群聊作为连接入口，让角色从旁观变成加入群体互动；功能可作为背景证明，不必硬塞完整教程。`
  }
  if (item.periodicKind === 'game') {
    return `改写：开黑语音听不懂 → 用 Demo App 对齐战术，再和全球玩家母语开黑聊天。`
  }
  if (/世界杯|球迷/.test(text)) {
    return `改写：两队球迷现场吵架听不懂 → Demo App 翻译解围，赛后还能和世界各国球迷继续聊天。`
  }
  return `改写：${preservation}让角色在关键冲突点打开 Demo App「${featureName(feature)}」获得跨语沟通帮助并突破障碍。`
}

/** 判断核心梗能否与 Demo App 卖点适配 */
export function assessSellFit(
  item: HotItem,
  meme: CoreMeme,
): SellFitAssessment {
  const text = `${item.theme ?? ''} ${item.title} ${item.oneLiner} ${item.transcript ?? ''} ${meme.core}`
  const hasLang = LANG_SIGNAL.test(text) || item.topicTags.length > 0
  const hasScene = SCENE_REWRITE_SIGNAL.test(text) || !!item.periodicKind
  const isVideo = isVideoItem(item)
  const hardEligible = isVideo && meme.hookStrength !== 'weak'
  const coreRiskPlan = buildCoreRiskPlan(meme)

  // 1) 直接匹配：跨语言沟通笑话/场景 → 翻译等卖点；保留热点库复用
  if (hasLang && LANG_SIGNAL.test(text)) {
    const { feature, ranking } = pickTopFeature(item, 'direct', meme)
    const top = ranking[0]
    const rewritePlan = buildRewritePlan(feature, meme, top?.selectedCapability)
    return {
      kind: 'direct',
      feature,
      featureRanking: ranking,
      reason:
        `核心梗直接呈现跨语言沟通/外语表达问题，默认选择 ${featureName(feature)} 作为最匹配的 Shorts 功能；保留在热点库供持续复用。`,
      primaryPromise: top?.primaryPromise,
      proofMode: top?.proofMode,
      featureRole: top?.featureRole,
      relationshipOutcome: top?.relationshipOutcome,
      selectedCapability: top?.selectedCapability,
      socialPayoff: top?.socialPayoff,
      proofTask: rewritePlan.proofBeat,
      socialOutcome: rewritePlan.resultBeat,
      rewritePlan,
      hardPlacementFeature: feature,
      placementOptions: hardEligible ? ['soft', 'hard'] : ['soft'],
      recommendedPlacement: 'soft',
      keepInHotPool: true,
      returnToHotPool: false,
      enterScreening: true,
      productCapabilityGate: verifiedProductCapabilityGate(feature),
      ...coreRiskPlan,
    }
  }

  if (
    item.topicTags.includes('language_learning') ||
    item.topicTags.includes('cross_culture') ||
    item.topicTags.includes('travel')
  ) {
    const { feature, ranking } = pickTopFeature(item, 'direct', meme)
    const top = ranking[0]
    const rewritePlan = buildRewritePlan(feature, meme, top?.selectedCapability)
    return {
      kind: 'direct',
      feature,
      featureRanking: ranking,
      hardPlacementFeature: feature,
      reason:
        `标签属于旅行/跨文化交流/学外语，默认选择 ${featureName(feature)} 作为最匹配的 Shorts 功能；保留热点库复用。`,
      primaryPromise: top?.primaryPromise,
      proofMode: top?.proofMode,
      featureRole: top?.featureRole,
      relationshipOutcome: top?.relationshipOutcome,
      selectedCapability: top?.selectedCapability,
      socialPayoff: top?.socialPayoff,
      proofTask: rewritePlan.proofBeat,
      socialOutcome: rewritePlan.resultBeat,
      rewritePlan,
      placementOptions: hardEligible ? ['soft', 'hard'] : ['soft'],
      recommendedPlacement: 'soft',
      keepInHotPool: true,
      returnToHotPool: false,
      enterScreening: true,
      productCapabilityGate: verifiedProductCapabilityGate(feature),
      ...coreRiskPlan,
    }
  }

  // 2) 改写后可匹配：场景中角色可借 App 获得帮助/突破
  if (hasScene) {
    const { feature, ranking } = pickTopFeature(item, 'rewrite', meme)
    const top = ranking[0]
    const rewrittenScene = rewriteSceneForFeature(item, feature, text, meme)
    const rewritePlan = buildRewritePlan(feature, meme, top?.selectedCapability)

    return {
      kind: 'rewrite',
      feature,
      featureRanking: ranking,
      reason:
        `核心梗本身非语言产品向，但场景可用最小变量改写为 ${featureName(feature)} 的产品证明瞬间。`,
      primaryPromise: top?.primaryPromise,
      proofMode: top?.proofMode,
      featureRole: top?.featureRole,
      relationshipOutcome: top?.relationshipOutcome,
      selectedCapability: top?.selectedCapability,
      socialPayoff: top?.socialPayoff,
      proofTask: rewritePlan.proofBeat,
      socialOutcome: rewritePlan.resultBeat,
      rewritePlan,
      rewrittenScene,
      hardPlacementFeature: feature,
      placementOptions: hardEligible ? ['soft', 'hard'] : ['soft'],
      recommendedPlacement: 'soft',
      keepInHotPool: false,
      returnToHotPool: false,
      enterScreening: true,
      productCapabilityGate: verifiedProductCapabilityGate(feature),
      ...coreRiskPlan,
    }
  }

  // 3) 软植入不匹配：强/中钩子视频仍可进入硬植入池
  if (hardEligible) {
    const { feature, ranking } = pickTopFeature(item, 'none', meme)
    const top = ranking[0]
    const rewritePlan = buildRewritePlan(feature, meme, top?.selectedCapability)
    return {
      kind: 'none',
      hardPlacementFeature: feature,
      featureRanking: ranking,
      reason:
        `核心梗与跨语言功能没有自然语义连接，不适合软改写；但钩子具备独立吸引力，可完整保留原梗并在高潮后硬切 ${featureName(feature)} 证明段。`,
      primaryPromise: top?.primaryPromise,
      proofMode: top?.proofMode,
      featureRole: top?.featureRole,
      relationshipOutcome: top?.relationshipOutcome,
      selectedCapability: top?.selectedCapability,
      socialPayoff: top?.socialPayoff,
      proofTask: rewritePlan.proofBeat,
      socialOutcome: rewritePlan.resultBeat,
      rewritePlan,
      placementOptions: ['hard'],
      recommendedPlacement: 'hard',
      keepInHotPool: true,
      returnToHotPool: false,
      enterScreening: true,
      productCapabilityGate: verifiedProductCapabilityGate(feature),
      ...coreRiskPlan,
    }
  }

  // 4) 软植入不匹配且钩子弱：退回热点库
  return {
    kind: 'none',
    reason:
      '核心梗与跨语言卖点无自然连接，且钩子不足以独立承担硬植入开场，退回热点库观察。',
    placementOptions: [],
    keepInHotPool: true,
    returnToHotPool: true,
    enterScreening: false,
    ...coreRiskPlan,
  }
}

export function breakdownInspiration(item: HotItem): InspirationBreakdown {
  const meme = extractCoreMeme(item)
  const fit = assessSellFit(item, meme)
  return {
    hotItemId: item.id,
    meme,
    fit,
    brokenDownAt: stamp(),
  }
}

export const AXIS_LABELS: Record<string, string> = {
  emotion: '情绪为主',
  plot: '剧情故事为主',
}

export const EMOTION_LABELS: Record<string, string> = {
  sweet: '甜',
  heartbreak: '虐心',
  funny: '搞笑',
  warm: '温暖',
  hype: '燃',
  awkward: '尴尬/无力',
}

export const PLOT_LABELS: Record<string, string> = {
  skit: '情景段子',
  twist: '反转',
  short_joke: '短小笑话',
  satire: '讽刺吐槽',
  misunderstanding: '误会',
  slice: '生活切片',
}

export const FIT_LABELS: Record<string, string> = {
  direct: '软植入直配',
  rewrite: '软植入需改写',
  none: '软植入不匹配',
}
