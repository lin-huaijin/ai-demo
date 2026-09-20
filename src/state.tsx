import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  DEMO_HOT_ITEMS,
  DEMO_MATCH_STATUS,
  DEMO_PRODUCE_COUNTS,
  TREND_SUMMARIES,
  dedupeHotPool,
} from './data/hotPool'
import {
  rebuildCardForForm,
  rebuildCardForPlacement,
  preserveReviewedMatch,
  runBreakdownAndMatch,
} from './lib/autoMatch'
import {
  extractUrls,
  hotItemFromForeplayAd,
  recognizePostFromUrl,
} from './lib/linkIngest'
import { searchForeplayAds, type ForeplaySearchParams } from './lib/foreplay'
import { saveWorkflowArtifactSnapshot } from './lib/artifacts.ts'
import {
  analyzeHotItem,
  analyzeHotItems,
  curatedSourceFieldsInPatch,
  getMultimodalServiceStatus,
  isVideoHotItem,
  multimodalAnalysisInputChanged,
} from './lib/multimodalAnalysis'
import { buildPromptChain } from './prompts/pipeline.ts'
import { resolveSourceMarket, targetMarketForSource } from './lib/marketRouting'
import type {
  CuratedSourceField,
  HotItem,
  InspirationBreakdown,
  MatchedCard,
  PlacementMode,
  ProduceForm,
  TrendSummary,
} from './types'

interface IngestResult {
  added: number
  skippedDup: number
  invalid: number
  live: number
  fallback: number
  urls: string[]
  analysisComplete: number
  analysisDegraded: number
  analysisSkipped: number
  analysisFailed: number
}

interface ForeplayIngestResult {
  added: number
  skippedDup: number
  fetched: number
  error?: string
  analysisComplete: number
  analysisDegraded: number
  analysisSkipped: number
  analysisFailed: number
}

interface AppState {
  hotItems: HotItem[]
  trendSummaries: TrendSummary[]
  breakdowns: InspirationBreakdown[]
  matches: MatchedCard[]
  lastIngestAt: string | null
  ingesting: boolean
  produceCounts: Record<string, number>
  ingestLinks: (
    rawText: string,
    marketId: string,
    deepAnalysis?: boolean,
  ) => Promise<IngestResult>
  ingestForeplaySearch: (
    params: ForeplaySearchParams,
    marketId: string,
    deepAnalysis?: boolean,
  ) => Promise<ForeplayIngestResult>
  loadDemoData: () => number
  updateHotItem: (id: string, patch: Partial<HotItem>) => void
  changeTargetMarket: (id: string, requestedMarketId: string) => void
  reBreakdownItem: (id: string) => void
  reanalyzeSource: (
    id: string,
  ) => Promise<
    'complete' | 'degraded' | 'skipped' | 'failed' | 'locked' | 'missing' | 'stale'
  >
  screenIn: (id: string) => void
  screenOut: (id: string) => void
  changeProduceForm: (id: string, form: ProduceForm) => void
  changePlacement: (id: string, placement: PlacementMode) => void
  startProduce: (id: string) => void
  finishProduceAndPush: (id: string) => void
  dedupedPool: HotItem[]
  pendingScreen: MatchedCard[]
  inProduction: MatchedCard[]
  pushed: MatchedCard[]
  returnedToPool: InspirationBreakdown[]
  reusableDirect: InspirationBreakdown[]
}

const AppContext = createContext<AppState | null>(null)

/**
 * A failed MM01 result is a quality gate, not a fallback signal. Keep the
 * source item for retry and review, but never let it enter the legacy
 * breakdown/matching pipeline automatically.
 */
// oxlint-disable-next-line react/only-export-components -- exported for the page gate and direct unit tests
export function canEnterAutomaticBreakdown(
  item: Pick<HotItem, 'multimodalAnalysisStatus'>,
): boolean {
  return item.multimodalAnalysisStatus !== 'failed'
}

// oxlint-disable-next-line react/only-export-components -- exported for direct unit tests
export function automaticBreakdownCandidates<T extends Pick<HotItem, 'multimodalAnalysisStatus'>>(
  items: readonly T[],
): T[] {
  return items.filter(canEnterAutomaticBreakdown)
}

