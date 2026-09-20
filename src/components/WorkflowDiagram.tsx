import { Link } from 'react-router-dom'

/** 总览：输入链接 → 拆解 → 筛选 → 制作 → 机审投放 */
export function WorkflowDiagram() {
  return (
    <figure className="flow-figure">
      <svg
        className="flow-svg"
        viewBox="0 0 760 500"
        role="img"
        aria-label="链接入库工作流示意图"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-muted)" />
          </marker>
        </defs>

        <rect
          x="28"
          y="16"
          width="320"
          height="440"
          rx="10"
          fill="var(--surface-muted)"
          stroke="var(--line-strong)"
        />
        <text x="188" y="44" textAnchor="middle" className="flow-title">
          自动处理
        </text>

        <rect x="68" y="58" width="240" height="44" rx="8" className="flow-node accent" />
        <text x="188" y="78" textAnchor="middle" className="flow-node-text">
          粘贴热帖链接
        </text>
        <text x="188" y="94" textAnchor="middle" className="flow-node-sub">
          飞书文档复制 · 一行一条
        </text>

        <line x1="188" y1="102" x2="188" y2="118" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />

        <rect x="68" y="120" width="240" height="40" rx="8" className="flow-node" />
        <text x="188" y="145" textAnchor="middle" className="flow-node-text">
          识别帖文+字幕 → 主题/故事
        </text>

        <line x1="188" y1="160" x2="188" y2="176" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />

        <rect x="68" y="178" width="240" height="72" rx="8" className="flow-node accent" />
        <text x="188" y="202" textAnchor="middle" className="flow-node-text">
          灵感拆解 · 核心梗
        </text>
        <text x="188" y="222" textAnchor="middle" className="flow-node-sub">
          情绪为主 / 剧情为主
        </text>
        <text x="188" y="238" textAnchor="middle" className="flow-node-sub">
          软适配 × 钩子强度双轴判定
        </text>

        <line x1="188" y1="250" x2="188" y2="268" stroke="var(--ink-muted)" />
        <line x1="100" y1="268" x2="276" y2="268" stroke="var(--ink-muted)" />
        <line x1="100" y1="268" x2="100" y2="284" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />
        <line x1="188" y1="268" x2="188" y2="284" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />
        <line x1="276" y1="268" x2="276" y2="284" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />

        <rect x="60" y="286" width="80" height="48" rx="6" className="flow-node" />
        <text x="100" y="308" textAnchor="middle" className="flow-node-sub">软植入直配</text>
        <text x="100" y="324" textAnchor="middle" className="flow-node-sub">软 / 硬可测</text>

        <rect x="148" y="286" width="80" height="48" rx="6" className="flow-node warn" />
        <text x="188" y="308" textAnchor="middle" className="flow-node-sub">软植入改写</text>
        <text x="188" y="324" textAnchor="middle" className="flow-node-sub">失败回退硬</text>

        <rect x="236" y="286" width="80" height="48" rx="6" className="flow-node" />
        <text x="276" y="308" textAnchor="middle" className="flow-node-sub">软不匹配</text>
        <text x="276" y="324" textAnchor="middle" className="flow-node-sub">强钩子走硬</text>

        <line x1="100" y1="334" x2="100" y2="360" stroke="var(--accent)" />
        <line x1="188" y1="334" x2="188" y2="360" stroke="var(--accent)" />
        <line x1="276" y1="334" x2="276" y2="360" stroke="var(--accent)" />
        <line x1="100" y1="360" x2="276" y2="360" stroke="var(--accent)" />
        <line x1="188" y1="360" x2="360" y2="100" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arrow)" />

        <path d="M 308 214 L 340 214 L 340 400 L 188 400" fill="none" stroke="var(--danger)" strokeDasharray="4 3" />
        <text x="260" y="420" textAnchor="middle" className="flow-node-sub">软不匹配 + 弱钩子：退回</text>

        <rect x="68" y="440" width="240" height="36" rx="8" className="flow-node" />
        <text x="188" y="463" textAnchor="middle" className="flow-node-text">
          视频：人工选择软植入 / 硬植入
        </text>

        <rect x="380" y="16" width="340" height="140" rx="10" fill="var(--warn-soft)" stroke="#d9a76f" />
        <text x="550" y="44" textAnchor="middle" className="flow-title">人工关卡</text>
        <rect x="420" y="60" width="260" height="72" rx="8" className="flow-node warn" />
        <text x="550" y="90" textAnchor="middle" className="flow-node-text">人工筛选</text>
        <text x="550" y="112" textAnchor="middle" className="flow-node-sub">选出可进入制作的卡片</text>

        <rect x="380" y="176" width="340" height="280" rx="10" fill="var(--accent-soft)" stroke="var(--accent-line)" />
        <text x="550" y="204" textAnchor="middle" className="flow-title">制作与投放</text>
        <line x1="550" y1="156" x2="550" y2="222" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />

        <rect x="430" y="224" width="240" height="44" rx="8" className="flow-node" />
        <text x="550" y="244" textAnchor="middle" className="flow-node-text">制作（跳转工具）</text>
        <text x="550" y="260" textAnchor="middle" className="flow-node-sub">复制脚本 · 手动粘贴</text>

        <line x1="550" y1="268" x2="550" y2="286" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />
        <rect x="430" y="288" width="240" height="36" rx="8" className="flow-node" />
        <text x="550" y="311" textAnchor="middle" className="flow-node-text">机器审核成品</text>

        <line x1="550" y1="324" x2="550" y2="342" stroke="var(--ink-muted)" markerEnd="url(#arrow)" />
        <rect x="430" y="344" width="240" height="48" rx="8" className="flow-node accent" />
        <text x="550" y="373" textAnchor="middle" className="flow-node-text">推送本地化投放平台</text>
      </svg>
      <figcaption className="muted">
        输入链接 → 识别内容 → 灵感拆解与卖点分流 → 人工筛选 → 制作 → 机审投放
      </figcaption>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <Link className="btn btn-primary" to="/inspire">
          从粘贴链接开始
        </Link>
        <Link className="btn" to="/screen">
          去人工筛选
        </Link>
      </div>
    </figure>
  )
}
