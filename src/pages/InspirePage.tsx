import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArtifactLinks } from '../components/ArtifactLinks.tsx'
import type { MultimodalAnalysisBundle } from '../contracts/multimodalAnalysis'
import { MARKETS } from '../data/markets'
import {
  AXIS_LABELS,
  EMOTION_LABELS,
  FIT_LABELS,
  PLOT_LABELS,
} from '../lib/breakdown'
import { PRODUCE_FORM_LABELS } from '../lib/autoMatch'
import { AUTO_MARKET_ID, extractUrls } from '../lib/linkIngest'
import { validateMarketRules } from '../lib/marketRouting'
import {
  analysisModeSummary,
  fusionGeminiLaneSummary,
  fusionSeedInputSummary,
  geminiVideoProcessingSummary,
  getMultimodalServiceStatus,
  type MultimodalServiceStatus,
} from '../lib/multimodalAnalysis'
import {
  localKeyframeResultNotice,
  multimodalPreprocessingNotice,
} from '../lib/multimodalNotices'
import { canonicalPublicHttpUrl } from '../lib/publicUrl'
import { subscribeRuntimeApiSettings } from '../lib/apiAccess'
import { buildStorySummary, inferMaterialTheme } from '../lib/storyFromTranscript'
import {
  buildPromptChain,
  serializePromptChain,
  type PromptStep,
} from '../prompts/pipeline'
import { canEnterAutomaticBreakdown, useApp } from '../state'
import type { HotItem, InspirationBreakdown } from '../types'

const SAMPLE_LINKS = `https://www.tiktok.com/@applemango.storys/video/7659208562056400135
https://www.instagram.com/reel/DXW-4lvtAQT/
https://www.facebook.com/reel/1535656380759655`

type InputMode = 'paste' | 'upload' | 'search'

