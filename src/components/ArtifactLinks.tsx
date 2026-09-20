import { Link } from 'react-router-dom'
import type { ArtifactReference } from '../contracts/artifacts.ts'
import { downloadArtifactRunExport } from '../lib/artifacts.ts'

const STATUS_LABEL = {
  pending: '保存中',
  complete: '已归档',
  failed: '失败已留档',
  partial: '部分归档',
} as const

export function ArtifactLinks({ artifact }: { artifact?: ArtifactReference }) {
  if (!artifact) return null
  const statusClass =
    artifact.status === 'complete'
      ? 'ok'
      : artifact.status === 'failed'
        ? 'danger'
        : artifact.status === 'partial'
          ? 'warn'
          : ''
  return (
    <span className="artifact-links">
      <span className={`tag ${statusClass}`}>
        {STATUS_LABEL[artifact.status]} · {artifact.assetId.slice(-10)}
      </span>
      <Link
        className="artifact-link"
        to={`/archive/${encodeURIComponent(artifact.projectId)}/${encodeURIComponent(artifact.assetId)}`}
      >
        查看档案
      </Link>
      <button
        className="artifact-link artifact-link-button"
        type="button"
        onClick={() => {
          void downloadArtifactRunExport(
            artifact.projectId,
            artifact.assetId,
            artifact.runId,
          ).catch(() => window.alert('档案导出失败，请检查访问权限后重试。'))
        }}
      >
        导出本次
      </button>
    </span>
  )
}
