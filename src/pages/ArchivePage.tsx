import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArtifactLinks } from '../components/ArtifactLinks.tsx'
import type { ArtifactAssetListItem } from '../contracts/artifacts.ts'
import {
  FEATURE_LABELS,
  MARKETS,
  PERIODIC_LABELS,
  SOURCE_LABELS,
} from '../data/markets'
import { FIT_LABELS } from '../lib/breakdown'
import { matchesArchiveQuery } from '../lib/archiveSearch.ts'
import { listArtifactAssets } from '../lib/artifacts.ts'
import { useApp } from '../state'
import type { HotItem, InspirationBreakdown, MatchedCard } from '../types'

type ArchiveStatus =
  | 'undecoded'
  | 'returned'
  | 'pending'
  | 'screened_in'
  | 'producing'
  | 'pushed'
  | 'screened_out'
  | 'rejected'

const STATUS_LABELS: Record<ArchiveStatus, string> = {
  undecoded: '未拆解',
  returned: '退回热点库',
  pending: '待筛选',
  screened_in: '已进制作',
  producing: '制作中',
  pushed: '已投放',
  screened_out: '已淘汰',
  rejected: '预审驳回',
}

const STATUS_TAG: Record<ArchiveStatus, string> = {
  undecoded: '',
  returned: 'warn',
  pending: '',
  screened_in: 'ok',
  producing: 'ok',
  pushed: 'ok',
  screened_out: 'danger',
  rejected: 'danger',
}

function categoryOf(item: HotItem): string {
  if (item.periodicKind) return `周期·${PERIODIC_LABELS[item.periodicKind]}`
  if (item.topicTags.includes('travel')) return '旅行'
  if (item.topicTags.includes('language_learning')) return '学外语'
  if (item.topicTags.includes('cross_culture')) return '跨文化交流'
  return '其他 / 纯娱乐'
}

function deriveStatus(
  breakdown: InspirationBreakdown | undefined,
  match: MatchedCard | undefined,
): ArchiveStatus {
  if (!breakdown) return 'undecoded'
  if (breakdown.fit.kind === 'none') return 'returned'
  if (!match) return 'returned'
  switch (match.status) {
    case 'matched':
      return 'pending'
    case 'screened_in':
      return 'screened_in'
    case 'producing':
      return 'producing'
    case 'pushed':
      return 'pushed'
    case 'screened_out':
      return 'screened_out'
    case 'rejected':
      return 'rejected'
    default:
      return 'pending'
  }
}

