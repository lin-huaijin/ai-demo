import { createHash, randomUUID as createRandomUuid } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  join,
  resolve,
} from 'node:path'
import type { PreparedMedia } from '../multimodal/media.ts'
import type {
  ArtifactAssetManifest,
  ArtifactAssetSummary,
  ArtifactFileRecord,
  ArtifactProjectManifest,
  ArtifactReference,
  ArtifactRunExport,
  ArtifactRunManifest,
  ArtifactRunSummary,
  BeginArtifactRunInput,
  CompleteArtifactRunInput,
  CopyDownloadedMediaInput,
} from './types.ts'

const SCHEMA_VERSION = 1 as const
const DEFAULT_PROJECT_ID = 'default'
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const OMITTED_SECRET = '[redacted]'
const OMITTED_BASE64 = '[omitted inline binary]'
const MAX_INLINE_STRING_LENGTH = 1_024
const SECRET_KEY_PATTERN = /(?:^|[-_])(?:api[-_]?keys?|access[-_]?tokens?|refresh[-_]?tokens?|auth[-_]?tokens?|bearer[-_]?tokens?|secrets?|passwords?|authorizations?|cookies?|credentials?|private[-_]?keys?|headers?)(?:$|[-_])/i
const GENERIC_TOKEN_KEY_PATTERN = /(?:^|[-_])token$/i
const SECRET_QUERY_PATTERN = /^(?:api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|token|secret|signature|sig|x-amz-signature)$/i
const TRACKING_QUERY_PATTERN = /^(?:utm_.+|fbclid|gclid|yclid|mc_.+|is_from_webapp|sender_device|share_app_id|share_link_id)$/i
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+-]{12,}/gi
const API_KEY_PATTERN = /\b(?:sk|ark)-[A-Za-z0-9_-]{16,}\b/g
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const EMBEDDED_HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}，。；：]+/gi

export class ArtifactValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactValidationError'
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactNotFoundError'
  }
}

export interface LocalArtifactStoreOptions {
  rootDir?: string
  projectId?: string
  now?: () => Date
  randomUUID?: () => string
}

export function validateArtifactId(kind: string, value: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new ArtifactValidationError(
      `${kind} 只能包含字母、数字、下划线和连字符，且长度不能超过 128。`,
    )
  }
  return value
}

function normalizeUrl(
  rawValue: string | undefined,
  kind: 'source' | 'media',
): string {
  const value = rawValue?.trim()
  if (!value) return ''
  try {
    const url = new URL(value)
    url.hash = ''
    url.username = ''
    url.password = ''
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    if (
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
    ) {
      url.port = ''
    }
    if (kind === 'media') {
      url.search = ''
    } else {
      for (const key of [...url.searchParams.keys()]) {
        if (
          TRACKING_QUERY_PATTERN.test(key) ||
          SECRET_QUERY_PATTERN.test(key)
        ) {
          url.searchParams.delete(key)
        }
      }
      url.searchParams.sort()
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return value.replace(/\s+/g, ' ')
  }
}

export function normalizeArtifactSource(input: {
  sourceUrl?: string
  mediaUrl?: string
}): string {
  const source = normalizeUrl(input.sourceUrl, 'source')
  if (source) return source
  const media = normalizeUrl(input.mediaUrl, 'media')
  if (media) return media
  throw new ArtifactValidationError('sourceUrl 与 mediaUrl 至少需要提供一个。')
}

export function createArtifactAssetId(input: {
  sourceUrl?: string
  mediaUrl?: string
}): string {
  const canonicalSource = normalizeArtifactSource(input)
  const digest = createHash('sha256').update(canonicalSource).digest('hex')
  return `asset_${digest.slice(0, 24)}`
}

function createRunId(now: Date, randomUUID: () => string): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '')
  return `run_${stamp}_${randomUUID()}`
}

function isLongBase64(value: string): boolean {
  if (value.length <= MAX_INLINE_STRING_LENGTH || value.length % 4 !== 0) {
    return false
  }
  return BASE64_PATTERN.test(value)
}

