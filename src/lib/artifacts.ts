import type {
  ArtifactAssetListItem,
  ArtifactManifestResponse,
  ArtifactReference,
  ArtifactRunStatus,
  ArtifactStoreStatus,
} from '../contracts/artifacts.ts'
import type { PromptStep } from '../prompts/pipeline.ts'
import type { HotItem, InspirationBreakdown, MatchedCard } from '../types.ts'
import { runtimeApiHeaders } from './apiAccess.ts'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function runStatus(value: unknown): ArtifactRunStatus | undefined {
  return value === 'pending' ||
    value === 'complete' ||
    value === 'failed' ||
    value === 'partial'
    ? value
    : undefined
}

export function parseArtifactReference(value: unknown): ArtifactReference | undefined {
  const outer = record(value)
  const artifact = record(outer?.artifact)
  const projectId = string(artifact?.projectId)
  const assetId = string(artifact?.assetId)
  const runId = string(artifact?.runId)
  const status = runStatus(artifact?.status)
  if (!projectId || !assetId || !runId || !status) return undefined
  const encodedProject = encodeURIComponent(projectId)
  const encodedAsset = encodeURIComponent(assetId)
  const encodedRun = encodeURIComponent(runId)
  return {
    projectId,
    assetId,
    runId,
    status,
    createdAt: string(artifact?.createdAt),
    updatedAt: string(artifact?.updatedAt),
    warning: string(artifact?.warning),
    manifestUrl:
      string(artifact?.manifestUrl) ??
      `/api/artifacts/projects/${encodedProject}/assets/${encodedAsset}`,
    exportUrl:
      string(artifact?.exportUrl) ??
      `/api/artifacts/projects/${encodedProject}/assets/${encodedAsset}/runs/${encodedRun}/export`,
  }
}

export function parseArtifactWarning(value: unknown): string | undefined {
  return string(record(value)?.artifactWarning)
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const data = record(body)
    throw new Error(
      string(data?.error) ?? `档案服务不可用（HTTP ${response.status}）`,
    )
  }
  return body as T
}

export async function getArtifactStoreStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<ArtifactStoreStatus> {
  return jsonResponse<ArtifactStoreStatus>(
    await fetchImpl('/api/artifacts/status', {
      cache: 'no-store',
      headers: runtimeApiHeaders(),
    }),
  )
}

export async function listArtifactAssets(
  fetchImpl: typeof fetch = fetch,
): Promise<ArtifactAssetListItem[]> {
  const body = await jsonResponse<{ assets?: ArtifactAssetListItem[] }>(
    await fetchImpl('/api/artifacts', {
      cache: 'no-store',
      headers: runtimeApiHeaders(),
    }),
  )
  return Array.isArray(body.assets) ? body.assets : []
}

export async function getArtifactManifest(
  projectId: string,
  assetId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArtifactManifestResponse> {
  return jsonResponse<ArtifactManifestResponse>(
    await fetchImpl(
      `/api/artifacts/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
      {
        cache: 'no-store',
        headers: runtimeApiHeaders(),
      },
    ),
  )
}

export interface WorkflowArtifactSnapshot {
  hotItem: HotItem
  breakdown?: InspirationBreakdown
  match?: MatchedCard
  produceCount: number
  promptChain?: PromptStep[]
  savedAt: string
}

export async function saveWorkflowArtifactSnapshot(
  artifact: ArtifactReference,
  snapshot: WorkflowArtifactSnapshot,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `/api/artifacts/projects/${encodeURIComponent(artifact.projectId)}/assets/${encodeURIComponent(artifact.assetId)}/runs/${encodeURIComponent(artifact.runId)}/workflow`,
    {
      method: 'PUT',
      headers: runtimeApiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(snapshot),
    },
  )
  await jsonResponse<Record<string, unknown>>(response)
}

export async function downloadArtifactRunExport(
  projectId: string,
  assetId: string,
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `/api/artifacts/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/runs/${encodeURIComponent(runId)}/export`,
    { headers: runtimeApiHeaders() },
  )
  if (!response.ok) {
    await jsonResponse<never>(response)
    return
  }
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${assetId}-${runId}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