export function ArchivePage() {
  const { dedupedPool, breakdowns, matches, produceCounts } = useApp()

  const [market, setMarket] = useState('all')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [day, setDay] = useState('all')
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [archiveQuery, setArchiveQuery] = useState('')
  const [artifactAssets, setArtifactAssets] = useState<ArtifactAssetListItem[]>([])
  const [artifactError, setArtifactError] = useState('')

  useEffect(() => {
    let active = true
    void listArtifactAssets()
      .then((assets) => {
        if (active) setArtifactAssets(assets)
      })
      .catch((error) => {
        if (active) {
          setArtifactError(
            error instanceof Error ? error.message : '本地档案读取失败',
          )
        }
      })
    return () => {
      active = false
    }
  }, [])

  const visibleArtifactAssets = useMemo(() => {
    const query = archiveQuery.trim().toLowerCase()
    if (!query) return artifactAssets
    return artifactAssets.filter((asset) =>
      [asset.title, asset.assetId, asset.sourceUrl, asset.platform]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query)),
    )
  }, [archiveQuery, artifactAssets])

  const rows = useMemo(() => {
    const bByHot = new Map(breakdowns.map((b) => [b.hotItemId, b]))
    const mByHot = new Map(matches.map((m) => [m.hotItemId, m]))
    return dedupedPool.map((item) => {
      const breakdown = bByHot.get(item.id)
      const match = mByHot.get(item.id)
      const st = deriveStatus(breakdown, match)
      const producedCount =
        produceCounts[item.id] ?? (st === 'pushed' ? 1 : 0)
      return {
        item,
        breakdown,
        match,
        status: st,
        producedCount,
        category: categoryOf(item),
        day: item.collectedAt.split(' ')[0] ?? item.collectedAt,
      }
    })
  }, [dedupedPool, breakdowns, matches, produceCounts])

  const dayOptions = useMemo(
    () => [...new Set(rows.map((r) => r.day))].sort().reverse(),
    [rows],
  )
  const categoryOptions = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      const marketName = MARKETS.find((item) => item.id === r.item.marketId)?.name
      if (
        !matchesArchiveQuery(
          {
            id: r.item.id,
            title: r.item.title,
            summary: r.item.oneLiner,
            sourceUrl: r.item.sourceUrl,
            platform: r.item.platform,
            market: [r.item.marketId, marketName].filter(Boolean).join(' '),
            category: r.category,
          },
          archiveQuery,
        )
      ) {
        return false
      }
      if (market !== 'all' && r.item.marketId !== market) return false
      if (category !== 'all' && r.category !== category) return false
      if (day !== 'all' && r.day !== day) return false
      if (status === 'produced') return r.producedCount >= 1
      if (status !== 'all' && r.status !== status) return false
      return true
    })
    return list.sort((a, b) =>
      order === 'desc'
        ? b.item.collectedAt.localeCompare(a.item.collectedAt)
        : a.item.collectedAt.localeCompare(b.item.collectedAt),
    )
  }, [rows, archiveQuery, market, category, day, status, order])

  const stats = useMemo(() => {
    return {
      total: rows.length,
      pushed: rows.filter((r) => r.status === 'pushed').length,
      screenedOut: rows.filter((r) => r.status === 'screened_out').length,
      returned: rows.filter((r) => r.status === 'returned').length,
    }
  }, [rows])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>热点库 · 归档</h1>
          <p>
            汇总所有入库灵感素材，按时间 / 地区 / 类型 / 状态查找，回看已淘汰与制作过的素材。
          </p>
        </div>
        <Link className="btn" to="/inspire">
          去入库 / 载入示例
        </Link>
      </div>

      <div className="grid-stats">
        <div className="stat">
          <label>素材总数</label>
          <strong>{stats.total}</strong>
        </div>
        <div className="stat">
          <label>已投放</label>
          <strong>{stats.pushed}</strong>
        </div>
        <div className="stat">
          <label>已淘汰</label>
          <strong>{stats.screenedOut}</strong>
        </div>
        <div className="stat">
          <label>退回热点库</label>
          <strong>{stats.returned}</strong>
        </div>
      </div>

      <section className="panel artifact-library">
        <div className="artifact-library-heading">
          <div>
            <p className="context-kicker">DURABLE LOCAL ARCHIVE</p>
            <h2>本地项目档案</h2>
            <p className="muted">
              原视频、关键帧和每次 MM01 → P02 结果按素材分组，浏览器刷新后仍可回查。
            </p>
          </div>
          <label className="field artifact-search">
            <span>搜索全部归档</span>
            <input
              value={archiveQuery}
              onChange={(event) => setArchiveQuery(event.target.value)}
              placeholder="标题、来源链接或档案 ID"
            />
          </label>
        </div>
        {artifactError && <div className="analysis-warning">{artifactError}</div>}
        {!artifactError && artifactAssets.length === 0 && (
          <div className="empty">完成一次真实多模态拆解后，档案会自动出现在这里。</div>
        )}
        {visibleArtifactAssets.length > 0 && (
          <div className="artifact-library-list">
            {visibleArtifactAssets.map((asset) => (
              <Link
                className="artifact-library-item"
                key={`${asset.projectId}/${asset.assetId}`}
                to={`/archive/${encodeURIComponent(asset.projectId)}/${encodeURIComponent(asset.assetId)}`}
              >
                <div>
                  <strong>{asset.title || asset.assetId}</strong>
                  <p className="mono muted">{asset.assetId}</p>
                </div>
                <div className="artifact-library-meta">
                  <span className="tag">{asset.platform || 'unknown'}</span>
                  <span className="tag">{asset.runCount} 次分析</span>
                  <span
                    className={`tag ${
                      asset.latestStatus === 'complete'
                        ? 'ok'
                        : asset.latestStatus === 'failed'
                          ? 'danger'
                          : asset.latestStatus === 'partial'
                            ? 'warn'
                            : ''
                    }`}
                  >
                    {asset.latestStatus ?? 'pending'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {!artifactError &&
          artifactAssets.length > 0 &&
          visibleArtifactAssets.length === 0 && (
            <div className="empty">没有匹配的本地档案。</div>
          )}
      </section>

      <div className="filters">
        <select value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="all">全部时间</option>
          {dayOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="all">全部地区</option>
          {MARKETS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">全部类型</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">全部状态</option>
          {(Object.keys(STATUS_LABELS) as ArchiveStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          <option value="produced">制作过（≥1 次）</option>
        </select>
        <select
          value={order}
          onChange={(e) => setOrder(e.target.value as 'desc' | 'asc')}
        >
          <option value="desc">时间：最新在前</option>
          <option value="asc">时间：最早在前</option>
        </select>
        <span className="muted">命中 {filtered.length} 条</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          当前浏览器会话暂无素材；历史真实拆解仍可从上方本地档案回查。
          <div style={{ marginTop: 12 }}>
            <Link className="btn btn-primary" to="/inspire">
              去入库 / 载入示例
            </Link>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="archive-table">
            <thead>
              <tr>
                <th>素材</th>
                <th>地区</th>
                <th>平台</th>
                <th>类型</th>
                <th>采集时间</th>
                <th>卖点分流</th>
                <th>状态</th>
                <th>制作次数</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const m = MARKETS.find((x) => x.id === r.item.marketId)
                return (
                  <tr key={r.item.id}>
                    <td>
                      <div className="archive-title">{r.item.title}</div>
                      <div className="muted archive-story">
                        {r.item.oneLiner}
                      </div>
                      {r.item.sourceUrl && (
                        <a
                          className="mono muted"
                          href={r.item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          原帖链接
                        </a>
                      )}
                      <div className="archive-artifact-row">
                        <ArtifactLinks artifact={r.item.artifact} />
                      </div>
                    </td>
                    <td>{m?.name ?? r.item.marketId}</td>
                    <td>{r.item.platform.toUpperCase()}</td>
                    <td>
                      <div>{r.category}</div>
                      <div className="muted archive-sub">
                        {SOURCE_LABELS[r.item.source]}
                      </div>
                    </td>
                    <td className="mono">{r.item.collectedAt}</td>
                    <td>
                      {r.breakdown ? (
                        <span
                          className={`tag ${
                            r.breakdown.fit.kind === 'direct'
                              ? 'ok'
                              : r.breakdown.fit.kind === 'rewrite'
                                ? 'warn'
                                : 'danger'
                          }`}
                        >
                          {FIT_LABELS[r.breakdown.fit.kind]}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {r.match && (
                        <div className="muted archive-sub">
                          {FEATURE_LABELS[r.match.feature]}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${STATUS_TAG[r.status]}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td>
                      {r.producedCount > 0 ? (
                        <span className="tag ok">{r.producedCount} 次</span>
                      ) : (
                        <span className="muted">0 次</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ padding: 20 }}>
                    当前筛选条件下无匹配素材。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