function sanitizeString(value: string): string {
  if (/^data:[^;,]+;base64,/i.test(value) || isLongBase64(value)) {
    return OMITTED_BASE64
  }
  const withoutSignedQueries = value.replace(
    EMBEDDED_HTTP_URL_PATTERN,
    (candidate) => {
      try {
        const url = new URL(candidate)
        const host = url.hostname.toLowerCase()
        const identityVideoId = url.searchParams.get('v')
        const keepVideoId =
          Boolean(identityVideoId) &&
          /^[A-Za-z0-9_-]{1,128}$/.test(identityVideoId ?? '') &&
          ((/(^|\.)youtube\.com$/.test(host) && url.pathname === '/watch') ||
            (/(^|\.)facebook\.com$/.test(host) &&
              (url.pathname === '/watch' || url.pathname === '/video.php')))
        url.username = ''
        url.password = ''
        url.hash = ''
        url.search = ''
        if (keepVideoId && identityVideoId) {
          url.searchParams.set('v', identityVideoId)
        }
        return url.toString()
      } catch {
        return candidate
      }
    },
  )
  return withoutSignedQueries
    .replace(BEARER_PATTERN, `Bearer ${OMITTED_SECRET}`)
    .replace(API_KEY_PATTERN, OMITTED_SECRET)
}

/**
 * Prepare arbitrary provider/application data for local JSON persistence.
 * Binary inline payloads and credential-shaped fields are deliberately removed.
 */
export function sanitizeArtifactJson(value: unknown): unknown {
  const ancestors = new WeakSet<object>()
  const visit = (current: unknown, depth: number): unknown => {
    if (depth > 64) return '[omitted excessive depth]'
    if (typeof current === 'string') return sanitizeString(current)
    if (
      current === null ||
      typeof current === 'number' ||
      typeof current === 'boolean'
    ) {
      return current
    }
    if (typeof current === 'bigint') return current.toString()
    if (current instanceof Date) return current.toISOString()
    if (current instanceof Error) {
      return {
        name: current.name,
        message: sanitizeString(current.message),
      }
    }
    if (Array.isArray(current)) {
      if (ancestors.has(current)) return '[omitted circular reference]'
      ancestors.add(current)
      const result = current.map((entry) => visit(entry, depth + 1))
      ancestors.delete(current)
      return result
    }
    if (typeof current === 'object') {
      if (ancestors.has(current)) return '[omitted circular reference]'
      ancestors.add(current)
      const result: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(
        current as Record<string, unknown>,
      )) {
        const normalizedKey = key
          .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
          .toLowerCase()
        const sensitiveKey =
          SECRET_KEY_PATTERN.test(normalizedKey) ||
          (GENERIC_TOKEN_KEY_PATTERN.test(normalizedKey) &&
            typeof entry !== 'number' &&
            typeof entry !== 'bigint')
        result[key] = sensitiveKey
          ? OMITTED_SECRET
          : visit(entry, depth + 1)
      }
      ancestors.delete(current)
      return result
    }
    return String(current)
  }
  return visit(value, 0)
}

function mimeExtension(mimeType: string | undefined): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  const extensions: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return normalized ? extensions[normalized] ?? '' : ''
}

function safeExtension(input: {
  originalName?: string
  filePath?: string
  mimeType?: string
}): string {
  const candidate = extname(input.originalName ?? input.filePath ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
  if (/^\.[a-z0-9]{1,8}$/.test(candidate)) return candidate
  return mimeExtension(input.mimeType) || '.bin'
}

function safeLabel(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized?.slice(0, 40) || fallback
}

function timestampFromText(value: string): number | undefined {
  const match = value.match(/(?:关键帧时间|keyframe\s*time)\s*[:：]\s*([\d.]+)\s*s/i)
  if (!match) return undefined
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? seconds : undefined
}

function relativeFilePath(...parts: string[]): string {
  return parts.join('/').replace(/\\/g, '/')
}

async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ArtifactNotFoundError(`找不到归档文件：${basename(filePath)}`)
    }
    throw error
  }
}

async function writeBufferAtomic(
  filePath: string,
  value: Uint8Array,
  randomUUID: () => string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporary, value, { flag: 'wx' })
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  randomUUID: () => string,
): Promise<void> {
  const sanitized = sanitizeArtifactJson(value)
  await writeBufferAtomic(
    filePath,
    Buffer.from(`${JSON.stringify(sanitized, null, 2)}\n`, 'utf8'),
    randomUUID,
  )
}

function mergeFileRecord(
  records: ArtifactFileRecord[],
  record: ArtifactFileRecord,
): ArtifactFileRecord[] {
  return [...records.filter((entry) => entry.path !== record.path), record]
}

