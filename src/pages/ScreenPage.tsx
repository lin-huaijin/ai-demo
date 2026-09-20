import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FEATURE_LABELS, MARKETS } from '../data/markets'
import { PLACEMENT_LABELS, PRODUCE_FORM_LABELS } from '../lib/autoMatch'
import { useApp } from '../state'
import type { PlacementMode, ProduceForm } from '../types'

const FORM_OPTIONS: ProduceForm[] = ['video', 'poster', 'chat']

export function ScreenPage() {
  const {
    pendingScreen,
    screenIn,
    screenOut,
    matches,
    changeProduceForm,
    changePlacement,
  } = useApp()
  const [market, setMarket] = useState('all')

  const list = useMemo(() => {
    return pendingScreen.filter(
      (m) => market === 'all' || m.marketId === market,
    )
  }, [pendingScreen, market])

  const screenedIn = matches.filter((m) => m.status === 'screened_in').length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>② 人工筛选</h1>
          <p>
            系统先判断软植入适配，再判断视频钩子是否可走硬植入；高价值钩子即使软植入不匹配，也会进入这里供人工选择。
          </p>
        </div>
        <Link className="btn btn-primary" to="/produce">
          已选进制作（{screenedIn}）
        </Link>
      </div>

      <div className="filters">
        <select value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="all">全部市场</option>
          {MARKETS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="muted">待筛选 {list.length} 条</span>
      </div>

      <div className="card-list">
        {list.map((card) => {
          const m = MARKETS.find((x) => x.id === card.marketId)
          const sourceMarket = MARKETS.find(
            (candidate) => candidate.id === card.sourceMarketId,
          )
          return (
            <article className="insp-card" key={card.id}>
              <div>
                <h3>{card.title}</h3>
                <p>
                  <strong>一句话故事：</strong>
                  {card.oneLiner}
                </p>
                <div className="meta-row">
                  <span className="tag">
                    {sourceMarket?.name ?? card.sourceMarketId} →{' '}
                    {m?.name ?? card.marketId} · {card.platform.toUpperCase()}
                  </span>
                  {card.isCrossMarketRewrite && (
                    <span className="tag warn">跨市场·Shorts 本地化</span>
                  )}
                  <span className="tag ok">
                    {PRODUCE_FORM_LABELS[card.produceForm]}
                  </span>
                  <span className="tag ok">
                    {FEATURE_LABELS[card.feature]}
                  </span>
                  <span
                    className={`tag ${card.fitKind === 'direct' ? 'ok' : 'warn'}`}
                  >
                    {card.fitKind === 'direct'
                      ? '软植入直配'
                      : card.fitKind === 'rewrite'
                        ? '软植入需改写'
                        : '仅硬植入'}
                  </span>
                  {card.produceForm === 'video' && (
                    <span className={`tag ${card.placementMode === 'soft' ? 'ok' : 'warn'}`}>
                      {PLACEMENT_LABELS[card.placementMode]}
                    </span>
                  )}
                  {card.review.passed && (
                    <span className="tag ok">内容预审通过</span>
                  )}
                </div>
                <p className="muted">
                  <strong>核心梗：</strong>
                  {card.meme.core}（
                  {card.meme.axis === 'emotion' ? '情绪为主' : '剧情为主'}）
                </p>
                <p className="muted">{card.fitReason}</p>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>制作形态（默认跟随原素材，可改选）</label>
                  <select
                    value={card.produceForm}
                    onChange={(e) =>
                      changeProduceForm(card.id, e.target.value as ProduceForm)
                    }
                  >
                    {FORM_OPTIONS.filter(
                      (f) => card.fitKind !== 'none' || f === 'video',
                    ).map((f) => (
                      <option key={f} value={f}>
                        {PRODUCE_FORM_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
                {card.produceForm === 'video' && (
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label>视频植入方式（系统推荐，可人工改选）</label>
                    <select
                      value={card.placementMode}
                      onChange={(e) =>
                        changePlacement(
                          card.id,
                          e.target.value as PlacementMode,
                        )
                      }
                    >
                      {card.placementOptions.map((mode) => (
                        <option key={mode} value={mode}>
                          {PLACEMENT_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                    <p className="muted">{card.placementReason}</p>
                  </div>
                )}
                <p className="muted">{card.hook}</p>
                <p className="muted">{card.sellBeat}</p>
                <p className="muted">{card.downloadCta}</p>
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => screenIn(card.id)}
                >
                  进入制作
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => screenOut(card.id)}
                >
                  淘汰
                </button>
              </div>
            </article>
          )
        })}
        {list.length === 0 && (
          <div className="empty">
            暂无待筛匹配卡。可先到灵感页模拟爬取，系统会自动匹配卖点。
            <div style={{ marginTop: 12 }}>
              <Link className="btn btn-primary" to="/inspire">
                去灵感采集
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
