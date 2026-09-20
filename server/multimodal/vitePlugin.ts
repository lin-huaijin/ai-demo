import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { analyzeImageRequest } from '../imageAnalysis/api.ts'
import { imageGeminiConfigForRequest } from '../imageAnalysis/gemini.ts'
import { analyzeSourceRequest, multimodalStatus } from './api.ts'
import type { PrepareMediaOptions } from './media.ts'
import {
  acquireMultimodalCapacity,
  authorizeMultimodalRequest,
  multimodalAccessSummary,
} from './guard.ts'
import { multimodalRuntimeForRequest } from './profiles.ts'
import type { LocalArtifactStore } from '../artifacts/index.ts'

const MAX_JSON_BYTES = 1024 * 1024

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes)$/i.test(value?.trim() ?? '')
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Vite's loadEnv returns a plain object and deliberately does not mutate
 * process.env. Convert every media setting once and pass it explicitly so the
 * status probe and the actual FFmpeg/download path use the same configuration.
 */
export function prepareMediaOptionsFromEnv(
  env: Record<string, string | undefined>,
): PrepareMediaOptions {
  const options: PrepareMediaOptions = {
    allowClashFakeIp: enabled(env.MULTIMODAL_ALLOW_CLASH_FAKE_IP),
  }
  const inlineMaxBytes = positiveNumber(env.GEMINI_INLINE_VIDEO_MAX_BYTES)
  const transcodeTargetBytes = positiveNumber(env.GEMINI_TRANSCODE_TARGET_BYTES)
  const downloadMaxBytes = positiveNumber(env.MULTIMODAL_DOWNLOAD_MAX_BYTES)
  const ffmpegBin = env.FFMPEG_BIN?.trim()
  const ffprobeBin = env.FFPROBE_BIN?.trim()
  if (inlineMaxBytes !== undefined) options.inlineMaxBytes = inlineMaxBytes
  if (transcodeTargetBytes !== undefined) {
    options.transcodeTargetBytes = transcodeTargetBytes
  }
  if (downloadMaxBytes !== undefined) options.downloadMaxBytes = downloadMaxBytes
  if (ffmpegBin) options.ffmpegBin = ffmpegBin
  if (ffprobeBin) options.ffprobeBin = ffprobeBin
  return options
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_JSON_BYTES) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('INVALID_JSON')
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.end(JSON.stringify(body))
}

function parseFailure(error: unknown): Record<string, unknown> {
  return error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
    ? { error: '请求体超过 1MB', code: 'REQUEST_TOO_LARGE' }
    : { error: '请求体不是有效 JSON', code: 'INVALID_JSON' }
}

export function multimodalApiPlugin(
  env: Record<string, string | undefined>,
  artifactStore?: LocalArtifactStore,
): Plugin {
  return {
    name: 'portfolio-multimodal-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        if (path === '/api/multimodal/status') {
          if (request.method !== 'GET') {
            sendJson(response, 405, { error: '仅支持 GET' })
            return
          }
          try {
            const result = multimodalStatus(
              multimodalRuntimeForRequest(request, env),
              multimodalAccessSummary(request, env),
            )
            sendJson(response, result.status, result.body)
          } catch {
            sendJson(response, 500, {
              error: '多模态模型服务端配置无效。',
              code: 'MULTIMODAL_CONFIG_INVALID',
            })
          }
          return
        }
        if (path !== '/api/multimodal/analyze' && path !== '/api/image/analyze') {
          next()
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: '仅支持 POST' })
          return
        }
        const access = authorizeMultimodalRequest(request, env)
        if (!access.allowed) {
          sendJson(response, access.status, {
            error: access.message ?? '多模态服务不可用',
            code: access.code ?? 'MULTIMODAL_ACCESS_REQUIRED',
          })
          return
        }
        const release = acquireMultimodalCapacity(env)
        if (!release) {
          sendJson(response, 429, {
            error: '多模态任务繁忙或已达到分钟限额，请稍后重试。',
            code: 'MULTIMODAL_CAPACITY_LIMIT',
          })
          return
        }
        try {
          const body = await readJson(request)
          const onError = (error: unknown) => {
            const message =
              error instanceof Error
                ? `${error.name}: ${error.message}`.slice(0, 800)
                : 'Unknown multimodal analysis error'
            console.warn(`[portfolio multimodal] ${message}`)
          }
          const result = path === '/api/image/analyze'
            ? await analyzeImageRequest(body, {
                config: imageGeminiConfigForRequest(request, env),
                prepareOptions: prepareMediaOptionsFromEnv(env),
                onError,
              })
            : await analyzeSourceRequest(body, {
                runtime: multimodalRuntimeForRequest(request, env),
                prepareOptions: prepareMediaOptionsFromEnv(env),
                artifactStore,
                onError,
              })
          sendJson(response, result.status, result.body)
        } catch (error) {
          const isBodyError =
            error instanceof Error &&
            (error.message === 'REQUEST_TOO_LARGE' || error.message === 'INVALID_JSON')
          sendJson(
            response,
            isBodyError ? 400 : 500,
            isBodyError
              ? parseFailure(error)
              : {
                  error: '多模态模型服务端配置无效。',
                  code: 'MULTIMODAL_CONFIG_INVALID',
                },
          )
        } finally {
          release()
        }
      })
    },
  }
}
