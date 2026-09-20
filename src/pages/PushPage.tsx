import { Link } from 'react-router-dom'
import { FEATURE_LABELS, MARKETS } from '../data/markets'
import { PRODUCE_FORM_LABELS } from '../lib/autoMatch'
import { useApp } from '../state'

export function PushPage() {
  const { pushed, matches } = useApp()
  const rejected = matches.filter((m) => m.status === 'rejected').length
  const screenedOut = matches.filter((m) => m.status === 'screened_out').length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>④ 机审投放</h1>
          <p>成品机器审核通过后，自动推送至本地化投放平台。</p>
        </div>
      </div>

      <div className="grid-stats">
        <div className="stat">
          <label>已推送</label>
          <strong>{pushed.length}</strong>
        </div>
        <div className="stat">
          <label>人工淘汰</label>
          <strong>{screenedOut}</strong>
        </div>
        <div className="stat">
          <label>自动预审驳回</label>
          <strong>{rejected}</strong>
        </div>
        <div className="stat">
          <label>匹配卡总计</label>
          <strong>{matches.length}</strong>
        </div>
      </div>

      <div className="panel">
        <h2>投放记录</h2>
        {pushed.length === 0 ? (
          <div className="empty">
            尚无推送记录。
            <div style={{ marginTop: 12 }}>
              <Link className="btn btn-primary" to="/screen">
                去筛选进制作
              </Link>
            </div>
          </div>
        ) : (
          <div className="card-list">
            {pushed.map((j) => (
              <article className="insp-card" key={j.id}>
                <div>
                  <h3>
                    {MARKETS.find((m) => m.id === j.marketId)?.name} ·{' '}
                    {PRODUCE_FORM_LABELS[j.produceForm]} ·{' '}
                    {FEATURE_LABELS[j.feature]}
                  </h3>
                  <p>{j.oneLiner}</p>
                  <p className="mono muted">
                    <a href={j.sourceUrl} target="_blank" rel="noreferrer">
                      {j.sourceUrl}
                    </a>
                  </p>
                  <span className="tag ok">已机审推送</span>
                  <p className="muted">{j.machineReviewNote}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