// oxlint-disable-next-line react/only-export-components -- exported for direct state-transition tests
export function retainFailedGateAfterUnsuccessfulRetry<T extends HotItem>(
  previous: T,
  attempted: T,
): T {
  const succeeded =
    attempted.multimodalAnalysisStatus === 'complete' ||
    attempted.multimodalAnalysisStatus === 'degraded'
  if (previous.multimodalAnalysisStatus !== 'failed' || succeeded) return attempted
  return {
    ...previous,
    artifact: attempted.artifact ?? previous.artifact,
    artifactWarning: attempted.artifactWarning ?? previous.artifactWarning,
    multimodalAnalysisStatus: 'failed',
    multimodalAnalysisError:
      attempted.multimodalAnalysisError ?? previous.multimodalAnalysisError,
  }
}

// oxlint-disable-next-line react/only-export-components -- exported for direct selector tests
export function activeDerivedRecords<T extends { hotItemId: string }>(
  records: readonly T[],
  items: readonly Pick<HotItem, 'id' | 'multimodalAnalysisStatus'>[],
): T[] {
  const blockedIds = new Set(
    items
      .filter((item) => !canEnterAutomaticBreakdown(item))
      .map((item) => item.id),
  )
  return records.filter((record) => !blockedIds.has(record.hotItemId))
}

function hotItemIsBlocked(items: readonly HotItem[], hotItemId: string): boolean {
  return items.some(
    (item) => item.id === hotItemId && !canEnterAutomaticBreakdown(item),
  )
}

function archiveSafeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const identityVideoId = url.searchParams.get('v')
    const keepVideoId =
      Boolean(identityVideoId) &&
      /^[A-Za-z0-9_-]{1,128}$/.test(identityVideoId ?? '') &&
      ((/(^|\.)youtube\.com$/.test(host) && url.pathname === '/watch') ||
        (/(^|\.)facebook\.com$/.test(host) &&
          (url.pathname === '/watch' || url.pathname === '/video.php')))
    url.username = ''
    url.password = ''
    url.hash = ''
    url.search = ''
    if (keepVideoId && identityVideoId) {
      url.searchParams.set('v', identityVideoId)
    }
    return url.toString()
  } catch {
    return undefined
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [hotItems, setHotItems] = useState<HotItem[]>([])
  const [trendSummaries] = useState<TrendSummary[]>(TREND_SUMMARIES)
  const [breakdowns, setBreakdowns] = useState<InspirationBreakdown[]>([])
  const [matches, setMatches] = useState<MatchedCard[]>([])
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [produceCounts, setProduceCounts] = useState<Record<string, number>>({})

  const breakdownsRef = useRef(breakdowns)
  const matchesRef = useRef(matches)
  const hotItemsRef = useRef(hotItems)
  const sourceRevisionRef = useRef(new Map<string, number>())
  const analysisRequestRef = useRef(new Map<string, number>())
  const artifactSnapshotHashRef = useRef(new Map<string, string>())
  breakdownsRef.current = breakdowns
  matchesRef.current = matches
  hotItemsRef.current = hotItems

  const dedupedPool = useMemo(() => dedupeHotPool(hotItems), [hotItems])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const breakdownByItem = new Map(
        breakdowns.map((breakdown) => [breakdown.hotItemId, breakdown]),
      )
      const matchByItem = new Map(matches.map((match) => [match.hotItemId, match]))

      for (const item of hotItems) {
        if (!item.artifact) continue
        const breakdown = breakdownByItem.get(item.id)
        const match = matchByItem.get(item.id)
        // MM01/C01/P02F/P02 and binary media are already persisted by the
        // server. Keep the workflow snapshot small and avoid re-saving signed
        // CDN URLs.
        const archivableItem = {
          ...item,
          sourceUrl: archiveSafeUrl(item.sourceUrl),
          thumbnailUrl: archiveSafeUrl(item.thumbnailUrl),
          landingUrl: archiveSafeUrl(item.landingUrl),
          multimodalAnalysis: undefined,
          mediaUrl: undefined,
          mediaUrls: undefined,
          videoUrls: undefined,
          imageUrls: undefined,
        }
        const snapshot = {
          hotItem: archivableItem,
          breakdown,
          match,
          produceCount: produceCounts[item.id] ?? 0,
          promptChain: breakdown
            ? buildPromptChain(
                {
                  ...item,
                  sourceUrl: archiveSafeUrl(item.sourceUrl),
                  mediaUrl: undefined,
                  mediaUrls: undefined,
                  videoUrls: undefined,
                  imageUrls: undefined,
                },
                breakdown,
              )
            : undefined,
          savedAt: new Date().toISOString(),
        }
        const comparison = JSON.stringify({ ...snapshot, savedAt: undefined })
        const key = `${item.artifact.projectId}/${item.artifact.assetId}/${item.artifact.runId}`
        if (artifactSnapshotHashRef.current.get(key) === comparison) continue
        artifactSnapshotHashRef.current.set(key, comparison)
        void saveWorkflowArtifactSnapshot(item.artifact, snapshot).catch(() => {
          // Persistence is best-effort and must never break paid MM01/P02 work.
          artifactSnapshotHashRef.current.delete(key)
        })
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [hotItems, breakdowns, matches, produceCounts])

  const ingestLinks = useCallback(async (
    rawText: string,
    marketId: string,
    deepAnalysis = true,
  ) => {
    const urls = extractUrls(rawText)
    if (urls.length === 0) {
      return {
        added: 0,
        skippedDup: 0,
        invalid: 1,
        live: 0,
        fallback: 0,
        urls: [],
        analysisComplete: 0,
        analysisDegraded: 0,
        analysisSkipped: 0,
        analysisFailed: 0,
      }
    }

    setIngesting(true)
    try {
      const existingKeys = new Set(
        hotItemsRef.current.map((h) => h.dedupeKey),
      )
      const fresh: HotItem[] = []
      let skippedDup = 0
      let live = 0
      let fallback = 0

      for (const url of urls) {
        const key = url.split('?')[0].toLowerCase()
        if (existingKeys.has(key)) {
          skippedDup += 1
          continue
        }
        existingKeys.add(key)
        const item = await recognizePostFromUrl(url, marketId)
        if (item.recognition === 'live') live += 1
        else fallback += 1
        fresh.push(item)
      }

      setLastIngestAt(new Date().toLocaleString('zh-CN', { hour12: false }))
      const analyzed = await analyzeHotItems(fresh, deepAnalysis)

      if (analyzed.items.length > 0) {
        const nextHot = [...analyzed.items, ...hotItemsRef.current]
        const result = runBreakdownAndMatch(
          automaticBreakdownCandidates(dedupeHotPool(nextHot)),
          breakdownsRef.current,
          matchesRef.current,
        )
        setHotItems(nextHot)
        setBreakdowns(result.breakdowns)
        setMatches(result.matches)
      }

      return {
        added: analyzed.items.length,
        skippedDup,
        invalid: 0,
        live,
        fallback,
        urls,
        analysisComplete: analyzed.complete,
        analysisDegraded: analyzed.degraded,
        analysisSkipped: analyzed.skipped,
        analysisFailed: analyzed.failed,
      }
    } finally {
      setIngesting(false)
    }
  }, [])

  const ingestForeplaySearch = useCallback(
    async (
      params: ForeplaySearchParams,
      marketId: string,
      deepAnalysis = true,
    ): Promise<ForeplayIngestResult> => {
      setIngesting(true)
      try {
        const ads = await searchForeplayAds(params)
        const existingKeys = new Set(
          hotItemsRef.current.map((h) => h.dedupeKey),
        )
        const fresh: HotItem[] = []
        let skippedDup = 0

        for (const ad of ads) {
          const item = hotItemFromForeplayAd(ad, marketId)
          if (existingKeys.has(item.dedupeKey)) {
            skippedDup += 1
            continue
          }
          existingKeys.add(item.dedupeKey)
          fresh.push(item)
        }

        setLastIngestAt(new Date().toLocaleString('zh-CN', { hour12: false }))

        const analyzed = await analyzeHotItems(fresh, deepAnalysis)

        if (analyzed.items.length > 0) {
          const nextHot = [...analyzed.items, ...hotItemsRef.current]
          const result = runBreakdownAndMatch(
            automaticBreakdownCandidates(dedupeHotPool(nextHot)),
            breakdownsRef.current,
            matchesRef.current,
          )
          setHotItems(nextHot)
          setBreakdowns(result.breakdowns)
          setMatches(result.matches)
        }

        return {
          added: analyzed.items.length,
          skippedDup,
          fetched: ads.length,
          analysisComplete: analyzed.complete,
          analysisDegraded: analyzed.degraded,
          analysisSkipped: analyzed.skipped,
          analysisFailed: analyzed.failed,
        }
      } catch (e) {
        return {
          added: 0,
          skippedDup: 0,
          fetched: 0,
          error: e instanceof Error ? e.message : '搜索失败',
          analysisComplete: 0,
          analysisDegraded: 0,
          analysisSkipped: 0,
          analysisFailed: 0,
        }
      } finally {
        setIngesting(false)
      }
    },
    [],
  )

  const loadDemoData = useCallback(() => {
    const items = dedupeHotPool(DEMO_HOT_ITEMS)
    const result = runBreakdownAndMatch(
      automaticBreakdownCandidates(items),
      [],
      [],
    )
    const matches = result.matches.map((m) => {
      const preset = DEMO_MATCH_STATUS[m.id]
      if (!preset) return m
      if (preset === 'pushed') {
        return {
          ...m,
          status: 'pushed' as const,
          machineReviewNote: '机器审核通过，已自动推送本地化投放平台。',
        }
      }
      return { ...m, status: preset }
    })
    setHotItems(DEMO_HOT_ITEMS)
    setBreakdowns(result.breakdowns)
    setMatches(matches)
    setProduceCounts({ ...DEMO_PRODUCE_COUNTS })
    setLastIngestAt(new Date().toLocaleString('zh-CN', { hour12: false }))
    return result.breakdowns.length
  }, [])

  const updateHotItem = useCallback((id: string, patch: Partial<HotItem>) => {
    sourceRevisionRef.current.set(
      id,
      (sourceRevisionRef.current.get(id) ?? 0) + 1,
    )
    setHotItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const curatedFields = new Set<CuratedSourceField>(
          item.curatedSourceFields ?? [],
        )
        for (const field of curatedSourceFieldsInPatch(patch)) {
          curatedFields.add(field)
        }
        let nextPatch = patch
        if (Object.prototype.hasOwnProperty.call(patch, 'transcript')) {
          const skipsTranscript = !isVideoHotItem(item)
          nextPatch = {
            ...nextPatch,
            transcriptStatus: skipsTranscript
              ? 'skipped'
              : patch.transcript?.trim()
                ? 'ok'
                : 'missing',
            transcriptSource: skipsTranscript ? 'none' : 'human',
            transcriptVerification: skipsTranscript
              ? 'not_applicable'
              : 'verified',
            transcriptConflict: undefined,
          }
        }
        const candidate = {
          ...item,
          ...nextPatch,
          curatedSourceFields: Array.from(curatedFields),
        }
        const languageInputChanged =
          Object.prototype.hasOwnProperty.call(patch, 'transcript') ||
          Object.prototype.hasOwnProperty.call(patch, 'title') ||
          Object.prototype.hasOwnProperty.call(patch, 'caption')
        if (!languageInputChanged) return candidate

        const sourceMarket = resolveSourceMarket(
          isVideoHotItem(candidate)
            ? [
                candidate.transcript ?? '',
                candidate.multimodalAnalysis?.mm01.cleanedInputsForP02
                  .ocrText ?? '',
              ].join(' ')
            : '',
          `${candidate.caption ?? ''} ${candidate.title}`,
        )
        const targetMarket =
          candidate.targetMarketSource === 'user_override'
            ? {
                marketId: candidate.marketId,
                targetMarketSource: 'user_override' as const,
              }
            : targetMarketForSource('auto', sourceMarket.sourceMarketId)
        return { ...candidate, ...sourceMarket, ...targetMarket }
      }),
    )
  }, [])

  const changeTargetMarket = useCallback(
    (id: string, requestedMarketId: string) => {
      const current = hotItemsRef.current.find((item) => item.id === id)
      if (!current) return
      const currentMatch = matchesRef.current.find(
        (match) => match.hotItemId === id,
      )
      if (
        currentMatch?.status === 'producing' ||
        currentMatch?.status === 'pushed'
      ) {
        return
      }

      const sourceMarketId = current.sourceMarketId ?? current.marketId
      const followsSource = requestedMarketId === 'auto'
      const marketId = followsSource ? sourceMarketId : requestedMarketId
      const targetMarketSource = followsSource
        ? ('source_default' as const)
        : ('user_override' as const)
      sourceRevisionRef.current.set(
        id,
        (sourceRevisionRef.current.get(id) ?? 0) + 1,
      )
      setHotItems((previous) =>
        previous.map((item) =>
          item.id === id
            ? { ...item, marketId, targetMarketSource }
            : item,
        ),
      )
      setMatches((previous) =>
        previous.map((match) =>
          match.hotItemId === id
            ? {
                ...match,
                sourceMarketId,
                marketId,
                targetMarketSource,
                isCrossMarketRewrite: sourceMarketId !== marketId,
              }
            : match,
        ),
      )
    },
    [],
  )

  const reBreakdownItem = useCallback((id: string) => {
    const item = hotItemsRef.current.find((h) => h.id === id)
    if (!item || item.multimodalAnalysisStatus === 'failed') return
    const filteredB = breakdownsRef.current.filter((b) => b.hotItemId !== id)
    const filteredM = matchesRef.current.filter((m) => m.hotItemId !== id)
    const result = runBreakdownAndMatch([item], filteredB, filteredM)
    setBreakdowns(result.breakdowns)
    setMatches(result.matches)
  }, [])

  const reanalyzeSource = useCallback(async (id: string) => {
    const previousMatch = matchesRef.current.find(
      (match) => match.hotItemId === id,
    )
    const locked =
      previousMatch?.status === 'producing' ||
      previousMatch?.status === 'pushed'
    if (locked) return 'locked' as const

    const requestedItem = hotItemsRef.current.find((item) => item.id === id)
    if (!requestedItem) return 'missing' as const
    const requestNumber = (analysisRequestRef.current.get(id) ?? 0) + 1
    analysisRequestRef.current.set(id, requestNumber)
    const requestedRevision = sourceRevisionRef.current.get(id) ?? 0
    const preserveFields = new Set<CuratedSourceField>(
      requestedItem.curatedSourceFields ?? [],
    )

    setIngesting(true)
    try {
      let analyzed: HotItem
      try {
        const service = await getMultimodalServiceStatus()
        if (!service.enabled || !service.authorized || !service.configured) {
          analyzed = {
            ...requestedItem,
            multimodalAnalysisStatus: 'skipped',
            multimodalAnalysisError: !service.enabled
              ? '多模态分析服务当前未启用。'
              : !service.authorized
                ? '当前请求未获多模态分析权限。'
                : '服务端尚未配置当前多模态模型。',
          }
        } else {
          analyzed = await analyzeHotItem(requestedItem, { preserveFields })
        }
      } catch (error) {
        analyzed = {
          ...requestedItem,
          multimodalAnalysisStatus: 'failed',
          multimodalAnalysisError:
            error instanceof Error ? error.message : '多模态服务状态不可用',
        }
      }

      const latestItem = hotItemsRef.current.find((item) => item.id === id)
      if (!latestItem) return 'missing' as const
      if (
        analysisRequestRef.current.get(id) !== requestNumber ||
        (sourceRevisionRef.current.get(id) ?? 0) !== requestedRevision ||
        multimodalAnalysisInputChanged(requestedItem, latestItem)
      ) {
        return 'stale' as const
      }

      const analysisStatus = analyzed.multimodalAnalysisStatus
      const status =
        !analysisStatus || analysisStatus === 'analyzing'
          ? 'failed'
          : analysisStatus
      const terminalAnalyzed: HotItem =
        status === analysisStatus
          ? analyzed
          : {
              ...analyzed,
              multimodalAnalysisStatus: 'failed',
              multimodalAnalysisError:
                analyzed.multimodalAnalysisError || '多模态分析未返回有效终态。',
            }
      const storedItem = retainFailedGateAfterUnsuccessfulRetry(
        requestedItem,
        terminalAnalyzed,
      )
      const reportedStatus =
        storedItem.multimodalAnalysisStatus === 'failed' ? 'failed' : status
      const nextHot = hotItemsRef.current.map((item) =>
        item.id === id ? storedItem : item,
      )
      setHotItems(nextHot)
      if (status === 'complete' || status === 'degraded') {
        const filteredBreakdowns = breakdownsRef.current.filter(
          (breakdown) => breakdown.hotItemId !== id,
        )
        const filteredMatches = matchesRef.current.filter(
          (match) => match.hotItemId !== id,
        )
        const result = runBreakdownAndMatch(
          [analyzed],
          filteredBreakdowns,
          filteredMatches,
        )
        const reviewedMatch =
          previousMatch?.status === 'screened_in' ||
          previousMatch?.status === 'screened_out'
            ? previousMatch
            : null
        const refreshedMatches = reviewedMatch
          ? result.matches.some((match) => match.hotItemId === id)
            ? result.matches.map((match) =>
                match.hotItemId === id
                  ? preserveReviewedMatch(match, reviewedMatch)
                  : match,
              )
            : [reviewedMatch, ...result.matches]
          : result.matches
        setBreakdowns(result.breakdowns)
        setMatches(refreshedMatches)
      }
      return reportedStatus
    } finally {
      setIngesting(false)
    }
  }, [])

  const screenIn = useCallback((id: string) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.id === id &&
        m.status === 'matched' &&
        !hotItemIsBlocked(hotItemsRef.current, m.hotItemId)
          ? { ...m, status: 'screened_in' }
          : m,
      ),
    )
  }, [])

  const screenOut = useCallback((id: string) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.id === id &&
        (m.status === 'matched' || m.status === 'screened_in') &&
        !hotItemIsBlocked(hotItemsRef.current, m.hotItemId)
          ? { ...m, status: 'screened_out' }
          : m,
      ),
    )
  }, [])

  const changeProduceForm = useCallback((id: string, form: ProduceForm) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.id === id && !hotItemIsBlocked(hotItemsRef.current, m.hotItemId)
          ? rebuildCardForForm(m, form)
          : m,
      ),
    )
  }, [])

  const changePlacement = useCallback(
    (id: string, placement: PlacementMode) => {
      setMatches((prev) =>
        prev.map((m) =>
          m.id === id && !hotItemIsBlocked(hotItemsRef.current, m.hotItemId)
            ? rebuildCardForPlacement(m, placement)
            : m,
        ),
      )
    },
    [],
  )

  const startProduce = useCallback((id: string) => {
    setMatches((prev) =>
      prev.map((m) =>
        m.id === id &&
        m.status === 'screened_in' &&
        !hotItemIsBlocked(hotItemsRef.current, m.hotItemId)
          ? { ...m, status: 'producing' }
          : m,
      ),
    )
  }, [])

  const finishProduceAndPush = useCallback((id: string) => {
    let pushedHotId: string | null = null
    setMatches((prev) =>
      prev.map((m) => {
        if (
          m.id === id &&
          (m.status === 'producing' || m.status === 'screened_in') &&
          !hotItemIsBlocked(hotItemsRef.current, m.hotItemId)
        ) {
          pushedHotId = m.hotItemId
          return {
            ...m,
            status: 'pushed',
            machineReviewNote: '机器审核通过，已自动推送本地化投放平台。',
          }
        }
        return m
      }),
    )
    if (pushedHotId) {
      const hotId = pushedHotId
      setProduceCounts((prev) => ({
        ...prev,
        [hotId]: (prev[hotId] ?? 0) + 1,
      }))
    }
  }, [])

  const activeBreakdowns = useMemo(
    () => activeDerivedRecords(breakdowns, hotItems),
    [breakdowns, hotItems],
  )
  const activeMatches = useMemo(
    () => activeDerivedRecords(matches, hotItems),
    [matches, hotItems],
  )
  const pendingScreen = useMemo(
    () => activeMatches.filter((m) => m.status === 'matched'),
    [activeMatches],
  )
  const inProduction = useMemo(
    () =>
      activeMatches.filter(
        (m) => m.status === 'screened_in' || m.status === 'producing',
      ),
    [activeMatches],
  )
  const pushed = useMemo(
    () => activeMatches.filter((m) => m.status === 'pushed'),
    [activeMatches],
  )
  const returnedToPool = useMemo(
    () => activeBreakdowns.filter((b) => b.fit.returnToHotPool),
    [activeBreakdowns],
  )
  const reusableDirect = useMemo(
    () => activeBreakdowns.filter((b) => b.fit.kind === 'direct'),
    [activeBreakdowns],
  )

  const value: AppState = {
    hotItems,
    trendSummaries,
    breakdowns: activeBreakdowns,
    matches: activeMatches,
    lastIngestAt,
    ingesting,
    produceCounts,
    ingestLinks,
    ingestForeplaySearch,
    loadDemoData,
    updateHotItem,
    changeTargetMarket,
    reBreakdownItem,
    reanalyzeSource,
    screenIn,
    screenOut,
    changeProduceForm,
    changePlacement,
    startProduce,
    finishProduceAndPush,
    dedupedPool,
    pendingScreen,
    inProduction,
    pushed,
    returnedToPool,
    reusableDirect,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
