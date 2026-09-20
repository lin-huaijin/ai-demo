import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, relative } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  ArtifactNotFoundError,
  ArtifactValidationError,
  createLocalArtifactStore,
  type LocalArtifactStore,
} from './index.ts'
import { authorizeMultimodalRequest } from '../multimodal/guard.ts'

const MAX_WORKFLOW_BYTES = 5 * 1024 * 1024

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || !value.trim()) return fallback
  return /^(?:1|true|yes)$/i.test(value.trim())
}

export function artifactStoreFromEnv(
  env: Record<string, string | undefined>,
): LocalArtifactStore | undefined {
  const enabled = flag(
    env.PORTFOLIO_ARTIFACTS_ENABLED,
    !flag(env.VERCEL ?? process.env.VERCEL, false),
  )
  if (!enabled) return undefined
  return createLocalArtifactStore({
    rootDir: env.PORTFOLIO_ARTIFACT_ROOT,
    projectId: env.PORTFOLIO_PROJECT_ID,
  })
}

async function readJson(
  request: IncomingMessage,
  maxBytes = MAX_WORKFLOW_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new ArtifactValidationError('档案快照超过 5MB。')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown
  } catch {
    throw new ArtifactValidationError('请求体不是有效 JSON。')
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  downloadName?: string,
) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  if (downloadName) {
    response.setHeader(
      'content-disposition',
      `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`,
    )
  }
  response.end(JSON.stringify(body, null, downloadName ? 2 : 0))
}

function routeParts(path: string): string[] {
  return path.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

async function assetResponse(store: LocalArtifactStore, projectId: string, assetId: string) {
  const manifest = await store.readAssetManifest(projectId, assetId)
  const runManifests = await Promise.all(
    [...manifest.runs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((summary) =>
        store.readRunManifest({ projectId, assetId, runId: summary.runId }),
      ),
  )
  const runs = runManifests.map((run) => {
    const metadata = record(run.resultMetadata)
    return {
      runId: run.runId,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      model: run.reportedModel ?? run.requestedModel,
      provider: run.profile,
      mode:
        typeof metadata?.mediaMode === 'string' ? metadata.mediaMode : undefined,
      warning: run.warning,
      files: run.files.map(({ kind, path, mimeType, byteLength }) => ({
        kind,
        path,
        mimeType,
        byteLength,
      })),
    }
  })
  const latest = runs[0]
  const storedFiles = new Set(
    manifest.sourceFiles.map((file) => `source:${file.path}`),
  )
  for (const run of runManifests) {
    for (const file of run.files) {
      storedFiles.add(
        file.scope === 'source'
          ? `source:${file.path}`
          : `${run.runId}:${file.path}`,
      )
    }
  }
  return {
    asset: {
      projectId,
      assetId,
      title: manifest.source.title ?? '',
      platform: manifest.source.platform ?? 'unknown',
      sourceUrl: manifest.source.canonicalUrl || undefined,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      latestRunId: latest?.runId,
      latestStatus: latest?.status,
      runCount: runs.length,
      files: storedFiles.size,
    },
    runs,
    sourceFiles: manifest.sourceFiles.map(
      ({ kind, path, mimeType, byteLength }) => ({
        kind,
        path,
        mimeType,
        byteLength,
      }),
    ),
    manifest,
  }
}

function safeError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ArtifactNotFoundError) {
    return { status: 404, body: { error: '档案不存在。', code: 'ARTIFACT_NOT_FOUND' } }
  }
  if (error instanceof ArtifactValidationError || error instanceof URIError) {
    return { status: 400, body: { error: '档案请求不合法。', code: 'ARTIFACT_INVALID' } }
  }
  return { status: 500, body: { error: '本地档案服务异常。', code: 'ARTIFACT_FAILED' } }
}

export function artifactApiPlugin(
  env: Record<string, string | undefined>,
  providedStore = artifactStoreFromEnv(env),
): Plugin {
  return {
    name: 'portfolio-artifact-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        let path: string
        try {
          path = new URL(request.url ?? '/', 'http://localhost').pathname
        } catch {
          next()
          return
        }
        if (!path.startsWith('/api/artifacts')) {
          next()
          return
        }
        const store = providedStore
        if (!store) {
          sendJson(response, path === '/api/artifacts/status' ? 200 : 503, {
            enabled: false,
            writable: false,
            projectId: env.PORTFOLIO_PROJECT_ID || 'default',
            rootLabel: '未启用',
            warning: '当前环境未启用持久化档案。',
            error: path === '/api/artifacts/status' ? undefined : '当前环境未启用持久化档案。',
          })
          return
        }

        if (path !== '/api/artifacts/status') {
          const access = authorizeMultimodalRequest(request, env)
          if (!access.allowed) {
            sendJson(response, access.status, {
              error: access.message ?? '当前请求无权访问本地档案。',
              code: access.code ?? 'MULTIMODAL_ACCESS_REQUIRED',
            })
            return
          }
        }

        try {
          if (path === '/api/artifacts/status') {
            if (request.method !== 'GET') {
              sendJson(response, 405, { error: '仅支持 GET' })
              return
            }
            await mkdir(store.rootDir, { recursive: true })
            await access(store.rootDir, constants.W_OK)
            const localRelative = relative(process.cwd(), store.rootDir)
            sendJson(response, 200, {
              enabled: true,
              writable: true,
              projectId: store.projectId,
              rootLabel:
                localRelative && !localRelative.startsWith('..')
                  ? localRelative
                  : basename(store.rootDir),
            })
            return
          }

          if (path === '/api/artifacts') {
            if (request.method !== 'GET') {
              sendJson(response, 405, { error: '仅支持 GET' })
              return
            }
            const summaries = await store.listAssets()
            const assets = await Promise.all(
              [...summaries]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map(async (summary) =>
                  (await assetResponse(store, store.projectId, summary.assetId)).asset,
                ),
            )
            sendJson(response, 200, { assets })
            return
          }

          const parts = routeParts(path)
          // api/artifacts/projects/:projectId/assets/:assetId
          if (
            parts.length >= 6 &&
            parts[0] === 'api' &&
            parts[1] === 'artifacts' &&
            parts[2] === 'projects' &&
            parts[4] === 'assets'
          ) {
            const projectId = parts[3]
            const assetId = parts[5]
            if (projectId !== store.projectId) {
              throw new ArtifactNotFoundError('该项目档案不存在。')
            }
            if (parts.length === 6 && request.method === 'GET') {
              sendJson(response, 200, await assetResponse(store, projectId, assetId))
              return
            }
            // .../runs/:runId/export|workflow
            if (parts.length === 9 && parts[6] === 'runs') {
              const runId = parts[7]
              const action = parts[8]
              const reference = { projectId, assetId, runId }
              if (action === 'export' && request.method === 'GET') {
                sendJson(
                  response,
                  200,
                  await store.exportRun(reference),
                  `${assetId}-${runId}.json`,
                )
                return
              }
              if (action === 'workflow' && request.method === 'PUT') {
                await store.saveWorkflowSnapshot(reference, await readJson(request))
                sendJson(response, 200, { ok: true })
                return
              }
            }
          }
          sendJson(response, 404, { error: '档案接口不存在。', code: 'NOT_FOUND' })
        } catch (error) {
          const failure = safeError(error)
          sendJson(response, failure.status, failure.body)
        }
      })
    },
  }
}
