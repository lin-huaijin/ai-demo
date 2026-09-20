import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FEATURE_LABELS, MARKETS } from '../data/markets'
import { PLACEMENT_LABELS, PRODUCE_FORM_LABELS } from '../lib/autoMatch'
import { useApp } from '../state'
import type { PlacementMode, ProduceForm } from '../types'

const FORM_OPTIONS: ProduceForm[] = ['video', 'poster', 'chat']

// External production tools are intentionally omitted from the portfolio build.
// The generated Brief can be copied into any compatible tool.
const TOOLS: {
  name: string
  role: string
  url: string
  forms?: ProduceForm[]
}[] = []

export function ProducePage() {
  const {
    inProduction,
    startProduce,
    finishProduceAndPush,
    changeProduceForm,
    changePlacement,
  } = useApp()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      setCopiedId(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>③ 制作</h1>
          <p>
            查看制作形态与原灵感链接；复制提示词脚本后跳转工具平台粘贴制作（工具侧暂不支持自动填表）。
          </p>
        </div>
        <Link className="btn" to="/screen">
          返回筛选
        </Link>
      </div>

      {inProduction.length === 0 ? (
        <div className="empty">
          还没有进入制作的卡片。
          <div style={{ marginTop: 12 }}>
            <Link className="btn btn-primary" to="/screen">
              去人工筛选
            </Link>
          </div>
        </div>
      ) : (
        <div className="card-list">
          {inProduction.map((card) => {
            const m = MARKETS.find((x) => x.id === card.marketId)
            const sourceMarket = MARKETS.find(
              (candidate) => candidate.id === card.sourceMarketId,
            )
            const formLabel = PRODUCE_FORM_LABELS[card.produceForm]
            const tools = TOOLS.filter(
              (t) =>
                !t.forms ||
                t.forms.includes(card.produceForm) ||
                t.name === 'your text-quality checker',
            )
            const briefPack = [
              `【制作形态】${formLabel}`,
              card.produceForm === 'video'
                ? `【植入方式】${PLACEMENT_LABELS[card.placementMode]}`
                : '',
              `【来源市场】${sourceMarket?.name ?? card.sourceMarketId}`,
              `【投放市场】${m?.name ?? card.marketId} · ${card.platform}`,
              `【主角市场】${m?.name ?? card.marketId}（${card.marketId}）`,
              `【主角母语】${m?.languages[0] ?? 'unknown'}`,
              `【卖点】${FEATURE_LABELS[card.feature]}`,
              `【原灵感】${card.sourceUrl}`,
              `【一句话】${card.oneLiner}`,
              '',
              card.generatedScript,
            ].join('\n')

            return (
              <article className="insp-card" key={card.id}>
                <div>
                  <h3>
                    {card.title}
                    <span className="tag" style={{ marginLeft: 8 }}>
                      {card.status === 'producing' ? '制作中' : '待开做'}
                    </span>
                  </h3>

                  <div className="panel" style={{ marginTop: 10, marginBottom: 10 }}>
                    <h3 style={{ marginTop: 0 }}>制作形态</h3>
                    <div className="meta-row">
                      <span className="tag ok" style={{ fontSize: '0.95rem' }}>
                        {formLabel}
                      </span>
                      <span className="tag">
                        {sourceMarket?.name ?? card.sourceMarketId} →{' '}
                        {m?.name ?? card.marketId} · {card.platform.toUpperCase()}
                      </span>
                      {card.isCrossMarketRewrite && (
                        <span className="tag warn">Shorts 跨市场本地化</span>
                      )}
                      <span className="tag ok">
                        {FEATURE_LABELS[card.feature]}
                      </span>
                      {card.produceForm === 'video' && (
                        <span className={`tag ${card.placementMode === 'soft' ? 'ok' : 'warn'}`}>
                          {PLACEMENT_LABELS[card.placementMode]}
                        </span>
                      )}
                    </div>
                    <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                      <label>手动改选形态（默认跟随原素材，可生成其他形式）</label>
                      <select
                        value={card.produceForm}
                        onChange={(e) =>
                          changeProduceForm(
                            card.id,
                            e.target.value as ProduceForm,
                          )
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
                      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                        <label>视频植入方式</label>
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
                    <p className="muted" style={{ marginBottom: 0 }}>
                      {card.produceForm === 'poster' &&
                        '海报：主视觉 + 大字钩子 + 卖点 + 下载入口'}
                      {card.produceForm === 'chat' &&
                        '聊天记录：气泡对话呈现冲突与产品功能解围'}
                      {card.produceForm === 'video' &&
                        (card.placementMode === 'soft'
                          ? '软植入：钩子 → 冲突 → 剧情内功能解围 → CTA'
                          : '硬植入：完整原钩子 → 高潮后硬切 → 功能证明 → CTA')}
                    </p>
                  </div>

                  <div className="field">
                    <label>原灵感链接</label>
                    <a
                      href={card.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                      style={{ wordBreak: 'break-all' }}
                    >
                      {card.sourceUrl}
                    </a>
                  </div>

                  <p>{card.oneLiner}</p>

                  <div className="field">
                    <label>提示词 / 脚本</label>
                    <textarea readOnly rows={8} value={card.generatedScript} />
                  </div>

                  <div className="toolbar">
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => void copyText(card.id, briefPack)}
                    >
                      {copiedId === card.id ? '已复制 Brief' : '一键复制制作 Brief'}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void copyText(`${card.id}-script`, card.generatedScript)}
                    >
                      只复制脚本
                    </button>
                  </div>

                  <p className="muted">建议工具：{card.toolHint}</p>
                  <div className="meta-row">
                    {tools.map((t) => (
                      <a
                        key={t.name}
                        className="btn"
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开 {t.name}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="card-actions">
                  {card.status === 'screened_in' && (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => startProduce(card.id)}
                    >
                      开始制作
                    </button>
                  )}
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => finishProduceAndPush(card.id)}
                  >
                    完成并保存
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
