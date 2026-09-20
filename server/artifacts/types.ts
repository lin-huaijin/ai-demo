export type ArtifactStatus = 'pending' | 'complete' | 'failed' | 'partial'

export interface ArtifactReference {
  projectId: string
  assetId: string
  runId: string
  status: ArtifactStatus
  createdAt?: string
  updatedAt?: string
  warning?: string
}

export interface BeginArtifactRunInput {
  sourceUrl?: string
  mediaUrl?: string
  title?: string
  platform?: string
  requestedModel?: string
  profile?: string
  metadata?: unknown
}

export interface CopyDownloadedMediaInput {
  filePath: string
  mimeType?: string
  originalName?: string
  sourceUrl?: string
  role?: string
}

export interface CompleteArtifactRunInput {
  analysis: unknown
  status?: 'complete' | 'partial'
  requestedModel?: string
  reportedModel?: string
  usage?: unknown
  metadata?: unknown
  warning?: string
}

export interface ArtifactFileRecord {
  scope: 'source' | 'run'
  kind: string
  path: string
  mimeType?: string
  byteLength?: number
  sha256?: string
  createdAt: string
}

export interface ArtifactRunManifest {
  schemaVersion: 1
  projectId: string
  assetId: string
  runId: string
  status: ArtifactStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
  failedAt?: string
  requestedModel?: string
  reportedModel?: string
  profile?: string
  source: {
    canonicalUrl: string
    title?: string
    platform?: string
  }
  requestMetadata?: unknown
  resultMetadata?: unknown
  usage?: unknown
  warning?: string
  error?: {
    name?: string
    code?: string
    message: string
  }
  files: ArtifactFileRecord[]
}

export interface ArtifactRunSummary {
  runId: string
  status: ArtifactStatus
  createdAt: string
  updatedAt: string
  requestedModel?: string
  reportedModel?: string
  warning?: string
}

export interface ArtifactAssetManifest {
  schemaVersion: 1
  projectId: string
  assetId: string
  createdAt: string
  updatedAt: string
  source: {
    canonicalUrl: string
    title?: string
    platform?: string
  }
  sourceFiles: ArtifactFileRecord[]
  runs: ArtifactRunSummary[]
}

export interface ArtifactAssetSummary {
  assetId: string
  createdAt: string
  updatedAt: string
  title?: string
  platform?: string
  canonicalUrl: string
  latestRun?: ArtifactRunSummary
  runCount: number
}

export interface ArtifactProjectManifest {
  schemaVersion: 1
  projectId: string
  createdAt: string
  updatedAt: string
  assets: ArtifactAssetSummary[]
}

export interface ArtifactRunExport {
  schemaVersion: 1
  exportedAt: string
  reference: ArtifactReference
  project: Pick<
    ArtifactProjectManifest,
    'schemaVersion' | 'projectId' | 'createdAt' | 'updatedAt'
  >
  asset: ArtifactAssetManifest
  run: ArtifactRunManifest
  media?: unknown
  analysis?: unknown
  workflow?: unknown
  error?: unknown
}