function runSummary(run: ArtifactRunManifest): ArtifactRunSummary {
  return {
    runId: run.runId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    requestedModel: run.requestedModel,
    reportedModel: run.reportedModel,
    warning: run.warning,
  }
}

function assetSummary(asset: ArtifactAssetManifest): ArtifactAssetSummary {
  return {
    assetId: asset.assetId,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    title: asset.source.title,
    platform: asset.source.platform,
    canonicalUrl: asset.source.canonicalUrl,
    latestRun: asset.runs.at(-1),
    runCount: asset.runs.length,
  }
}

function publicReference(run: ArtifactRunManifest): ArtifactReference {
  return {
    projectId: run.projectId,
    assetId: run.assetId,
    runId: run.runId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    warning: run.warning,
  }
}

export class LocalArtifactStore {
  readonly rootDir: string
  readonly projectId: string
  private readonly now: () => Date
  private readonly randomUUID: () => string
  private readonly writeQueues = new Map<string, Promise<void>>()

  constructor(options: LocalArtifactStoreOptions = {}) {
    this.rootDir = resolve(
      options.rootDir ??
        process.env.PORTFOLIO_ARTIFACT_ROOT ??
        join(process.cwd(), '.portfolio-data'),
    )
    this.projectId = validateArtifactId(
      'projectId',
      options.projectId ?? process.env.PORTFOLIO_PROJECT_ID ?? DEFAULT_PROJECT_ID,
    )
    this.now = options.now ?? (() => new Date())
    this.randomUUID = options.randomUUID ?? createRandomUuid
  }

  private projectDir(projectId: string): string {
    return join(this.rootDir, 'projects', validateArtifactId('projectId', projectId))
  }

  private assetDir(projectId: string, assetId: string): string {
    return join(
      this.projectDir(projectId),
      'sources',
      validateArtifactId('assetId', assetId),
    )
  }

  private runDir(reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>): string {
    return join(
      this.assetDir(reference.projectId, reference.assetId),
      'runs',
      validateArtifactId('runId', reference.runId),
    )
  }

