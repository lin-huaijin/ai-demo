import type { IncomingMessage, ServerResponse } from 'node:http'
import { analyzeImageRequest } from '../../server/imageAnalysis/api.ts'
import { imageGeminiConfigForRequest } from '../../server/imageAnalysis/gemini.ts'
import {
  acquireMultimodalCapacity,
  authorizeMultimodalRequest,
} from '../../server/multimodal/guard.ts'

const MAX_JSON_BYTES = 1024 * 1024

interface VercelRequest extends IncomingMessage {
  body?: unknown
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

async function readBody(request: VercelRequest): Promise<unknown> {
  if (request.body !== undefined) {
    const bytes = Buffer.byteLength(JSON.stringify(request.body), 'utf8')
    if (bytes > MAX_JSON_BYTES) throw new Error('REQUEST_TOO_LARGE')
    return request.body
  }
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

export default async function handler(
  request: VercelRequest,
  response: ServerResponse,
) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: '仅支持 POST' })
    return
  }
  const access = authorizeMultimodalRequest(request)
  if (!access.allowed) {
    sendJson(response, access.status, {
      error: access.message ?? '图片 IM01 服务不可用',
      code: access.code ?? 'MULTIMODAL_ACCESS_REQUIRED',
    })
    return
  }
  const release = acquireMultimodalCapacity()
  if (!release) {
    sendJson(response, 429, {
      error: '图片 IM01 任务繁忙或已达到分钟限额，请稍后重试。',
      code: 'MULTIMODAL_CAPACITY_LIMIT',
    })
    return
  }
  try {
    const result = await analyzeImageRequest(await readBody(request), {
      config: imageGeminiConfigForRequest(request),
    })
    sendJson(response, result.status, result.body)
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
    const invalidJson = error instanceof Error && error.message === 'INVALID_JSON'
    sendJson(
      response,
      tooLarge || invalidJson ? 400 : 500,
      tooLarge
        ? { error: '请求体超过 1MB', code: 'REQUEST_TOO_LARGE' }
        : invalidJson
          ? { error: '请求体不是有效 JSON', code: 'INVALID_JSON' }
          : {
              error: '图片 IM01 服务端配置无效。',
              code: 'IM01_CONFIG_INVALID',
            },
    )
  } finally {
    release()
  }
}
