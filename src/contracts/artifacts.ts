export type ArtifactRunStatus =
  | 'pending'
  | 'complete'
  | 'failed'
  | 'partial'

/** Lightweight pointer kept in frontend state; large artifacts remain server-side. */
export interface ArtifactReference {
  projectId: string
  assetId: string
  runId: string
  status: ArtifactRunStatus
  createdAt?: string
  updatedAt?: string
  manifestUrl: string
  exportUrl: string
  warning?: string
}

export interface ArtifactRunListItem {
  runId: string
  status: ArtifactRunStatus
  createdAt: string
  updatedAt: string
  model?: string
  provider?: string
  mode?: string
  warning?: string
  files: ArtifactFileListItem[]
}

export interface ArtifactFileListItem {
  kind: string
  path: string
  mimeType?: string
  byteLength?: number
}

export interface ArtifactAssetListItem {
  projectId: string
  assetId: string
  title: string
  platform: string
  sourceUrl?: string
  mediaKind?: string
  createdAt: string
  updatedAt: string
  latestRunId?: string
  latestStatus?: ArtifactRunStatus
  runCount: number
  files: number
}

export interface ArtifactStoreStatus {
  enabled: boolean
  writable: boolean
  projectId: string
  rootLabel: string
  warning?: string
}

export interface ArtifactManifestResponse {
  asset: ArtifactAssetListItem
  runs: ArtifactRunListItem[]
  sourceFiles: ArtifactFileListItem[]
  manifest: Record<string, unknown>
}
