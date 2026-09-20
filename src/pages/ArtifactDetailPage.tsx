import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ArtifactManifestResponse } from '../contracts/artifacts.ts'
import {
  downloadArtifactRunExport,
  getArtifactManifest,
} from '../lib/artifacts.ts'

const STATUS_LABEL = {
  pending: '保存中',
  complete: '完整',
  failed: '失败',
  partial: '部分完成',
} as const

export function ArtifactDetailPage() {
  const { projectId = '', assetId = '' } = useParams()
  const [data, setData] = useState<ArtifactManifestResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    void getArtifactManifest(projectId, assetId)
      .then((next) => {
        if (active) setData(next)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '档案读取失败')
      })
    return () => {
      active = false
    }
  }, [projectId, assetId])

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="context-kicker">LOCAL ARTIFACT ARCHIVE</p>
          <h1>素材档案详情</h1>
          <p>原素材只保存一份；每次多模态重跑都会新增独立版本，不覆盖历史。</p>
        </div>
        <Link className="btn" to="/archive">
          返回热点库
        </Link>
      </div>

      {error && <div className="analysis-warning">{error}</div>}
      {!error && !data && <div className="empty">正在读取本地档案…</div>}
      {data && (
        <>
          <div className="grid-stats">
            <div className="stat">
              <label>项目</label>
              <strong className="artifact-stat-text">{data.asset.projectId}</strong>
            </div>
            <div className="stat">
              <label>分析版本</label>
              <strong>{data.asset.runCount}</strong>
            </div>
            <div className="stat">
              <label>归档文件</label>
              <strong>{data.asset.files}</strong>
            </div>
            <div className="stat">
              <label>最新状态</label>
              <strong className="artifact-stat-text">
                {data.asset.latestStatus
                  ? STATUS_LABEL[data.asset.latestStatus]
                  : '暂无'}
              </strong>
            </div>
          </div>

          <section className="panel artifact-source-panel">
            <div>
              <p className="context-kicker">SOURCE</p>
              <h2>{data.asset.title || data.asset.assetId}</h2>
              <p className="mono muted">{data.asset.assetId}</p>
            </div>
            {data.asset.sourceUrl && (
              <a className="btn" href={data.asset.sourceUrl} target="_blank" rel="noreferrer">
                打开原帖
              </a>
            )}
          </section>

          <section className="panel">
            <h2>原始素材文件</h2>
            <p className="muted">
              相对目录从 <span className="mono">.portfolio-data/projects/{data.asset.projectId}/sources/{data.asset.assetId}</span> 开始。
            </p>
            <div className="artifact-file-list">
              {data.sourceFiles.map((file) => (
                <div className="artifact-file" key={file.path}>
                  <span className="tag">{file.kind}</span>
                  <span className="mono">{file.path}</span>
                  <span className="muted">
                    {file.byteLength ? `${(file.byteLength / 1024 / 1024).toFixed(2)} MB` : '大小未知'}
                  </span>
                </div>
              ))}
              {data.sourceFiles.length === 0 && (
                <div className="empty">本次未能保存原始媒体副本，仍可查看分析运行。</div>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>分析运行记录</h2>
            <div className="artifact-run-list">
              {data.runs.map((run) => (
                <article className="artifact-run" key={run.runId}>
                  <div>
                    <strong>{run.runId}</strong>
                    <p className="muted">
                      {run.provider && run.model
                        ? `${run.provider} · ${run.model}`
                        : '模型信息待记录'}
                      {run.mode ? ` · ${run.mode}` : ''}
                    </p>
                    <p className="mono muted">{run.updatedAt}</p>
                    {run.warning && <p className="analysis-warning">{run.warning}</p>}
                    <details className="artifact-run-files">
                      <summary>{run.files.length} 个运行产物</summary>
                      <div className="artifact-file-list">
                        {run.files.map((file) => (
                          <div className="artifact-file" key={file.path}>
                            <span className="tag">{file.kind}</span>
                            <span className="mono">{file.path}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                  <div className="artifact-run-actions">
                    <span
                      className={`tag ${
                        run.status === 'complete'
                          ? 'ok'
                          : run.status === 'failed'
                            ? 'danger'
                            : run.status === 'partial'
                              ? 'warn'
                              : ''
                      }`}
                    >
                      {STATUS_LABEL[run.status]}
                    </span>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        void downloadArtifactRunExport(
                          data.asset.projectId,
                          data.asset.assetId,
                          run.runId,
                        ).catch(() =>
                          window.alert('档案导出失败，请检查访问权限后重试。'),
                        )
                      }}
                    >
                      导出 JSON
                    </button>
                  </div>
                </article>
              ))}
              {data.runs.length === 0 && <div className="empty">暂无运行记录。</div>}
            </div>
          </section>

          <details className="panel artifact-manifest">
            <summary>查看完整 Manifest（用于技术回查）</summary>
            <pre>{JSON.stringify(data.manifest, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  )
}
