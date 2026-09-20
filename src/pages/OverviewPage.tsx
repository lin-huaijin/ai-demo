import { WorkflowDiagram } from '../components/WorkflowDiagram'

export function OverviewPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>工作流</h1>
          <p>
            飞书里筛好的热帖链接 → 粘贴入库 → 自动拆解与卖点分流 → 人工筛选 →
            制作（跳转工具 + 复制脚本）→ 机审投放。
          </p>
        </div>
      </div>
      <WorkflowDiagram />
    </div>
  )
}