const FOREPLAY_PLATFORMS = [
  { value: '', label: '全部平台' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
]

interface AnalysisCounters {
  analysisComplete: number
  analysisDegraded: number
  analysisSkipped: number
  analysisFailed: number
}

type ReanalysisStatus =
  | 'complete'
  | 'degraded'
  | 'skipped'
  | 'failed'
  | 'locked'
  | 'missing'
  | 'stale'

function analysisOutcomeSummary(result: AnalysisCounters): string {
  const total =
    result.analysisComplete +
    result.analysisDegraded +
    result.analysisSkipped +
    result.analysisFailed
  if (total === 0) return ''
  return ` 多模态：完整 ${result.analysisComplete} / 降级 ${result.analysisDegraded} / 跳过 ${result.analysisSkipped} / 失败 ${result.analysisFailed}。`
}

function reanalysisOutcomeMessage(status: ReanalysisStatus): string {
  return status === 'complete'
    ? '多模态分析完成，已基于 MM01/C01/P02 证据重新拆解和分流。'
    : status === 'degraded'
      ? '多模态分析完成，但存在缺失模态、字幕冲突或人工复核项；原始证据已保留。'
      : status === 'skipped'
        ? '当前多模态模型未配置、服务未授权或素材不是视频，本次已安全跳过。'
        : status === 'locked'
          ? '素材已进入制作或投放，为避免覆盖版本，本次没有回写。'
          : status === 'stale'
            ? '分析期间素材被修改，旧结果未回写；请按当前内容重试。'
            : status === 'missing'
              ? '没有找到这条素材。'
              : '多模态分析失败，已保留原素材且没有进入后续拆解或筛选。'
}

function multimodalServiceLabel(
  status: MultimodalServiceStatus | null,
  error: string,
): string {
  if (error) return `状态读取失败：${error}`
  if (!status) return '正在读取多模态模型状态…'
  if (!status.enabled) return '多模态分析服务当前未启用。'
  if (!status.authorized) {
    return status.requiresAccessToken
      ? '需要在 API 设置中填写团队访问口令。'
      : '当前请求未获多模态分析权限。'
  }
  if (!status.configured) {
    if (!status.downstream.configured) {
      return 'C01 搜索 / P02 文本模型尚未配置；MM01 不会被误报为整条链可用，请在 API 设置中补齐临时密钥或服务端配置。'
    }
    return '当前选择的 MM01 多模态模型尚未配置；开启也会安全跳过，不影响原有解析链路。'
  }
  if (
    status.profile === 'kimi-k3' &&
    !status.capabilities.videoInline &&
    !status.capabilities.sceneKeyframes
  ) {
    return `完整链路已配置（上游可用性以真实调用为准）· MM01 ${status.model} 当前仅图片输入可用 · C01 ${status.downstream.c01Model} · P02 ${status.downstream.p02Model}`
  }
  if (status.profile === 'fusion') {
    return `完整链路已配置（上游可用性以真实调用为准）· Seed 细看画面，Gemini 复核音轨、暗线与语义 · C01 ${status.downstream.c01Model} · P02 ${status.downstream.p02Model} · 每条视频基础 ${status.pipeline.modelCalls} 次模型调用，修复重试另计`
  }
  const audioNote = status.capabilities.audio
    ? '画面与音轨'
    : '画面可用，音轨按缺失处理'
  return `完整链路已配置（上游可用性以真实调用为准）· MM01 ${status.model} · C01 ${status.downstream.c01Model} · P02 ${status.downstream.p02Model} · ${audioNote} · 每条视频基础 ${status.pipeline.modelCalls} 次模型调用，修复重试另计`
}

export function InspirePage() {
  const {
    hotItems,
    breakdowns,
    matches,
    lastIngestAt,
    ingesting,
    ingestLinks,
    ingestForeplaySearch,
    loadDemoData,
    updateHotItem,
    changeTargetMarket,
    reBreakdownItem,
    reanalyzeSource,
    pendingScreen,
  } = useApp()

  const [marketId, setMarketId] = useState(AUTO_MARKET_ID)
  const [raw, setRaw] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<InputMode>('paste')
  const [fileName, setFileName] = useState<string | null>(null)
  const [deepAnalysis, setDeepAnalysis] = useState(true)
  const [multimodalStatus, setMultimodalStatus] =
    useState<MultimodalServiceStatus | null>(null)
  const [multimodalStatusError, setMultimodalStatusError] = useState('')

  const [fpQuery, setFpQuery] = useState('')
  const [fpNiche, setFpNiche] = useState('')
  const [fpFormat, setFpFormat] = useState<'' | 'video' | 'image'>('')
  const [fpPlatform, setFpPlatform] = useState('')
  const [fpLimit, setFpLimit] = useState(10)

  useEffect(() => {
    let active = true
    let statusRequest = 0
    async function refreshStatus() {
      const requestNumber = ++statusRequest
      try {
        const status = await getMultimodalServiceStatus()
        if (!active || requestNumber !== statusRequest) return
        setMultimodalStatus(status)
        setMultimodalStatusError('')
      } catch (error) {
        if (!active || requestNumber !== statusRequest) return
        setMultimodalStatus(null)
        setMultimodalStatusError(
          error instanceof Error ? error.message : '多模态服务状态不可用',
        )
      }
    }
    void refreshStatus()
    const unsubscribe = subscribeRuntimeApiSettings(() => void refreshStatus())
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const hotById = useMemo(
    () => new Map(hotItems.map((h) => [h.id, h])),
    [hotItems],
  )

  const failedAnalysisItems = useMemo(
    () => hotItems.filter((item) => !canEnterAutomaticBreakdown(item)),
    [hotItems],
  )

  const visibleBreakdowns = useMemo(
    () =>
      breakdowns.filter((breakdown) => {
        const item = hotById.get(breakdown.hotItemId)
        return !item || canEnterAutomaticBreakdown(item)
      }),
    [breakdowns, hotById],
  )

  const stats = useMemo(() => {
    const direct = visibleBreakdowns.filter((b) => b.fit.kind === 'direct').length
    const rewrite = visibleBreakdowns.filter((b) => b.fit.kind === 'rewrite').length
    const none = visibleBreakdowns.filter((b) => b.fit.kind === 'none').length
    return { direct, rewrite, none }
  }, [visibleBreakdowns])

  async function onSubmit() {
    setMsg(null)
    const result = await ingestLinks(raw, marketId, deepAnalysis)
    if (result.urls.length === 0) {
      setMsg('未识别到有效链接，请每行粘贴一条 TikTok / IG / Meta 链接。')
      return
    }
    setMsg(
      `已处理 ${result.urls.length} 条：新增 ${result.added}（实拉 ${result.live} / 兜底 ${result.fallback}），重复跳过 ${result.skippedDup}。${analysisOutcomeSummary(result)}直配/改写将进入筛选。`,
    )
    setRaw('')
    setFileName(null)
  }

  async function onForeplaySearch() {
    setMsg(null)
    if (!fpQuery.trim() && !fpNiche.trim()) {
      setMsg('请至少填写关键词或品类（niche）再搜索。')
      return
    }
    const result = await ingestForeplaySearch(
      {
        query: fpQuery,
        niche: fpNiche,
        displayFormat: fpFormat,
        publisherPlatform: fpPlatform,
        limit: fpLimit,
      },
      marketId,
      deepAnalysis,
    )
    if (result.error) {
      setMsg(`Foreplay 搜索失败：${result.error}（请确认 .env.local 已填 FOREPLAY_API_KEY）`)
      return
    }
    setMsg(
      `Foreplay 搜到 ${result.fetched} 条广告：新增 ${result.added}，重复跳过 ${result.skippedDup}。${analysisOutcomeSummary(result)}已自动拆解并分流，直配/改写进入筛选。`,
    )
  }

  function onLoadDemo() {
    const n = loadDemoData()
    setRaw('')
    setFileName(null)
    setMsg(
      `已载入 ${n} 条虚拟示例（免爬取）：含直配 / 改写 / 退回，并预置「已投放 / 已淘汰 / 制作中」等状态，可直接体验后续筛选→制作→投放，或到「热点库」归档查看。`,
    )
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMsg(null)
    setFileName(file.name)
    const text = await file.text()
    setRaw(text)
    const found = extractUrls(text)
    setMsg(
      found.length > 0
        ? `已从《${file.name}》解析到 ${found.length} 条链接，点击「识别内容并拆解」继续。`
        : `未在《${file.name}》中识别到有效链接，请检查文档内容。`,
    )
  }

  async function retryMultimodalAnalysis(id: string) {
    const status = await reanalyzeSource(id)
    setMsg(reanalysisOutcomeMessage(status))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>① 输入素材 · 灵感拆解</h1>
          <p>粘贴热帖链接（ScrapeCreators）或按关键词/品类搜竞品广告（Foreplay），拆成故事并做卖点分流。</p>
        </div>
        <Link className="btn btn-primary" to="/screen">
          下一步：人工筛选（{pendingScreen.length}）
        </Link>
      </div>

      <div className="panel demo-hint">
        <div>
          <strong>快速体验：</strong>
          <span className="muted">
            无需真实爬取，一键载入虚拟示例素材，直接走完拆解 → 筛选 → 制作 →
            投放全流程。
          </span>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={ingesting}
          onClick={onLoadDemo}
        >
          载入示例数据（免爬取）
        </button>
      </div>

      <div className="panel">
        <h2>获取素材</h2>
        <div className="filters">
          <label className="muted">投放市场</label>
          <select
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
          >
            <option value={AUTO_MARKET_ID}>跟随来源市场（默认）</option>
            {MARKETS.map((m) => (
              <option key={m.id} value={m.id}>
                P{m.priority} {m.name}
              </option>
            ))}
          </select>
        </div>
        <label className="analysis-toggle">
          <input
            type="checkbox"
            checked={deepAnalysis}
            onChange={(event) => setDeepAnalysis(event.target.checked)}
          />
          <span>
            <strong>深度多模态拆解</strong>
            <small>
              服务端优先把完整视频交给所选模型处理画面与声音；FFmpeg/ffprobe 负责本地时长与音轨核验、压缩转码和带时间戳关键帧。可用模态通过校验后，再由本地确定性编译 P02F 并交给 P02。
            </small>
            <small>
              {multimodalServiceLabel(
                multimodalStatus,
                multimodalStatusError,
              )}
            </small>
          </span>
        </label>
        {multimodalPreprocessingNotice(multimodalStatus) && (
          <div
            className="analysis-warning analysis-preflight-warning"
            role="status"
            aria-live="polite"
          >
            <strong>本地视频预处理能力受限</strong>
            <p>{multimodalPreprocessingNotice(multimodalStatus)}</p>
          </div>
        )}
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <button
            className={inputMode === 'search' ? 'btn btn-primary' : 'btn'}
            type="button"
            onClick={() => setInputMode('search')}
          >
            关键词搜广告（Foreplay）
          </button>
          <button
            className={inputMode === 'paste' ? 'btn btn-primary' : 'btn'}
            type="button"
            onClick={() => setInputMode('paste')}
          >
            直接粘贴链接
          </button>
          <button
            className={inputMode === 'upload' ? 'btn btn-primary' : 'btn'}
            type="button"
            onClick={() => setInputMode('upload')}
          >
            上传文档解析
          </button>
        </div>
        {inputMode === 'search' ? (
          <div>
            <div className="field">
              <label>关键词（query）</label>
              <input
                value={fpQuery}
                onChange={(e) => setFpQuery(e.target.value)}
                placeholder="如：skincare、language learning、travel translator"
              />
            </div>
            <div className="filters" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>品类 niche（可选）</label>
                <input
                  value={fpNiche}
                  onChange={(e) => setFpNiche(e.target.value)}
                  placeholder="如：accessories"
                  style={{ minWidth: 160 }}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>形态</label>
                <select
                  value={fpFormat}
                  onChange={(e) =>
                    setFpFormat(e.target.value as '' | 'video' | 'image')
                  }
                >
                  <option value="">图片 + 视频</option>
                  <option value="video">仅视频</option>
                  <option value="image">仅图片</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>平台</label>
                <select
                  value={fpPlatform}
                  onChange={(e) => setFpPlatform(e.target.value)}
                >
                  {FOREPLAY_PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>数量</label>
                <select
                  value={fpLimit}
                  onChange={(e) => setFpLimit(Number(e.target.value))}
                >
                  {[5, 10, 20, 30].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mono muted" style={{ marginTop: 8 }}>
              每条广告消耗 1 个 Foreplay credit，返回素材直链 + 字幕 + 情绪信号，直接进入拆解。
            </p>
          </div>
        ) : inputMode === 'paste' ? (
          <div className="field">
            <label>链接列表（一行一条）</label>
            <textarea
              rows={6}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="https://www.tiktok.com/@...&#10;https://www.instagram.com/reel/..."
            />
          </div>
        ) : (
          <div className="field">
            <label>上传文档（.txt / .csv / .md，自动提取其中的链接）</label>
            <input
              type="file"
              accept=".txt,.csv,.md,.tsv,text/plain"
              onChange={(e) => void onFile(e)}
            />
            {fileName && (
              <p className="mono muted" style={{ marginBottom: 0 }}>
                已选择：{fileName}
              </p>
            )}
            {raw.trim() && (
              <textarea
                rows={6}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="解析出的链接会显示在这里，可继续编辑"
              />
            )}
          </div>
        )}
        <div className="toolbar">
          {inputMode === 'search' ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={ingesting || (!fpQuery.trim() && !fpNiche.trim())}
              onClick={() => void onForeplaySearch()}
            >
              {ingesting ? '搜索并拆解中…' : '搜广告并拆解'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              disabled={ingesting || !raw.trim()}
              onClick={() => void onSubmit()}
            >
              {ingesting ? '识别并拆解中…' : '识别内容并拆解'}
            </button>
          )}
          {inputMode === 'paste' && (
            <button
              className="btn"
              type="button"
              onClick={() => setRaw(SAMPLE_LINKS)}
            >
              填入示例链接
            </button>
          )}
          {inputMode === 'search' && (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setFpQuery('skincare')
                setFpFormat('video')
              }}
            >
              填入示例搜索
            </button>
          )}
        </div>
        {msg && <p className="muted">{msg}</p>}
        {lastIngestAt && (
          <p className="mono muted" style={{ marginBottom: 0 }}>
            最近入库 {lastIngestAt}
          </p>
        )}
      </div>

      <div className="grid-stats">
        <div className="stat">
          <label>已入库链接</label>
          <strong>{hotItems.length}</strong>
        </div>
        <div className="stat">
          <label>直配</label>
          <strong>{stats.direct}</strong>
        </div>
        <div className="stat">
          <label>改写可配</label>
          <strong>{stats.rewrite}</strong>
        </div>
        <div className="stat">
          <label>软植入不匹配</label>
          <strong>{stats.none}</strong>
        </div>
      </div>

      <div className="panel">
        <h2>拆解结果</h2>
        {failedAnalysisItems.length === 0 && visibleBreakdowns.length === 0 && (
          <div className="empty">先粘贴链接并点击「识别内容并拆解」。</div>
        )}
        {failedAnalysisItems.length > 0 && (
          <div className="card-list">
            {failedAnalysisItems.map((hot) => (
              <article className="insp-card" key={`failed-${hot.id}`}>
                <div>
                  <h3>{hot.title}</h3>
                  <div className="meta-row" style={{ marginBottom: 8 }}>
                    {hot.recognition === 'live' && (
                      <span className="tag ok">实拉识别</span>
                    )}
                    <span className="tag danger">多模态未通过 · 后续拆解已阻断</span>
                    <ArtifactLinks artifact={hot.artifact} />
                  </div>
                  <div className="analysis-warning" role="alert">
                    <strong>多模态分析失败，素材已保留</strong>
                    <p>
                      {hot.multimodalAnalysisError ||
                        '模型结果不足以支持可靠拆解，请重新进行多模态分析。'}
                    </p>
                  </div>
                  {hot.artifactWarning && (
                    <p className="muted">档案说明：{hot.artifactWarning}</p>
                  )}
                  {hot.sourceUrl && (
                    <p className="mono muted">
                      {canonicalPublicHttpUrl(hot.sourceUrl) ? (
                        <a
                          href={canonicalPublicHttpUrl(hot.sourceUrl)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {hot.sourceUrl}
                        </a>
                      ) : (
                        hot.sourceUrl
                      )}
                    </p>
                  )}
                  <button
                    className="btn"
                    type="button"
                    disabled={ingesting}
                    aria-label={`重新多模态分析：${hot.title}`}
                    onClick={() => void retryMultimodalAnalysis(hot.id)}
                  >
                    {ingesting ? '多模态分析中…' : '重新多模态分析'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {visibleBreakdowns.length > 0 && (
          <div className="card-list">
            {visibleBreakdowns.map((b) => {
              const hot = hotById.get(b.hotItemId)
              const match = matches.find((m) => m.hotItemId === b.hotItemId)
              const sourceMarketId = hot?.sourceMarketId ?? hot?.marketId
              const sourceMarket = MARKETS.find(
                (candidate) => candidate.id === sourceMarketId,
              )
              const targetMarket = MARKETS.find(
                (candidate) => candidate.id === hot?.marketId,
              )
              const fitClass =
                b.fit.kind === 'direct'
                  ? 'ok'
                  : b.fit.kind === 'rewrite'
                    ? 'warn'
                    : 'danger'
              return (
                <article className="insp-card" key={b.hotItemId}>
                  <div>
                    <h3>{hot?.title ?? b.hotItemId}</h3>
                    <div className="meta-row" style={{ marginBottom: 8 }}>
                      {hot?.recognition === 'live' && (
                        <span className="tag ok">实拉识别</span>
                      )}
                      {hot?.transcriptStatus === 'ok' && (
                        <span className="tag ok">
                          字幕已核验 · {hot.transcriptSource ?? '未知来源'}
                        </span>
                      )}
                      {hot?.transcriptStatus === 'partial' && (
                        <span className="tag warn">字幕部分可用</span>
                      )}
                      {hot?.transcriptStatus === 'missing' && (
                        <span className="tag warn">无字幕/无口播</span>
                      )}
                      {hot?.transcriptStatus === 'failed' && (
                        <span className="tag danger">字幕拉取失败</span>
                      )}
                      {hot?.transcriptStatus === 'conflict' && (
                        <span className="tag danger">Provider / 音轨字幕冲突</span>
                      )}
                      {hot?.transcriptStatus === 'skipped' && (
                        <span className="tag">非视频·跳过字幕</span>
                      )}
                      {hot?.recognition === 'fallback' && (
                        <span className="tag danger">识别失败·可手改</span>
                      )}
                      {hot?.multimodalAnalysisStatus === 'complete' && (
                        <span className="tag ok">MM01 + P02 完整</span>
                      )}
                      {hot?.multimodalAnalysisStatus === 'degraded' && (
                        <span className="tag warn">多模态需复核</span>
                      )}
                      {hot?.multimodalAnalysisStatus === 'skipped' && (
                        <span className="tag">多模态已跳过</span>
                      )}
                      {hot?.multimodalAnalysisStatus === 'failed' && (
                        <span className="tag danger">多模态失败</span>
                      )}
                      <ArtifactLinks artifact={hot?.artifact} />
                      {typeof hot?.likes === 'number' && hot.likes > 0 && (
                        <span className="tag">赞 {hot.likes.toLocaleString()}</span>
                      )}
                      {typeof hot?.views === 'number' && hot.views > 0 && (
                        <span className="tag">
                          播 {hot.views.toLocaleString()}
                        </span>
                      )}
                    </div>
                    {hot?.recognitionError && (
                      <p className="muted">原因：{hot.recognitionError}</p>
                    )}
                    {hot?.multimodalAnalysisError && (
                      <p className="muted">
                        多模态说明：{hot.multimodalAnalysisError}
                      </p>
                    )}
                    {hot?.artifactWarning && (
                      <p className="muted">档案说明：{hot.artifactWarning}</p>
                    )}
                    {hot?.transcriptConflict && (
                      <div className="analysis-warning transcript-conflict">
                        <strong>字幕证据冲突，已隔离并保留原拆解</strong>
                        <p>{hot.transcriptConflict.reason}</p>
                        <p className="mono">
                          Provider：{hot.transcriptConflict.providerTranscript || '无'}
                        </p>
                        <p className="mono">
                          模型音轨：{hot.transcriptConflict.modelTranscript || '无'}
                        </p>
                      </div>
                    )}
                    {hot?.sourceUrl && (
                      <p className="mono muted">
                        {canonicalPublicHttpUrl(hot.sourceUrl) ? (
                          <a
                            href={canonicalPublicHttpUrl(hot.sourceUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {hot.sourceUrl}
                          </a>
                        ) : (
                          hot.sourceUrl
                        )}
                      </p>
                    )}
                    {hot && (
                      <div className="field">
                        <label>来源市场 / 最终投放市场</label>
                        <div className="meta-row" style={{ marginBottom: 8 }}>
                          <span
                            className={`tag ${
                              sourceMarketId === 'unknown' ? 'danger' : 'ok'
                            }`}
                          >
                            来源：
                            {sourceMarket?.name ?? sourceMarketId ?? 'unknown'}
                            {' · '}
                            {hot.sourceMarketEvidence === 'video_language'
                              ? '视频语言'
                              : hot.sourceMarketEvidence === 'post_language'
                                ? '帖文语言'
                                : '证据不足'}
                          </span>
                          <span className="tag">
                            投放：{targetMarket?.name ?? hot.marketId}
                          </span>
                          {sourceMarketId !== hot.marketId && (
                            <span className="tag warn">跨市场·交由 Shorts 本地化</span>
                          )}
                        </div>
                        <select
                          value={
                            hot.targetMarketSource === 'user_override'
                              ? hot.marketId
                              : AUTO_MARKET_ID
                          }
                          onChange={(event) =>
                            changeTargetMarket(hot.id, event.target.value)
                          }
                        >
                          <option value={AUTO_MARKET_ID}>
                            跟随来源市场（默认）
                          </option>
                          {MARKETS.map((market) => (
                            <option key={market.id} value={market.id}>
                              {market.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="field">
                      <label>素材主题（可改）</label>
                      <input
                        value={hot?.theme ?? ''}
                        onChange={(e) =>
                          updateHotItem(b.hotItemId, { theme: e.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>识别标题（可改）</label>
                      <input
                        value={hot?.title ?? ''}
                        onChange={(e) =>
                          updateHotItem(b.hotItemId, { title: e.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>字幕正文（可改）</label>
                      <textarea
                        rows={4}
                        value={hot?.transcript ?? ''}
                        onChange={(e) =>
                          updateHotItem(b.hotItemId, {
                            transcript: e.target.value,
                          })
                        }
                        placeholder="无字幕时可手工粘贴口播/字幕文本"
                      />
                    </div>
                    <div className="field">
                      <label>画面 / OCR / 镜头证据（可改）</label>
                      <textarea
                        rows={5}
                        value={hot?.visualDescription ?? ''}
                        onChange={(event) =>
                          updateHotItem(b.hotItemId, {
                            visualDescription: event.target.value,
                          })
                        }
                        placeholder="深度多模态拆解会在这里写入画面、人物动作、场景、镜头和屏幕文字；也可人工补充。"
                      />
                    </div>
                    <div className="field">
                      <label>
                        故事拆解（50–200 字，可改）
                        {hot?.oneLiner
                          ? ` · 当前 ${hot.oneLiner.length} 字`
                          : ''}
                      </label>
                      <textarea
                        rows={4}
                        value={hot?.oneLiner ?? ''}
                        onChange={(e) =>
                          updateHotItem(b.hotItemId, {
                            oneLiner: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="toolbar">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          if (!hot) return
                          const theme =
                            hot.theme?.trim() ||
                            inferMaterialTheme(
                              hot.title,
                              '',
                              hot.transcript ?? '',
                            )
                          const story = buildStorySummary({
                            title: hot.title,
                            caption: '',
                            transcript: hot.transcript ?? '',
                            theme,
                          })
                          updateHotItem(b.hotItemId, { theme, oneLiner: story })
                        }}
                      >
                        按字幕重生成故事
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => reBreakdownItem(b.hotItemId)}
                      >
                        按修改重拆解
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={ingesting || !hot}
                        onClick={() => {
                          if (!hot) return
                          void retryMultimodalAnalysis(hot.id)
                        }}
                      >
                        {ingesting ? '多模态分析中…' : '重新多模态分析'}
                      </button>
                    </div>
                    {hot?.multimodalAnalysis && (
                      <MultimodalAnalysisPanel
                        analysis={hot.multimodalAnalysis}
                      />
                    )}
                    <p style={{ marginTop: 12 }}>
                      <strong>核心梗：</strong>
                      {b.meme.core}
                    </p>
                    <div className="meta-row">
                      <span className="tag">{AXIS_LABELS[b.meme.axis]}</span>
                      {b.meme.emotionTone && (
                        <span className="tag">
                          {EMOTION_LABELS[b.meme.emotionTone]}
                        </span>
                      )}
                      {b.meme.plotDevice && (
                        <span className="tag">
                          {PLOT_LABELS[b.meme.plotDevice]}
                        </span>
                      )}
                      <span className={`tag ${fitClass}`}>
                        {FIT_LABELS[b.fit.kind]}
                      </span>
                      <span className="tag">
                        钩子 {b.meme.hookStrength === 'strong'
                          ? '强'
                          : b.meme.hookStrength === 'medium'
                            ? '中'
                            : '弱'}
                      </span>
                      {b.fit.placementOptions.map((mode) => (
                        <span key={mode} className={`tag ${mode === 'soft' ? 'ok' : 'warn'}`}>
                          可{mode === 'soft' ? '软植入' : '硬植入'}
                        </span>
                      ))}
                      {match && (
                        <span className="tag ok">
                          形态 {PRODUCE_FORM_LABELS[match.produceForm]}
                        </span>
                      )}
                      {b.fit.returnToHotPool && (
                        <span className="tag danger">退回热点库</span>
                      )}
                      {b.fit.enterScreening && (
                        <span className="tag ok">已进筛选队列</span>
                      )}
                    </div>
                    <p className="muted">{b.fit.reason}</p>
                    <p className="muted">钩子判断：{b.meme.hookReason}</p>
                    {b.fit.rewrittenScene && (
                      <p>
                        <strong>改写场景：</strong>
                        {b.fit.rewrittenScene}
                      </p>
                    )}
                    {hot && <PromptChainPanel hot={hot} breakdown={b} />}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const MEDIA_MODE_LABELS: Record<
  MultimodalAnalysisBundle['diagnostics']['mediaMode'],
  string
> = {
  video_inline_keyframes: '整片 inline + 场景关键帧',
  video_inline: '整片 inline',
  video_frames_audio: '关键帧 + 独立音频',
  video_frames: '仅关键帧',
  video_audio: '仅独立音频',
  image_inline: '原图 inline',
  text_only: '纯文本降级',
}

function audioProvenanceLabel(
  diagnostics: MultimodalAnalysisBundle['diagnostics'],
): string | undefined {
  const source = diagnostics.sourceAudioTrack
  const input = diagnostics.audioInputProvenance
  if (source === undefined && input === undefined) return undefined
  if (source === 'absent') return '原视频已确认无音轨'
  if (source === 'not_applicable') return '非视频素材'
  if (input === 'inline_video') return '原音轨已随完整视频送达'
  if (input === 'separate_audio') return '原音轨已作为独立音频送达'
  if (input === 'none') return '未向模型提供音轨'
  return source === 'present'
    ? '源音轨已确认，输入状态待核验'
    : '源音轨与输入状态未确认'
}

const MODALITY_STATUS_LABELS = {
  ok: '完整',
  partial: '部分',
  missing: '缺失',
  failed: '失败',
} as const

const MODEL_PROVIDER_LABELS: Record<
  MultimodalAnalysisBundle['diagnostics']['provider'],
  string
> = {
  gemini: 'Gemini',
  kimi: 'Kimi',
  seed: 'Seed 2.1 Pro',
  fusion: 'Gemini × Seed 融合',
}

const MODEL_ROLE_LABELS = {
  visual_detail: '画面 / OCR / 镜头取证',
  multimodal_synthesis: '暗线 / 音频 / 语义融合',
  context_research: 'C01 外部语境检索',
  p02: 'P02 事实拆解',
} as const

const REPORTED_MODEL_STAGE_LABELS = {
  mm01: 'MM01',
  c01: 'C01',
  p02: 'P02',
} as const

const FUSION_ADOPTION_LABELS = {
  gemini: '采用 Gemini',
  seed: '采用 Seed',
  both: '综合两者',
  unresolved: '保留待核验',
} as const

function modalityStatusClass(status: keyof typeof MODALITY_STATUS_LABELS) {
  return status === 'ok' ? 'ok' : status === 'partial' ? 'warn' : 'danger'
}

export function MultimodalAnalysisPanel({
  analysis,
  defaultOpen = false,
}: {
  analysis: MultimodalAnalysisBundle
  defaultOpen?: boolean
}) {
  const {
    mm01,
    contextResearch,
    p02Handoff,
    p02,
    diagnostics,
    fusionReview,
  } = analysis
  const [open, setOpen] = useState(defaultOpen)
  const modalityRows = [
    ['视频帧', mm01.modalityStatus.videoFrames],
    ['OCR', mm01.modalityStatus.ocr],
    ['ASR', mm01.modalityStatus.asr],
    ['音频', mm01.modalityStatus.audio],
  ] as const
  const style = mm01.globalUnderstanding.localStyleSignals
  const geminiVideoProcessing = geminiVideoProcessingSummary(diagnostics)
  const audioProvenance = audioProvenanceLabel(diagnostics)
  const fusionGeminiLane = fusionGeminiLaneSummary(
    diagnostics,
    mm01.modalityStatus,
  )
  const keyframeNotice = localKeyframeResultNotice(diagnostics)

  return (
    <details
      className="analysis-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        MM01 → C01 → 本地 P02F → P02 ·{' '}
        {analysisModeSummary(mm01.modalityStatus)}
      </summary>

      {open && (
        <>
      <div className="meta-row analysis-coverage">
        <span className="tag ok">
          {MODEL_PROVIDER_LABELS[diagnostics.provider]} · 请求模型 {diagnostics.model}
        </span>
        {diagnostics.reportedModels?.map((reported) => (
          <span className="tag" key={`${reported.stage}-${reported.model}`}>
            上游报告 {REPORTED_MODEL_STAGE_LABELS[reported.stage]} · {reported.model}
          </span>
        ))}
        {diagnostics.models?.map((trace, index) => (
          <span
            className="tag"
            key={`${trace.role}-${trace.provider}-${trace.model}-${index}`}
          >
            {MODEL_ROLE_LABELS[trace.role]} · {trace.model}
          </span>
        ))}
        <span className="tag">{MEDIA_MODE_LABELS[diagnostics.mediaMode]}</span>
        {audioProvenance && <span className="tag">{audioProvenance}</span>}
        {geminiVideoProcessing && <span className="tag">{geminiVideoProcessing}</span>}
        <span className="tag">
          置信度上限 {mm01.modalityStatus.confidenceCap}
        </span>
        <span className="tag">模型调用 {diagnostics.modelCalls} 次</span>
        <span className="tag">
          耗时 {(diagnostics.elapsedMs / 1000).toFixed(1)} 秒
        </span>
        {diagnostics.durationSeconds !== undefined && (
          <span className="tag">
            视频 {diagnostics.durationSeconds.toFixed(1)} 秒
          </span>
        )}
        {diagnostics.keyframeCount !== undefined && (
          <span className="tag">关键帧 {diagnostics.keyframeCount}</span>
        )}
      </div>

      {keyframeNotice && (
        <div className="analysis-warning analysis-keyframe-warning" role="status">
          <strong>完整视频已送达，缺少本地关键帧</strong>
          <p>{keyframeNotice}</p>
        </div>
      )}

      {diagnostics.profile === 'fusion' && fusionReview && (
        <section className="analysis-section analysis-fusion">
          <div className="analysis-fusion-heading">
            <div>
              <span>DUAL MODEL TRACE</span>
              <h4>双模型融合复核摘要</h4>
            </div>
            <span className="tag ok">请求链可追溯</span>
          </div>
          <p className="analysis-fusion-intro">
            Seed 先补足画面、OCR 与镜头细节；{fusionGeminiLane.inputSummary}
            复核暗线。这里保存请求模型、计数与 Gemini 生成的复核摘要；Seed
            原始逐条报告当前未写入业务数据。
          </p>

          <div className="analysis-model-lanes">
            <article>
              <span className="analysis-model-mark seed">SEED</span>
              <div>
                <strong>Seed 2.1 Pro · 画面 / OCR / 镜头</strong>
                <p>承担视觉细节侦察，为最终 MM01 提供带时间位置的观察候选。</p>
                <div className="meta-row">
                  {diagnostics.models
                    ?.filter((trace) => trace.provider === 'seed')
                    .map((trace, index) => (
                      <span className="tag" key={`${trace.role}-${trace.model}-${index}`}>
                        {MODEL_ROLE_LABELS[trace.role]} · {trace.model}
                      </span>
                    ))}
                </div>
              </div>
            </article>
            <article>
              <span className="analysis-model-mark gemini">GEM</span>
              <div>
                <strong>Gemini · {fusionGeminiLane.focusLabel}</strong>
                <p>{fusionGeminiLane.description}</p>
                <div className="meta-row">
                  {diagnostics.models
                    ?.filter((trace) => trace.provider === 'gemini')
                    .map((trace, index) => (
                      <span className="tag" key={`${trace.role}-${trace.model}-${index}`}>
                        {MODEL_ROLE_LABELS[trace.role]} · {trace.model}
                      </span>
                    ))}
                </div>
              </div>
            </article>
          </div>

          {diagnostics.fusion && (
            <p className="analysis-fusion-stats muted">
              {fusionSeedInputSummary(diagnostics.fusion)}，返回{' '}
              {diagnostics.fusion.seedObservationCount}{' '}
              条采样画面观察与 {diagnostics.fusion.seedSequenceCount}{' '}
              段连续动作序列；融合策略：Seed 先视觉取证，Gemini 再结合原媒体做多模态复核。
            </p>
          )}

          <div className="analysis-fusion-grid">
            <article>
              <strong>模型共识</strong>
              {fusionReview.consensus.length > 0 ? (
                <ul>
                  {fusionReview.consensus.map((item, index) => (
                    <li key={`consensus-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">本次没有形成可单列的模型共识。</p>
              )}
            </article>
            <article>
              <strong>最终采用结论</strong>
              <p>{fusionReview.finalConclusion}</p>
            </article>
          </div>

          <div className="analysis-conflicts">
            <h5>冲突与裁决（{fusionReview.conflicts.length}）</h5>
            {fusionReview.conflicts.length === 0 ? (
              <p className="muted">两路分析没有发现需要单独裁决的关键分歧。</p>
            ) : (
              fusionReview.conflicts.map((conflict, index) => (
                <article key={`${conflict.topic}-${index}`}>
                  <div>
                    <strong>{conflict.topic}</strong>
                    <span className={`tag fusion-adoption-${conflict.adoptedFrom}`}>
                      {FUSION_ADOPTION_LABELS[conflict.adoptedFrom]}
                    </span>
                  </div>
                  <p><b>Gemini：</b>{conflict.gemini}</p>
                  <p><b>Seed：</b>{conflict.seed}</p>
                  <p className="analysis-resolution"><b>裁决：</b>{conflict.resolution}</p>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      <div className="analysis-section">
        <h4>素材来源（服务端校验）</h4>
        <div className="analysis-summary-grid">
          <div>
            <strong>平台 / 市场 / 语言</strong>
            <p>
              {mm01.sourceMeta.platform} · {mm01.sourceMeta.marketId} ·{' '}
              {mm01.sourceMeta.marketLanguages.join('、') || 'unknown'}
            </p>
          </div>
          <div>
            <strong>标题 / 说明</strong>
            <p>{mm01.sourceMeta.title || '无标题'}</p>
            <p className="muted">{mm01.sourceMeta.caption || '无说明'}</p>
          </div>
          <div>
            <strong>来源链接 / 时长</strong>
            <p>
              {mm01.sourceMeta.sourceUrl ? (
                canonicalPublicHttpUrl(mm01.sourceMeta.sourceUrl) ? (
                  <a
                    href={canonicalPublicHttpUrl(mm01.sourceMeta.sourceUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {mm01.sourceMeta.sourceUrl}
                  </a>
                ) : (
                  mm01.sourceMeta.sourceUrl
                )
              ) : (
                '无来源链接'
              )}
            </p>
            <p className="muted">
              {mm01.sourceMeta.durationSec.toFixed(1)} 秒
            </p>
          </div>
        </div>
      </div>

      <div className="analysis-summary-grid">
        {modalityRows.map(([label, status]) => (
          <div key={label}>
            <strong>{label}</strong>
            <p>
              <span className={`tag ${modalityStatusClass(status)}`}>
                {MODALITY_STATUS_LABELS[status]}
              </span>
            </p>
          </div>
        ))}
        <div>
          <strong>证据主题推测</strong>
          <p>{mm01.globalUnderstanding.topicGuess || 'unknown'}</p>
        </div>
        <div>
          <strong>行动与说服意图</strong>
          <p>
            {mm01.globalUnderstanding.actionReasonGuess.intendedAction}；
            {mm01.globalUnderstanding.actionReasonGuess.persuasionReason}
          </p>
        </div>
      </div>

      <div className="analysis-section">
        <h4>清洗后多模态输入</h4>
        <div className="analysis-atoms">
          <div>
            <strong>画面描述</strong>
            <p>{mm01.cleanedInputsForP02.visualDescription || '未确认'}</p>
          </div>
          <div>
            <strong>OCR 文字</strong>
            <p>{mm01.cleanedInputsForP02.ocrText || '未识别'}</p>
          </div>
          <div>
            <strong>音轨描述</strong>
            <p>{mm01.cleanedInputsForP02.audioDescription || '未确认'}</p>
          </div>
          <div>
            <strong>ASR 字幕 · {mm01.cleanedInputsForP02.transcriptStatus}</strong>
            <p>{mm01.cleanedInputsForP02.rawTranscript || '无可用口播证据'}</p>
          </div>
          <div>
            <strong>面向 P02 的逐段文本</strong>
            <p>
              {mm01.cleanedInputsForP02.sceneSegmentsText || '无可用逐段文本'}
            </p>
          </div>
        </div>
      </div>

      <div className="analysis-section">
        <h4>逐镜证据（{mm01.sceneSegments.length} 段）</h4>
        <div className="analysis-shot-list">
          {mm01.sceneSegments.map((segment) => (
            <article className="analysis-shot" key={segment.segmentId}>
              <strong>
                {segment.timeRange} · {segment.sceneFunctionGuess}
              </strong>
              <p>
                {[segment.visual.people, segment.visual.setting, segment.visual.productOrObject]
                  .filter(Boolean)
                  .join('；') || '画面主体未确认'}
              </p>
              <p className="muted">
                镜头：{segment.visual.camera || '未确认'}；风格：
                {segment.visual.style || '未确认'}
              </p>
              {segment.ocr.texts.length > 0 && (
                <p className="muted">OCR：{segment.ocr.texts.join('；')}</p>
              )}
              <p className="muted">
                OCR 角色：{segment.ocr.textRoleGuess}；ASR 语言：
                {segment.asr.language || 'unknown'}；说话人：
                {segment.asr.speakerGuess || 'unknown'}
              </p>
              {segment.asr.speech && (
                <p className="muted">口播：{segment.asr.speech}</p>
              )}
              {(segment.audio.musicMood || segment.audio.sfx.length > 0) && (
                <p className="muted">
                  声音：
                  {[segment.audio.musicMood, ...segment.audio.sfx]
                    .filter(Boolean)
                    .join('；')}
                </p>
              )}
              <p className="muted">
                语气：{segment.audio.voiceTone || 'unknown'}；观众情绪：
                {segment.emotion.viewerEmotionGuess || 'unknown'}；角色情绪：
                {segment.emotion.characterEmotion || 'unknown'}
              </p>
              {segment.evidence.length > 0 && (
                <ul>
                  {segment.evidence.map((evidence, index) => (
                    <li key={`${segment.segmentId}-${evidence.type}-${index}`}>
                      [{evidence.type}/{evidence.source}/{evidence.confidence}]{' '}
                      {evidence.fact}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </div>

      <div className="analysis-section">
        <h4>全局理解与本地风格信号</h4>
        <div className="analysis-atoms">
          <div>
            <strong>说服策略</strong>
            <p>
              {mm01.globalUnderstanding.persuasionStrategyGuess.join('；') ||
                'unknown'}
            </p>
          </div>
          <div>
            <strong>人物 / 环境 / 构图</strong>
            <p>{[style.casting, style.environment, style.composition].join('；')}</p>
          </div>
          <div>
            <strong>色彩 / 叠字 / 商品呈现</strong>
            <p>
              {[style.colorTone, style.textOverlayStyle, style.productPresentation].join(
                '；',
              )}
            </p>
          </div>
          <div>
            <strong>风险</strong>
            <p>{style.risk.join('；') || '未发现明确风险'}</p>
          </div>
        </div>
      </div>

      <div className="analysis-section analysis-context-research">
        <div className="analysis-section-heading">
          <h4>C01 搜索语境与事实边界</h4>
          <span className="tag ok">
            {contextResearch.searchProvider} · 已执行搜索
          </span>
        </div>
        <p className="muted analysis-section-intro">
          C01 只补充可追溯的外部语境，不会把搜索资料冒充成视频里看到或听到的事实。
        </p>

        {contextResearch.contextPack.length > 0 ? (
          <div className="analysis-context-grid">
            {contextResearch.contextPack.map((claim, index) => (
              <article key={`${claim.source}-${index}`}>
                <div className="analysis-context-claim-heading">
                  <strong>{claim.claim}</strong>
                  <span className="tag">{claim.confidence}</span>
                </div>
                <p>{claim.boundary}</p>
                <p className="muted">
                  适用程度：{claim.appliesToVideo} · 来源类型：{claim.sourceType}
                </p>
                {canonicalPublicHttpUrl(claim.source) ? (
                  <a
                    href={canonicalPublicHttpUrl(claim.source)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看来源
                  </a>
                ) : (
                  <p className="muted">来源地址未通过安全校验</p>
                )}
                {claim.evidenceNeededInVideo.length > 0 && (
                  <p className="muted">
                    仍需视频证据：{claim.evidenceNeededInVideo.join('；')}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="analysis-empty-note">
            本次没有取得足够可靠的外部语境，系统保留空语境包，不补写背景结论。
          </p>
        )}

        <div className="analysis-boundary-grid">
          <div>
            <strong>视频内事实引用</strong>
            <p>
              {contextResearch.interpretiveBridge.videoFacts.join('、') ||
                '未使用视频事实引用'}
            </p>
          </div>
          <div>
            <strong>外部语境</strong>
            <p>
              {contextResearch.interpretiveBridge.externalContext.join('；') ||
                '未使用外部语境'}
            </p>
          </div>
          <div>
            <strong>语境支持的解释</strong>
            <p>
              {contextResearch.interpretiveBridge.contextSupportedInference ||
                '没有形成可采信的语境解释'}
            </p>
          </div>
          <div>
            <strong>不确定性</strong>
            <p>{contextResearch.interpretiveBridge.uncertainty || '无额外说明'}</p>
          </div>
        </div>

        {contextResearch.sources.length > 0 && (
          <details className="analysis-source-list">
            <summary>查看全部外部来源（{contextResearch.sources.length}）</summary>
            <ul>
              {contextResearch.sources.map((source) => (
                <li key={source}>
                  {canonicalPublicHttpUrl(source) ? (
                    <a
                      href={canonicalPublicHttpUrl(source)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source}
                    </a>
                  ) : (
                    '来源地址未通过安全校验'
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p
          className={
            contextResearch.qualityFlags.needsHumanReview
              ? 'analysis-context-quality warn'
              : 'analysis-context-quality'
          }
        >
          {contextResearch.qualityFlags.needsHumanReview
            ? '需要人工复核'
            : '语境包通过结构校验'}
          ：{contextResearch.qualityFlags.reason || '无额外说明'}
        </p>
      </div>

      <div className="analysis-section">
        <h4>P02 事实拆解</h4>
        <div className="analysis-summary-grid">
          <div>
            <strong>主题</strong>
            <p>{p02.theme}</p>
          </div>
          <div>
            <strong>事实摘要</strong>
            <p>{p02.sourceFactSummary}</p>
          </div>
          <div>
            <strong>故事 · {p02.storyCharCount} 字</strong>
            <p>{p02.story}</p>
          </div>
          <div>
            <strong>核心钩子</strong>
            <p>{p02.coreHook}</p>
          </div>
          <div>
            <strong>标签</strong>
            <p>{p02.tags.join('、')}</p>
          </div>
          <div>
            <strong>字幕与使用状态</strong>
            <p>{p02.subtitleBody || '无可用字幕正文'}</p>
            <p className="muted">
              transcriptUsed: {p02.transcriptUsed ? 'true' : 'false'}
            </p>
          </div>
          <div>
            <strong>实际置信度 / 备注</strong>
            <p>{p02.confidence}</p>
            <p className="muted">{p02.notes || '无额外备注'}</p>
          </div>
        </div>
        <ul>
          {p02.evidenceBeats.map((beat, index) => (
            <li key={`${beat.type}-${index}`}>
              [{beat.type}] {beat.fact}（{beat.evidence}）
            </li>
          ))}
        </ul>

        <h5 className="analysis-subheading">关键时刻</h5>
        <div className="analysis-key-moments">
          {p02.keyMoments.map((moment, index) => (
            <article key={`${moment.timeRange}-${moment.role}-${index}`}>
              <div>
                <span className="tag ok">{moment.role}</span>
                <strong>{moment.timeRange}</strong>
              </div>
              <p>{moment.fact}</p>
              <p className="muted">为什么重要：{moment.whyImportant}</p>
              <p className="muted">
                证据引用：{moment.evidenceRefs.join('、')}
              </p>
            </article>
          ))}
        </div>

        <h5 className="analysis-subheading">视频事实与外部语境边界</h5>
        <div className="analysis-boundary-grid">
          <div>
            <strong>视频事实</strong>
            <p>{p02.sourceVsContextBoundary.videoFacts.join('；') || '无'}</p>
          </div>
          <div>
            <strong>实际采用的外部语境</strong>
            <p>
              {p02.sourceVsContextBoundary.externalContextUsed.join('；') ||
                '未采用'}
            </p>
          </div>
          <div>
            <strong>语境支持的推断</strong>
            <p>
              {p02.sourceVsContextBoundary.contextSupportedInferences.join(
                '；',
              ) || '无'}
            </p>
          </div>
        </div>

        <h5 className="analysis-subheading">叙事机制</h5>
        <div className="analysis-atoms">
          <div>
            <strong>观众为什么继续看</strong>
            <p>{p02.narrativeMechanics.audienceReason}</p>
          </div>
          <div>
            <strong>叙事引擎</strong>
            <p>{p02.narrativeMechanics.narrativeEngine}</p>
          </div>
          <div>
            <strong>兑现逻辑</strong>
            <p>{p02.narrativeMechanics.payoffLogic}</p>
          </div>
          <div>
            <strong>必须保留的信号</strong>
            <p>{p02.narrativeMechanics.preservedSignals.join('；') || '无'}</p>
          </div>
          <div>
            <strong>可替换表层</strong>
            <p>{p02.narrativeMechanics.replaceableSurface.join('；') || '无'}</p>
          </div>
          <div>
            <strong>禁止继承的表层</strong>
            <p>{p02.narrativeMechanics.forbiddenSurface.join('；') || '无'}</p>
          </div>
        </div>
        <p className="muted analysis-evidence-ref-line">
          叙事机制证据：{p02.narrativeMechanics.evidenceRefs.join('、')}
        </p>
      </div>

      <div
        className={`analysis-section${
          mm01.qualityFlags.needsHumanReview ||
          mm01.qualityFlags.missingCriticalInfo.length > 0
            ? ' analysis-warning'
            : ''
        }`}
      >
        <h4>质量与人工复核</h4>
        <p>
          needsHumanReview: {mm01.qualityFlags.needsHumanReview ? 'true' : 'false'}；
          缺失：{mm01.qualityFlags.missingCriticalInfo.join('、') || '无'}；
          {mm01.qualityFlags.reason || '未提供额外原因'}
        </p>
      </div>

      <details className="analysis-section">
        <summary>查看本地确定性 P02F 交接文本</summary>
        <p className="muted">
          来源：{p02Handoff.sourceUsed.join('、') || '无'}；
          {p02Handoff.handoffNotes || '无额外交接说明'}
        </p>
        <textarea
          className="analysis-prompt-text"
          readOnly
          rows={12}
          value={p02Handoff.p02FormattedPrompt}
          aria-label="P02F 格式化提示词"
        />
      </details>
        </>
      )}
    </details>
  )
}

function PromptChainPanel({
  hot,
  breakdown,
}: {
  hot: HotItem
  breakdown: InspirationBreakdown
}) {
  const steps = useMemo(
    () => buildPromptChain(hot, breakdown),
    [hot, breakdown],
  )
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const productionPrompt =
    steps.find(
      (step) =>
        step.active &&
        (step.id === 'P09' || step.id === 'P10' || step.id === 'P11'),
    )?.prompt ?? ''
  const marketValidation = validateMarketRules(hot, productionPrompt)

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      setCopiedKey(null)
    }
  }

  const activeCount = steps.filter((s) => s.active).length

  return (
    <details className="panel" style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        完整提示词链路（按逻辑顺序，{activeCount} 步命中）
      </summary>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() =>
            void copy(`${hot.id}-all`, serializePromptChain(steps))
          }
        >
          {copiedKey === `${hot.id}-all` ? '已复制全部' : '复制全部（命中步）'}
        </button>
        <span
          className={`tag ${marketValidation.sourceMarketValid ? 'ok' : 'danger'}`}
        >
          来源市场
          {marketValidation.sourceMarketValid ? '已确认' : '待确认'}
        </span>
        {productionPrompt && (
          <span
            className={`tag ${
              marketValidation.protagonistConstraintValid ? 'ok' : 'danger'
            }`}
          >
            主角市场/母语
            {marketValidation.protagonistConstraintValid ? '已写入' : '缺失'}
          </span>
        )}
      </div>
      <div className="card-list" style={{ marginTop: 10 }}>
        {steps.map((step: PromptStep) => {
          const key = `${hot.id}-${step.id}`
          return (
            <div
              key={step.id}
              className="field"
              style={{ opacity: step.active ? 1 : 0.5 }}
            >
              <label>
                <span className={`tag ${step.active ? 'ok' : ''}`}>
                  {step.id}
                </span>{' '}
                {step.name} · {step.stage}
                {!step.active && step.skippedReason
                  ? ` · 跳过（${step.skippedReason}）`
                  : ''}
              </label>
              <textarea readOnly rows={step.active ? 10 : 4} value={step.prompt} />
              {step.active && (
                <div className="toolbar" style={{ marginTop: 6 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void copy(key, step.prompt)}
                  >
                    {copiedKey === key ? '已复制' : `复制 ${step.id}`}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}
