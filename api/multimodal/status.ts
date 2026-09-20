import type { IncomingMessage, ServerResponse } from 'node:http'
import { multimodalStatus } from '../../server/multimodal/api.ts'
import { multimodalAccessSummary } from '../../server/multimodal/guard.ts'
import { multimodalRuntimeForRequest } from '../../server/multimodal/profiles.ts'

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

export default function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: '仅支持 GET' })
    return
  }
  try {
    const result = multimodalStatus(
      multimodalRuntimeForRequest(request),
      multimodalAccessSummary(request),
    )
    sendJson(response, result.status, result.body)
  } catch {
    sendJson(response, 500, {
      error: '多模态模型服务端配置无效。',
      code: 'MULTIMODAL_CONFIG_INVALID',
    })
  }
}
