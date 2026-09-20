import { FEATURE_LABELS } from '../data/markets'
import { defaultProduceForm } from '../prompts/pipeline'
import { breakdownInspiration } from './breakdown'
import type {
  ContentReview,
  HotItem,
  InspirationBreakdown,
  IntentFeature,
  MatchedCard,
  PlacementMode,
  ProduceForm,
} from '../types'

export const PRODUCE_FORM_LABELS: Record<ProduceForm, string> = {
  poster: '海报',
  chat: '聊天记录',
  video: '视频',
}

export const PLACEMENT_LABELS: Record<PlacementMode, string> = {
  soft: '软植入',
  hard: '硬植入',
}

/**
 * P08 制作形态：确定性跟随原素材形态（视频→视频，图文/段子→海报）。
 * 不再按 feature 判定；其他形态由使用者在筛选/制作页手动改选（见 changeProduceForm）。
 */
function pickProduceForm(item: HotItem): ProduceForm {
  return defaultProduceForm(item)
}

function toolHintFor(form: ProduceForm) {
  if (form === 'video') return '视频生成工具 + 文案质检'
  if (form === 'chat') return 'Chat Screenshot + your text-quality checker'
  return 'Chat Screenshot / 设计出图 + your text-quality checker（海报）'
}

function buildParts(
  title: string,
  sourceUrl: string | undefined,
  form: ProduceForm,
  feature: IntentFeature,
  storyLine: string,
  placementMode: PlacementMode,
) {
  const featureName = FEATURE_LABELS[feature]
  const formLabel = PRODUCE_FORM_LABELS[form]
  const effectivePlacement = form === 'video' ? placementMode : 'soft'
  const hook =
    form === 'video'
      ? effectivePlacement === 'hard'
        ? `原热点钩子（0–3 秒，完整保留）：${storyLine}`
        : `剧情钩子（0–2 秒）：${storyLine}`
      : form === 'chat'
        ? `聊天记录钩子：第一条气泡抛出「${title}」的冲突`
        : `海报钩子：大字主标题「${title}」`

  const sellBeat =
    form === 'video'
      ? effectivePlacement === 'hard'
        ? `原梗高潮后硬切：一句过桥话转入 Demo App「${featureName}」直接演示`
        : `原剧情冲突顶点后自然带出 Demo App「${featureName}」，由角色操作完成解围`
      : form === 'chat'
        ? `对话中段气泡展示 Demo App「${featureName}」：一句话看懂对方`
        : `海报中区展示 Demo App「${featureName}」卖点与下载引导`

  const downloadCta = '结尾：Download Demo App · App Store / Google Play'
  const generatedScript = [
    `制作形态：${formLabel}`,
    form === 'video' ? `植入方式：${PLACEMENT_LABELS[effectivePlacement]}` : '',
    `一句话故事：${storyLine}`,
    hook,
    form === 'video' && effectivePlacement === 'hard'
      ? '保留原梗至高潮 → 在笑点/反转完成后的第一个节奏断点硬切 → 过桥句'
      : form === 'video'
        ? '冲突升级 → 剧情内卡点 → 角色自然调用功能'
        : '视觉/对话节奏推进到卖点',
    sellBeat,
    downloadCta,
    sourceUrl ? `原灵感链接：${sourceUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { hook, sellBeat, downloadCta, generatedScript }
}

function autoReview(parts: {
  generatedScript: string
  hook: string
  sellBeat: string
  downloadCta: string
  oneLiner: string
}): ContentReview {
  const offensePass = !/(侮辱|歧视|仇恨)/.test(parts.generatedScript)
  const stereotypePass = !/(一律|全部都是)/.test(parts.generatedScript)
  const hasHook = parts.hook.length > 0
  const hasSellBeat = /Demo App/i.test(parts.sellBeat)
  const hasDownloadCta = /download|下载/i.test(parts.downloadCta)
  const sellPointClear = hasSellBeat && parts.oneLiner.length <= 100
  const passed =
    offensePass && stereotypePass && hasHook && hasSellBeat && hasDownloadCta
  return {
    offensePass,
    stereotypePass,
    sellPointClear,
    hasHook,
    hasSellBeat,
    hasDownloadCta,
    notes: passed
      ? ['自动审查通过：无冒犯/刻板印象，钩子·卖点·下载完整']
      : ['自动审查未通过'],
    passed,
  }
}

export interface PipelineResult {
  breakdowns: InspirationBreakdown[]
  matches: MatchedCard[]
}

/**
 * 灵感拆解 → 软植入适配 + 硬植入资格分流 → 生成匹配卡进入筛选
 */
export function runBreakdownAndMatch(
  items: HotItem[],
  existingBreakdowns: InspirationBreakdown[],
  existingMatches: MatchedCard[],
): PipelineResult {
  const brokenIds = new Set(existingBreakdowns.map((b) => b.hotItemId))
  const matchedHotIds = new Set(existingMatches.map((c) => c.hotItemId))
  const freshBreakdowns: InspirationBreakdown[] = []
  const freshMatches: MatchedCard[] = []

  for (const item of items) {
    if (brokenIds.has(item.id)) continue

    const breakdown = breakdownInspiration(item)
    freshBreakdowns.push(breakdown)

    if (!breakdown.fit.enterScreening) {
      continue
    }
    if (matchedHotIds.has(item.id)) continue

    const fitKind = breakdown.fit.kind
    const feature =
      breakdown.fit.feature ??
      breakdown.fit.hardPlacementFeature ??
      item.suggestedFeature
    const produceForm = pickProduceForm(item)
    const placementMode = breakdown.fit.recommendedPlacement ?? 'soft'
    const sourceStory = item.transcript?.trim() || item.oneLiner
    const softStory =
      fitKind === 'rewrite' && breakdown.fit.rewrittenScene
        ? breakdown.fit.rewrittenScene
        : item.oneLiner
    const storyLine = placementMode === 'hard' ? sourceStory : softStory
    const parts = buildParts(
      item.title,
      item.sourceUrl,
      produceForm,
      feature,
      storyLine,
      placementMode,
    )
    const review = autoReview({ ...parts, oneLiner: storyLine })
    const sourceUrl =
      item.sourceUrl ??
      `https://www.tiktok.com/search?q=${encodeURIComponent(item.title)}`

    freshMatches.push({
      id: `match-${item.id}`,
      hotItemId: item.id,
      sourceMarketId: item.sourceMarketId ?? item.marketId,
      targetMarketSource: item.targetMarketSource ?? 'source_default',
      isCrossMarketRewrite:
        (item.sourceMarketId ?? item.marketId) !== item.marketId,
      marketId: item.marketId,
      platform: item.platform,
      produceForm,
      feature,
      title: item.title,
      sourceStory,
      softStory,
      oneLiner: storyLine,
      fitKind,
      placementMode,
      placementOptions: breakdown.fit.placementOptions,
      placementReason:
        placementMode === 'hard'
          ? '软植入语义不成立或优先保护强钩子，采用高潮后硬切。'
          : '卖点与剧情存在自然连接，优先在冲突内部完成解围。',
      meme: breakdown.meme,
      fitReason: breakdown.fit.reason,
      ...parts,
      review,
      status: review.passed ? 'matched' : 'rejected',
      toolHint: toolHintFor(produceForm),
      sourceUrl,
    })
  }

  return {
    breakdowns: [...freshBreakdowns, ...existingBreakdowns],
    matches: [...freshMatches, ...existingMatches],
  }
}

