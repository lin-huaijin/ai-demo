import type { IncomingMessage, ServerResponse } from 'node:http'
import { apiSettingsStatusResult } from '../../server/settings/status.ts'

export default function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  if (request.method !== 'GET') {
    response.statusCode = 405
    response.end(JSON.stringify({ error: '仅支持 GET' }))
    return
  }
  const result = apiSettingsStatusResult()
  response.statusCode = result.status
  response.end(JSON.stringify(result.body))
}