  private async withWriteQueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(key) ?? Promise.resolve()
    let release: () => void = () => {}
    const current = new Promise<void>((resolveQueue) => {
      release = resolveQueue
    })
    const queued = previous.then(() => current)
    this.writeQueues.set(key, queued)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.writeQueues.get(key) === queued) this.writeQueues.delete(key)
    }
  }

  private async readProjectManifest(projectId: string): Promise<ArtifactProjectManifest> {
    return readJson(join(this.projectDir(projectId), 'manifest.json'))
  }

  async readAssetManifest(
    projectId: string,
    assetId: string,
  ): Promise<ArtifactAssetManifest> {
    return readJson(join(this.assetDir(projectId, assetId), 'manifest.json'))
  }

  async readRunManifest(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
  ): Promise<ArtifactRunManifest> {
    return readJson(join(this.runDir(reference), 'manifest.json'))
  }

  private async writeProjectManifest(manifest: ArtifactProjectManifest): Promise<void> {
    await writeJsonAtomic(
      join(this.projectDir(manifest.projectId), 'manifest.json'),
      manifest,
      this.randomUUID,
    )
  }

  private async writeAssetManifest(manifest: ArtifactAssetManifest): Promise<void> {
    await writeJsonAtomic(
      join(this.assetDir(manifest.projectId, manifest.assetId), 'manifest.json'),
      manifest,
      this.randomUUID,
    )
  }

  private async writeRunManifest(manifest: ArtifactRunManifest): Promise<void> {
    await writeJsonAtomic(
      join(
        this.runDir({
          projectId: manifest.projectId,
          assetId: manifest.assetId,
          runId: manifest.runId,
        }),
        'manifest.json',
      ),
      manifest,
      this.randomUUID,
    )
  }

  private async syncSummaries(run: ArtifactRunManifest): Promise<void> {
    const assetKey = `${run.projectId}/${run.assetId}`
    const asset = await this.withWriteQueue(assetKey, async () => {
      const manifest = await this.readAssetManifest(run.projectId, run.assetId)
      manifest.updatedAt = run.updatedAt
      manifest.runs = [
        ...manifest.runs.filter((entry) => entry.runId !== run.runId),
        runSummary(run),
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      await this.writeAssetManifest(manifest)
      return manifest
    })
    const projectKey = `${run.projectId}/manifest`
    await this.withWriteQueue(projectKey, async () => {
      const manifest = await this.readProjectManifest(run.projectId)
      manifest.updatedAt = run.updatedAt
      manifest.assets = [
        ...manifest.assets.filter((entry) => entry.assetId !== run.assetId),
        assetSummary(asset),
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      await this.writeProjectManifest(manifest)
    })
  }

  async beginRun(input: BeginArtifactRunInput): Promise<ArtifactReference> {
    const now = this.now()
    const createdAt = now.toISOString()
    const projectId = this.projectId
    const assetId = createArtifactAssetId(input)
    const runId = validateArtifactId('runId', createRunId(now, this.randomUUID))
    const canonicalUrl = normalizeArtifactSource(input)
    const projectDir = this.projectDir(projectId)
    const assetDir = this.assetDir(projectId, assetId)
    const runDir = this.runDir({ projectId, assetId, runId })
    await mkdir(join(assetDir, 'source', 'media'), { recursive: true })
    await mkdir(runDir, { recursive: true })

    const projectPath = join(projectDir, 'manifest.json')
    await this.withWriteQueue(`${projectId}/manifest`, async () => {
      if (!(await exists(projectPath))) {
        await this.writeProjectManifest({
          schemaVersion: SCHEMA_VERSION,
          projectId,
          createdAt,
          updatedAt: createdAt,
          assets: [],
        })
      }
    })

    const assetPath = join(assetDir, 'manifest.json')
    await this.withWriteQueue(`${projectId}/${assetId}`, async () => {
      if (!(await exists(assetPath))) {
        await this.writeAssetManifest({
          schemaVersion: SCHEMA_VERSION,
          projectId,
          assetId,
          createdAt,
          updatedAt: createdAt,
          source: {
            canonicalUrl,
            title: input.title,
            platform: input.platform,
          },
          sourceFiles: [],
          runs: [],
        })
      }
    })

    const run: ArtifactRunManifest = {
      schemaVersion: SCHEMA_VERSION,
      projectId,
      assetId,
      runId,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      requestedModel: input.requestedModel,
      profile: input.profile,
      source: {
        canonicalUrl,
        title: input.title,
        platform: input.platform,
      },
      requestMetadata: sanitizeArtifactJson(input.metadata),
      files: [],
    }
    await this.writeRunManifest(run)
    await this.syncSummaries(run)
    return publicReference(run)
  }

  async copyDownloadedMedia(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
    input: CopyDownloadedMediaInput,
  ): Promise<ArtifactFileRecord> {
    const sourceStat = await stat(input.filePath)
    if (!sourceStat.isFile()) {
      throw new ArtifactValidationError('下载媒体来源必须是文件。')
    }
    const digest = await fileSha256(input.filePath)
    const extension = safeExtension(input)
    const role = safeLabel(input.role, 'original')
    const fileName = `${role}-${digest.slice(0, 12)}${extension}`
    const destination = join(
      this.assetDir(reference.projectId, reference.assetId),
      'source',
      'media',
      fileName,
    )
    await mkdir(dirname(destination), { recursive: true })
    const temporary = join(
      dirname(destination),
      `.${fileName}.${this.randomUUID()}.tmp`,
    )
    try {
      await copyFile(input.filePath, temporary)
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    const record: ArtifactFileRecord = {
      scope: 'source',
      kind: role,
      path: relativeFilePath('source', 'media', fileName),
      mimeType: input.mimeType,
      byteLength: sourceStat.size,
      sha256: digest,
      createdAt: this.now().toISOString(),
    }
    const assetKey = `${reference.projectId}/${reference.assetId}`
    await this.withWriteQueue(assetKey, async () => {
      const asset = await this.readAssetManifest(
        reference.projectId,
        reference.assetId,
      )
      asset.updatedAt = record.createdAt
      asset.sourceFiles = mergeFileRecord(asset.sourceFiles, record)
      await this.writeAssetManifest(asset)
    })
    const run = await this.readRunManifest(reference)
    run.updatedAt = record.createdAt
    run.files = mergeFileRecord(run.files, record)
    await this.writeRunManifest(run)
    await this.syncSummaries(run)
    return record
  }

  async persistPreparedMedia(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
    prepared: Pick<
      PreparedMedia,
      | 'parts'
      | 'mode'
      | 'keyframeCount'
      | 'durationSeconds'
      | 'sourceAudioTrack'
      | 'audioInputProvenance'
      | 'audioTrackRemoved'
      | 'warnings'
    >,
  ): Promise<ArtifactFileRecord[]> {
    const runDir = this.runDir(reference)
    const records: ArtifactFileRecord[] = []
    const parts: unknown[] = []
    let pendingTimestamp: number | undefined
    let imageIndex = 0
    let keyframeIndex = 0
    let videoIndex = 0
    let audioIndex = 0
    let binaryIndex = 0
    for (const part of prepared.parts) {
      if ('text' in part) {
        pendingTimestamp = timestampFromText(part.text)
        parts.push({ type: 'text', text: part.text })
        continue
      }
      const mimeType = part.inlineData.mimeType
      const buffer = Buffer.from(part.inlineData.data, 'base64')
      let kind: string
      let relativePath: string
      if (mimeType.startsWith('image/') && pendingTimestamp !== undefined) {
        keyframeIndex += 1
        kind = 'keyframe'
        relativePath = relativeFilePath(
          'keyframes',
          `keyframe-${String(keyframeIndex).padStart(3, '0')}-${pendingTimestamp.toFixed(3)}s${mimeExtension(mimeType) || '.jpg'}`,
        )
      } else if (mimeType.startsWith('image/')) {
        imageIndex += 1
        kind = 'analysis-image'
        relativePath = relativeFilePath(
          'inputs',
          `analysis-image-${String(imageIndex).padStart(3, '0')}${mimeExtension(mimeType) || '.jpg'}`,
        )
      } else if (mimeType.startsWith('video/')) {
        videoIndex += 1
        kind = 'analysis-video'
        relativePath = relativeFilePath(
          'inputs',
          `analysis-video-${String(videoIndex).padStart(3, '0')}${mimeExtension(mimeType) || '.mp4'}`,
        )
      } else if (mimeType.startsWith('audio/')) {
        audioIndex += 1
        kind = 'analysis-audio'
        relativePath = relativeFilePath(
          'inputs',
          `analysis-audio-${String(audioIndex).padStart(3, '0')}${mimeExtension(mimeType) || '.bin'}`,
        )
      } else {
        binaryIndex += 1
        kind = 'analysis-input'
        relativePath = relativeFilePath(
          'inputs',
          `analysis-input-${String(binaryIndex).padStart(3, '0')}.bin`,
        )
      }
      const destination = join(runDir, ...relativePath.split('/'))
      await writeBufferAtomic(destination, buffer, this.randomUUID)
      const digest = createHash('sha256').update(buffer).digest('hex')
      const record: ArtifactFileRecord = {
        scope: 'run',
        kind,
        path: relativePath,
        mimeType,
        byteLength: buffer.byteLength,
        sha256: digest,
        createdAt: this.now().toISOString(),
      }
      records.push(record)
      parts.push({
        type: 'file',
        kind,
        path: relativePath,
        mimeType,
        byteLength: buffer.byteLength,
        sha256: digest,
        timestampSeconds: pendingTimestamp,
      })
      pendingTimestamp = undefined
    }

    const mediaDocument = {
      schemaVersion: SCHEMA_VERSION,
      mode: prepared.mode,
      durationSeconds: prepared.durationSeconds,
      keyframeCount: prepared.keyframeCount,
      sourceAudioTrack: prepared.sourceAudioTrack,
      audioInputProvenance: prepared.audioInputProvenance,
      audioTrackRemoved: prepared.audioTrackRemoved,
      warnings: prepared.warnings,
      parts,
    }
    await writeJsonAtomic(
      join(runDir, 'media.json'),
      mediaDocument,
      this.randomUUID,
    )
    const mediaJsonRecord: ArtifactFileRecord = {
      scope: 'run',
      kind: 'media-metadata',
      path: 'media.json',
      mimeType: 'application/json',
      byteLength: Buffer.byteLength(
        JSON.stringify(sanitizeArtifactJson(mediaDocument)),
        'utf8',
      ),
      createdAt: this.now().toISOString(),
    }
    records.push(mediaJsonRecord)
    const run = await this.readRunManifest(reference)
    run.updatedAt = mediaJsonRecord.createdAt
    for (const record of records) run.files = mergeFileRecord(run.files, record)
    await this.writeRunManifest(run)
    await this.syncSummaries(run)
    return records
  }

  async completeRun(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
    input: CompleteArtifactRunInput,
  ): Promise<ArtifactReference> {
    const runDir = this.runDir(reference)
    const analysis = sanitizeArtifactJson(input.analysis)
    await writeJsonAtomic(
      join(runDir, 'analysis.json'),
      analysis,
      this.randomUUID,
    )
    const now = this.now().toISOString()
    const run = await this.readRunManifest(reference)
    const analysisRecord =
      analysis && typeof analysis === 'object' && !Array.isArray(analysis)
        ? (analysis as Record<string, unknown>)
        : undefined
    const stageOutputs = [
      ['MM01', analysisRecord?.mm01],
      ['C01', analysisRecord?.contextResearch],
      ['P02F', analysisRecord?.p02Handoff],
      ['P02', analysisRecord?.p02],
    ] as const
    for (const [stage, output] of stageOutputs) {
      if (output === undefined) continue
      const path = relativeFilePath('stages', `${stage}.json`)
      await writeJsonAtomic(join(runDir, ...path.split('/')), output, this.randomUUID)
      run.files = mergeFileRecord(run.files, {
        scope: 'run',
        kind: `stage-${stage.toLowerCase()}`,
        path,
        mimeType: 'application/json',
        byteLength: Buffer.byteLength(JSON.stringify(output), 'utf8'),
        createdAt: now,
      })
    }
    run.status = input.status ?? 'complete'
    run.updatedAt = now
    run.completedAt = now
    run.requestedModel = input.requestedModel ?? run.requestedModel
    run.reportedModel = input.reportedModel
    run.usage = sanitizeArtifactJson(input.usage)
    run.resultMetadata = sanitizeArtifactJson(input.metadata)
    run.warning = input.warning
    run.files = mergeFileRecord(run.files, {
      scope: 'run',
      kind: 'analysis',
      path: 'analysis.json',
      mimeType: 'application/json',
      byteLength: Buffer.byteLength(JSON.stringify(analysis), 'utf8'),
      createdAt: now,
    })
    await this.writeRunManifest(run)
    await this.syncSummaries(run)
    return publicReference(run)
  }

  async failRun(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
    error: unknown,
  ): Promise<ArtifactReference> {
    const normalized = error instanceof Error
      ? {
          name: error.name,
          message: sanitizeString(error.message),
          code: (error as NodeJS.ErrnoException).code,
        }
      : { message: sanitizeString(String(error)) }
    const now = this.now().toISOString()
    await writeJsonAtomic(
      join(this.runDir(reference), 'error.json'),
      normalized,
      this.randomUUID,
    )
    const run = await this.readRunManifest(reference)
    run.status = 'failed'
    run.updatedAt = now
    run.failedAt = now
    run.error = normalized
    run.files = mergeFileRecord(run.files, {
      scope: 'run',
      kind: 'error',
      path: 'error.json',
      mimeType: 'application/json',
      byteLength: Buffer.byteLength(JSON.stringify(normalized), 'utf8'),
      createdAt: now,
    })
    await this.writeRunManifest(run)
    await this.syncSummaries(run)
    return publicReference(run)
  }

  async saveWorkflowSnapshot(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
    snapshot: unknown,
  ): Promise<ArtifactFileRecord> {
    const runKey = `${reference.projectId}/${reference.assetId}/${reference.runId}`
    return this.withWriteQueue(runKey, async () => {
    const sanitized = sanitizeArtifactJson(snapshot)
    const runDir = this.runDir(reference)
    await writeJsonAtomic(
      join(runDir, 'workflow.json'),
      sanitized,
      this.randomUUID,
    )
    const now = this.now().toISOString()
    const record: ArtifactFileRecord = {
      scope: 'run',
      kind: 'workflow-snapshot',
      path: 'workflow.json',
      mimeType: 'application/json',
      byteLength: Buffer.byteLength(JSON.stringify(sanitized), 'utf8'),
      createdAt: now,
    }
    const run = await this.readRunManifest(reference)
    const snapshotRecord =
      sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? (sanitized as Record<string, unknown>)
        : undefined
    const promptChain = Array.isArray(snapshotRecord?.promptChain)
      ? snapshotRecord.promptChain
      : []
    for (const prompt of promptChain) {
      if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) continue
      const promptRecord = prompt as Record<string, unknown>
      const id = typeof promptRecord.id === 'string' ? promptRecord.id : ''
      if (!/^(?:P(?:0[1-9]|1[01])|MM01|C01|P02F)$/.test(id)) continue
      const path = relativeFilePath('prompts', `${id}.json`)
      await writeJsonAtomic(
        join(runDir, ...path.split('/')),
        promptRecord,
        this.randomUUID,
      )
      run.files = mergeFileRecord(run.files, {
        scope: 'run',
        kind: `prompt-${id.toLowerCase()}`,
        path,
        mimeType: 'application/json',
        byteLength: Buffer.byteLength(JSON.stringify(promptRecord), 'utf8'),
        createdAt: now,
      })
    }
    for (const [name, value] of [
      ['breakdown', snapshotRecord?.breakdown],
      ['match', snapshotRecord?.match],
    ] as const) {
      if (value === undefined) continue
      const path = relativeFilePath('stages', `local-${name}.json`)
      await writeJsonAtomic(join(runDir, ...path.split('/')), value, this.randomUUID)
      run.files = mergeFileRecord(run.files, {
        scope: 'run',
        kind: `local-${name}`,
        path,
        mimeType: 'application/json',
        byteLength: Buffer.byteLength(JSON.stringify(value), 'utf8'),
        createdAt: now,
      })
    }
    run.updatedAt = now
    run.files = mergeFileRecord(run.files, record)
    await this.writeRunManifest(run)
    await this.syncSummaries(run)
    return record
    })
  }

  async listAssets(projectId = this.projectId): Promise<ArtifactAssetSummary[]> {
    validateArtifactId('projectId', projectId)
    try {
      return (await this.readProjectManifest(projectId)).assets
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) return []
      throw error
    }
  }

  async listRuns(projectId: string, assetId: string): Promise<ArtifactRunSummary[]> {
    return (await this.readAssetManifest(projectId, assetId)).runs
  }

  async exportRun(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
  ): Promise<ArtifactRunExport> {
    const project = await this.readProjectManifest(reference.projectId)
    const asset = await this.readAssetManifest(
      reference.projectId,
      reference.assetId,
    )
    const run = await this.readRunManifest(reference)
    const runDir = this.runDir(reference)
    const optionalJson = async (fileName: string): Promise<unknown | undefined> => {
      const filePath = join(runDir, fileName)
      return (await exists(filePath)) ? readJson(filePath) : undefined
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: this.now().toISOString(),
      reference: publicReference(run),
      project: {
        schemaVersion: project.schemaVersion,
        projectId: project.projectId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
      asset,
      run,
      media: await optionalJson('media.json'),
      analysis: await optionalJson('analysis.json'),
      workflow: await optionalJson('workflow.json'),
      error: await optionalJson('error.json'),
    }
  }

  /** Read a safe, manifest-listed run file for a future HTTP download endpoint. */
  async readRunFile(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
    relativePath: string,
  ): Promise<Buffer> {
    if (
      !relativePath ||
      relativePath.includes('\\') ||
      relativePath.startsWith('/') ||
      relativePath.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new ArtifactValidationError('归档文件路径无效。')
    }
    const run = await this.readRunManifest(reference)
    const record = run.files.find(
      (entry) => entry.scope === 'run' && entry.path === relativePath,
    )
    if (!record) throw new ArtifactNotFoundError('该文件不在运行清单中。')
    return readFile(join(this.runDir(reference), ...relativePath.split('/')))
  }

  /** Diagnostic helper; only returns relative paths and never leaks the root path. */
  async listStoredFiles(
    reference: Pick<ArtifactReference, 'projectId' | 'assetId' | 'runId'>,
  ): Promise<string[]> {
    const root = this.runDir(reference)
    const walk = async (directory: string, prefix = ''): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const relative = relativeFilePath(prefix, entry.name).replace(/^\//, '')
        if (entry.isDirectory()) {
          files.push(...(await walk(join(directory, entry.name), relative)))
        } else {
          files.push(relative)
        }
      }
      return files
    }
    return (await walk(root)).sort()
  }
}

export function createLocalArtifactStore(
  options: LocalArtifactStoreOptions = {},
): LocalArtifactStore {
  return new LocalArtifactStore(options)
}