/**
 * 使用者手动改选制作形态后，按新形态重算脚本与机审（feature 不变）。
 * 已推送（pushed）的卡不改动。
 */
export function rebuildCardForForm(
  card: MatchedCard,
  form: ProduceForm,
): MatchedCard {
  if (
    card.status === 'pushed' ||
    card.produceForm === form ||
    (card.fitKind === 'none' && form !== 'video')
  ) {
    return card
  }
  const placementMode = form === 'video' ? card.placementMode : 'soft'
  const storyLine =
    form === 'video' && placementMode === 'hard'
      ? card.sourceStory
      : card.softStory
  const parts = buildParts(
    card.title,
    card.sourceUrl,
    form,
    card.feature,
    storyLine,
    placementMode,
  )
  const review = autoReview({ ...parts, oneLiner: storyLine })
  return {
    ...card,
    produceForm: form,
    placementMode,
    oneLiner: storyLine,
    ...parts,
    review,
    toolHint: toolHintFor(form),
  }
}

export function rebuildCardForPlacement(
  card: MatchedCard,
  placementMode: PlacementMode,
): MatchedCard {
  if (
    card.status === 'pushed' ||
    card.produceForm !== 'video' ||
    card.placementMode === placementMode ||
    !card.placementOptions.includes(placementMode)
  ) {
    return card
  }

  const storyLine = placementMode === 'hard' ? card.sourceStory : card.softStory
  const parts = buildParts(
    card.title,
    card.sourceUrl,
    card.produceForm,
    card.feature,
    storyLine,
    placementMode,
  )
  const review = autoReview({ ...parts, oneLiner: storyLine })
  return {
    ...card,
    placementMode,
    oneLiner: storyLine,
    placementReason:
      placementMode === 'hard'
        ? '完整保留原钩子，在高潮结束后的第一个节奏断点切入卖点。'
        : '在原剧情冲突内部植入卖点，让功能成为角色解围动作。',
    ...parts,
    review,
  }
}

/**
 * A successful re-analysis may refresh the generated card, but it must not
 * silently undo a human screening decision. Reapply compatible manual form /
 * placement choices to the refreshed content and then restore that decision.
 */
export function preserveReviewedMatch(
  next: MatchedCard,
  previous: MatchedCard,
): MatchedCard {
  if (
    previous.status !== 'screened_in' &&
    previous.status !== 'screened_out'
  ) {
    return next
  }
  const withForm = rebuildCardForForm(next, previous.produceForm)
  const withPlacement = rebuildCardForPlacement(
    withForm,
    previous.placementMode,
  )
  return { ...withPlacement, status: previous.status }
}
