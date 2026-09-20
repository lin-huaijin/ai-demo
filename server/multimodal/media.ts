import { lookup } from 'node:dns/promises'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import {
  request as httpRequest,
  type IncomingMessage,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { SourceMediaKind } from '../../src/contracts/multimodalAnalysis.ts'

/** Runtime media preparation modes, independent from the legacy source-analysis contract. */
export type PreparedMediaMode =
  | 'video_inline_keyframes'
  | 'video_inline'
  | 'video_frames_audio'
  | 'video_frames'
  | 'video_audio'
  | 'image_inline'
  | 'text_only'

export type SourceAudioTrackStatus =
  | 'present'
  | 'absent'
  | 'unknown'
  | 'not_applicable'

export type AudioInputProvenance =
  | 'inline_video'
  | 'separate_audio'
  | 'none'
  | 'unknown'

const execFileAsync = promisify(execFile)
const DEFAULT_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024
// Whole request should remain below Gemini's inline request budget after
// base64 expansion and timestamped JPEG evidence are added.
const DEFAULT_INLINE_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_TRANSCODE_TARGET_BYTES = 8 * 1024 * 1024
const DEFAULT_KEYFRAME_COUNT = 8
const MAX_ADAPTIVE_KEYFRAMES = 24
const MIXED_MEDIA_KEYFRAME_CAP = 16
const MIN_KEYFRAME_SPACING_SECONDS = 0.18
const MAX_REDIRECTS = 4
const LOCAL_INPUT_PROTOCOLS = 'file,pipe'
const BLOCKED_MEDIA_EXTENSIONS = new Set([
  '.m3u',
  '.m3u8',
  '.mpd',
  '.ism',
  '.isml',
  '.concat',
  '.ffconcat',
])

export interface InlineDataPart {
  inlineData: {
    mimeType: string
    data: string
  }
}

export interface TextPart {
  text: string
}

export type GeminiMediaPart = InlineDataPart | TextPart

export interface PreparedMedia {
  parts: GeminiMediaPart[]
  mode: PreparedMediaMode
  keyframeCount: number
  durationSeconds?: number
  /** Audio-stream state detected from the downloaded source container. */
  sourceAudioTrack?: SourceAudioTrackStatus
  /** How audio, if any, actually reached the model request. */
  audioInputProvenance?: AudioInputProvenance
  /** True only when every inline video part was locally verified as audio-free. */
  audioTrackRemoved?: boolean
  warnings: string[]
  cleanup: () => Promise<void>
}

/**
 * A verified download that may be copied into the durable artifact archive.
 * The remote URL is deliberately omitted because CDN query strings often
 * contain short-lived signatures or credentials.
 */
export interface DownloadedMediaCapture {
  path: string
  mimeType: string
  kind: 'image' | 'video'
  byteLength: number
  label: string
}

export interface PrepareMediaOptions {
  inlineMaxBytes?: number
  transcodeTargetBytes?: number
  downloadMaxBytes?: number
  maxKeyframes?: number
  ffmpegBin?: string
  ffprobeBin?: string
  /** Produce audio-free inline video for visual-only model profiles. */
  stripAudioTrack?: boolean
  /** Local-only support for Clash Verge's DNS Fake-IP range. */
  allowClashFakeIp?: boolean
  /** Best-effort durable capture; failures never block media analysis. */
  onDownloadedMedia?: (media: DownloadedMediaCapture) => Promise<void>
}

async function captureDownloadedMedia(
  options: PrepareMediaOptions,
  media: Omit<DownloadedMediaCapture, 'label'>,
  label: string,
  warnings: string[],
): Promise<void> {
  if (!options.onDownloadedMedia) return
  try {
    await options.onDownloadedMedia({ ...media, label })
  } catch {
    warnings.push('原始素材已成功读取，但本地档案副本保存失败。')
  }
}

export interface PrepareMediaSource {
  /** Preferred/legacy primary media URL. */
  mediaUrl?: string
  /** Backward-compatible ordered union (videos before stills for mixed media). */
  mediaUrls?: string[]
  /** Independently meaningful video assets. */
  videoUrls?: string[]
  /** Independently meaningful still-image assets. */
  imageUrls?: string[]
}

export type PrepareMediaInput =
  | string
  | string[]
  | PrepareMediaSource
  | undefined

function uniqueMediaUrls(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim() ?? '')
        .filter(Boolean),
    ),
  ]
}

function sourceRecord(input: PrepareMediaInput): PrepareMediaSource | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : null
}

function legacyMediaUrls(input: PrepareMediaInput): string[] {
  if (typeof input === 'string') return uniqueMediaUrls([input])
  if (Array.isArray(input)) return uniqueMediaUrls(input)
  const source = sourceRecord(input)
  return source
    ? uniqueMediaUrls([source.mediaUrl, ...(source.mediaUrls ?? [])])
    : []
}

export interface MixedMediaPlan {
  primaryVideoUrl?: string
  supplementalImageUrls: string[]
  additionalVideoCount: number
  hasExplicitTypes: boolean
}

/**
 * Plan a mixed source without conflating separate videos with CDN fallbacks.
 * Legacy callers are supported by the documented ordering contract; remaining
 * entries are classified by their downloaded file signature in the image pass.
 */
export function planMixedMediaSources(input: PrepareMediaInput): MixedMediaPlan {
  const source = sourceRecord(input)
  const videoUrls = uniqueMediaUrls(source?.videoUrls ?? [])
  const imageUrls = uniqueMediaUrls(source?.imageUrls ?? [])
  const hasExplicitTypes = videoUrls.length > 0 || imageUrls.length > 0
  if (hasExplicitTypes) {
    return {
      primaryVideoUrl: videoUrls[0],
      supplementalImageUrls: imageUrls,
      additionalVideoCount: Math.max(0, videoUrls.length - 1),
      hasExplicitTypes: true,
    }
  }
  const ordered = legacyMediaUrls(input)
  return {
    primaryVideoUrl: ordered[0],
    supplementalImageUrls: ordered.slice(1),
    additionalVideoCount: 0,
    hasExplicitTypes: false,
  }
}

function inlinePayloadBytes(parts: GeminiMediaPart[]): number {
  return parts.reduce(
    (total, part) =>
      total + ('inlineData' in part ? Buffer.byteLength(part.inlineData.data, 'ascii') : 0),
    0,
  )
}

function timestampedKeyframeCount(parts: GeminiMediaPart[]): number {
  let pendingTimestamp = false
  let count = 0
  for (const part of parts) {
    if ('text' in part) {
      pendingTimestamp = /^\s*关键帧时间：/.test(part.text)
      continue
    }
    if (pendingTimestamp && part.inlineData.mimeType.startsWith('image/')) {
      count += 1
    }
    pendingTimestamp = false
  }
  return count
}

export interface BudgetedMediaParts {
  parts: GeminiMediaPart[]
  droppedInlineParts: number
}

/** Keep every inline payload under one request-wide base64 budget. */
export function fitMediaPartsToBase64Budget(
  parts: GeminiMediaPart[],
  maxBase64Bytes: number,
): BudgetedMediaParts {
  const fitted: GeminiMediaPart[] = []
  let pendingText: TextPart[] = []
  let used = 0
  let droppedInlineParts = 0
  for (const part of parts) {
    if ('text' in part) {
      pendingText.push(part)
      continue
    }
    const bytes = Buffer.byteLength(part.inlineData.data, 'ascii')
    if (used + bytes <= maxBase64Bytes) {
      fitted.push(...pendingText, part)
      used += bytes
    } else {
      droppedInlineParts += 1
    }
    pendingText = []
  }
  return { parts: fitted, droppedInlineParts }
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && octets[2] === 0) ||
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 192 && b === 88 && octets[2] === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  )
}

function ipv6Bytes(ip: string): Uint8Array | null {
  let normalized = ip.toLowerCase()
  const zoneIndex = normalized.indexOf('%')
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex)
  const halves = normalized.split('::')
  if (halves.length > 2) return null

  const parseHalf = (half: string): number[] | null => {
    if (!half) return []
    const words: number[] = []
    for (const part of half.split(':')) {
      if (part.includes('.')) {
        if (isIP(part) !== 4) return null
        const octets = part.split('.').map(Number)
        words.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null
        words.push(Number.parseInt(part, 16))
      }
    }
    return words
  }

  const left = parseHalf(halves[0])
  const right = parseHalf(halves[1] ?? '')
  if (!left || !right) return null
  const omitted = 8 - left.length - right.length
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) {
    return null
  }
  const words = [...left, ...Array(Math.max(0, omitted)).fill(0), ...right]
  if (words.length !== 8) return null
  return Uint8Array.from(words.flatMap((word) => [word >> 8, word & 0xff]))
}

function hasPrefix(bytes: Uint8Array, prefix: number[], prefixBits: number): boolean {
  for (let bit = 0; bit < prefixBits; bit += 1) {
    const byteIndex = Math.floor(bit / 8)
    const mask = 1 << (7 - (bit % 8))
    if ((bytes[byteIndex] & mask) !== ((prefix[byteIndex] ?? 0) & mask)) return false
  }
  return true
}

/** Only globally routable addresses may be used as remote media origins. */
export function isPublicIpAddress(ip: string): boolean {
  if (isIP(ip) === 4) return !isPrivateIpv4(ip)
  if (isIP(ip) !== 6) return false
  const bytes = ipv6Bytes(ip)
  if (!bytes) return false

  // Restrict IPv6 to global unicast. This rejects loopback, ULA, link-local,
  // multicast, IPv4-compatible/mapped addresses and transition mechanisms.
  if (!hasPrefix(bytes, [0x20], 3)) return false
  // IETF special-use, documentation and transition ranges are not public origins.
  if (hasPrefix(bytes, [0x20, 0x01, 0x00], 23)) return false
  if (hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return false
  if (hasPrefix(bytes, [0x20, 0x02], 16)) return false
  if (hasPrefix(bytes, [0x3f, 0xfe], 16)) return false
  return true
}

function isClashFakeIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false
  const [a, b] = ip.split('.').map(Number)
  return a === 198 && (b === 18 || b === 19)
}

/**
 * Clash Verge Fake-IP mode intentionally returns 198.18.0.0/15 for public
 * hostnames. This exception is only available for DNS results after a local
 * operator opts in; literal-IP URLs remain subject to the strict public-IP rule.
 */
export function isAllowedResolvedAddress(
  ip: string,
  allowClashFakeIp = false,
): boolean {
  return isPublicIpAddress(ip) || (allowClashFakeIp && isClashFakeIpv4(ip))
}

function clashFakeIpEnabled(): boolean {
  return /^(?:1|true|yes)$/i.test(
    process.env.MULTIMODAL_ALLOW_CLASH_FAKE_IP?.trim() ?? '',
  )
}

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

interface ResolvedRemoteUrl {
  url: URL
  address: string
  family: 4 | 6
}

async function resolveSafeRemoteUrl(
  rawUrl: string,
  allowClashFakeIp = clashFakeIpEnabled(),
): Promise<ResolvedRemoteUrl> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('素材 URL 仅支持 http/https')
  }
  if (url.username || url.password) throw new Error('素材 URL 不允许携带账号信息')
  if (BLOCKED_MEDIA_EXTENSIONS.has(extname(url.pathname).toLowerCase())) {
    throw new Error('素材 URL 不允许使用 HLS、DASH 或 concat 清单')
  }
  const hostname = hostnameWithoutBrackets(url.hostname.toLowerCase())
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('素材 URL 不允许访问本机地址')
  }
  const literalFamily = isIP(hostname)
  if (literalFamily) {
    // Explicit IP URLs never inherit the Clash compatibility exception.
    if (!isPublicIpAddress(hostname)) throw new Error('素材 URL 不允许访问内网或非公网地址')
    return { url, address: hostname, family: literalFamily as 4 | 6 }
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address }) => !isAllowedResolvedAddress(address, allowClashFakeIp),
    )
  ) {
    throw new Error('素材 URL 解析到了内网、非公网或无效地址')
  }
  const selected = addresses[0]
  return {
    url,
    address: selected.address,
    family: selected.family as 4 | 6,
  }
}

export async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  return (await resolveSafeRemoteUrl(rawUrl)).url
}

function extensionForMime(mimeType: string, rawUrl: string): string {
  const mime = mimeType.toLowerCase()
  if (mime.includes('mp4')) return '.mp4'
  if (mime.includes('webm')) return '.webm'
  if (mime.includes('quicktime')) return '.mov'
  if (mime.includes('msvideo')) return '.avi'
  if (mime.includes('mpeg')) return '.mpeg'
  if (mime.includes('jpeg')) return '.jpg'
  if (mime.includes('png')) return '.png'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  if (mime.includes('avif')) return '.avif'
  if (mime.includes('heic') || mime.includes('heif')) return '.heic'
  const ext = extname(new URL(rawUrl).pathname).toLowerCase()
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.bin'
}

export interface ClassifiedMedia {
  kind: 'image' | 'video'
  mimeType: string
}

function startsWithBytes(body: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => body[index] === byte)
}

function textLikePrefix(body: Buffer): string {
  const prefix = body.subarray(0, Math.min(body.length, 4096))
  if (prefix.length === 0) return ''
  let printable = 0
  for (const byte of prefix) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      printable += 1
    }
  }
  if (printable / prefix.length < 0.82) return ''
  return prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase()
}

/** Reject manifests/documents and recognize only self-contained media payloads. */
export function classifyMediaPayload(
  body: Buffer,
  declaredMimeType = '',
): ClassifiedMedia {
  const mimeType = declaredMimeType.split(';')[0].trim().toLowerCase()
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/xhtml+xml' ||
    mimeType.includes('mpegurl') ||
    mimeType.includes('dash+xml')
  ) {
    throw new Error('素材响应不是普通图片或视频文件')
  }

  const text = textLikePrefix(body)
  if (
    text.startsWith('#extm3u') ||
    text.startsWith('<mpd') ||
    (text.startsWith('<?xml') && /<mpd(?:\s|>)/.test(text)) ||
    text.startsWith('<!doctype html') ||
    text.startsWith('<html') ||
    text.startsWith('<head') ||
    text.startsWith('<body') ||
    text.startsWith('ffconcat version') ||
    /^(?:file|duration|inpoint|outpoint|option)\s+/.test(text)
  ) {
    throw new Error('素材响应包含 HLS、DASH、concat 或 HTML 内容')
  }

  if (startsWithBytes(body, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mimeType: 'image/jpeg' }
  }
  if (startsWithBytes(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mimeType: 'image/png' }
  }
  if (
    body.length >= 12 &&
    body.subarray(0, 4).toString('ascii') === 'RIFF' &&
    body.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { kind: 'image', mimeType: 'image/webp' }
  }
  if (body.subarray(0, 6).toString('ascii') === 'GIF87a' || body.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { kind: 'image', mimeType: 'image/gif' }
  }
  if (body.length >= 12 && body.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = body.subarray(8, 12).toString('ascii').toLowerCase()
    if (brand === 'avif' || brand === 'avis') {
      return { kind: 'image', mimeType: 'image/avif' }
    }
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return { kind: 'image', mimeType: 'image/heic' }
    }
    return {
      kind: 'video',
      mimeType: mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4',
    }
  }
  if (startsWithBytes(body, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'video', mimeType: 'video/webm' }
  }
  if (
    body.length >= 12 &&
    body.subarray(0, 4).toString('ascii') === 'RIFF' &&
    body.subarray(8, 12).toString('ascii') === 'AVI '
  ) {
    return { kind: 'video', mimeType: 'video/x-msvideo' }
  }
  if (startsWithBytes(body, [0x46, 0x4c, 0x56])) {
    return { kind: 'video', mimeType: 'video/x-flv' }
  }
  if (
    startsWithBytes(body, [0x00, 0x00, 0x01, 0xba]) ||
    startsWithBytes(body, [0x00, 0x00, 0x01, 0xb3])
  ) {
    return { kind: 'video', mimeType: 'video/mpeg' }
  }
  throw new Error('无法确认素材为受支持的普通图片或视频文件')
}

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }])
    else callback(null, address, family)
  }
}

async function requestPinned(remote: ResolvedRemoteUrl): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const requester = remote.url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = requester(
      remote.url,
      {
        method: 'GET',
        // Never reuse a socket resolved outside this validation step.
        agent: false,
        lookup: pinnedLookup(remote.address, remote.family),
        servername:
          remote.url.protocol === 'https:' && isIP(hostnameWithoutBrackets(remote.url.hostname)) === 0
            ? hostnameWithoutBrackets(remote.url.hostname)
            : undefined,
        headers: {
          host: remote.url.host,
          'user-agent': 'AICreativeWorkflow/0.1 media-analyzer',
          accept: 'video/*,image/*,application/octet-stream;q=0.5',
          'accept-encoding': 'identity',
        },
      },
      resolve,
    )
    request.setTimeout(120_000, () => request.destroy(new Error('素材下载超时')))
    request.once('error', reject)
    request.end()
  })
}

async function readResponseBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy()
    throw new Error('素材超过允许的下载大小')
  }
  const contentEncoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase()
  if (contentEncoding !== 'identity') {
    response.destroy()
    throw new Error('素材响应不允许压缩传输编码')
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      response.destroy()
      reject(error)
    }
    response.on('data', (chunk: Buffer | Uint8Array) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > maxBytes) {
        fail(new Error('素材下载过程中超过允许大小'))
        return
      }
      chunks.push(buffer)
    })
    response.once('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    response.once('aborted', () => fail(new Error('素材下载连接中断')))
    response.once('error', (error) => fail(error))
  })
}

async function downloadRemoteMedia(
  rawUrl: string,
  dir: string,
  maxBytes: number,
  stem = 'source',
  allowClashFakeIp?: boolean,
): Promise<{ path: string; mimeType: string; kind: 'image' | 'video'; byteLength: number }> {
  let remote = await resolveSafeRemoteUrl(rawUrl, allowClashFakeIp)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await requestPinned(remote)
    const status = response.statusCode ?? 0
    if (status >= 300 && status < 400) {
      const location = response.headers.location
      if (!location) throw new Error(`素材重定向缺少 Location（HTTP ${status}）`)
      response.resume()
      remote = await resolveSafeRemoteUrl(
        new URL(location, remote.url).toString(),
        allowClashFakeIp,
      )
      continue
    }
    if (status < 200 || status >= 300) {
      response.destroy()
      throw new Error(`素材下载失败（HTTP ${status}）`)
    }
    const body = await readResponseBody(response, maxBytes)
    const classified = classifyMediaPayload(body, String(response.headers['content-type'] ?? ''))
    const path = join(
      dir,
      `${stem}${extensionForMime(classified.mimeType, remote.url.toString())}`,
    )
    await writeFile(path, body)
    return { path, ...classified, byteLength: body.length }
  }
  throw new Error('素材重定向次数过多')
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['-version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

export interface ProbedMediaInfo {
  durationSeconds?: number
  sourceAudioTrack: Exclude<SourceAudioTrackStatus, 'not_applicable'>
}

export function parseFfprobeMediaInfo(raw: string): ProbedMediaInfo {
  try {
    const parsed = JSON.parse(raw) as {
      format?: { duration?: string | number }
      streams?: Array<{ codec_type?: string }>
    }
    const duration = Number(parsed.format?.duration)
    const durationSeconds =
      Number.isFinite(duration) && duration > 0 ? duration : undefined
    const sourceAudioTrack = Array.isArray(parsed.streams)
      ? parsed.streams.some((stream) => stream?.codec_type === 'audio')
        ? 'present'
        : 'absent'
      : 'unknown'
    return { durationSeconds, sourceAudioTrack }
  } catch {
    return { sourceAudioTrack: 'unknown' }
  }
}

async function probeMediaInfo(path: string, ffprobeBin: string): Promise<ProbedMediaInfo> {
  try {
    const { stdout } = await execFileAsync(
      ffprobeBin,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        LOCAL_INPUT_PROTOCOLS,
        '-show_entries',
        'format=duration:stream=codec_type',
        '-of',
        'json',
        path,
      ],
      { timeout: 20_000 },
    )
    return parseFfprobeMediaInfo(stdout)
  } catch {
    return { sourceAudioTrack: 'unknown' }
  }
}

async function detectSceneCuts(path: string, ffmpegBin: string): Promise<number[]> {
  try {
    const { stderr } = await execFileAsync(
      ffmpegBin,
      [
        '-hide_banner',
        '-nostdin',
        '-protocol_whitelist',
        LOCAL_INPUT_PROTOCOLS,
        '-i',
        path,
        '-vf',
        "select='gt(scene,0.30)',showinfo",
        '-an',
        '-f',
        'null',
        '-',
      ],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    )
    return [...stderr.matchAll(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0.05)
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

/**
 * Preserve the legacy eight-frame floor for short clips, then add evidence as
 * duration grows. An explicit max is always a hard cap; zero disables frames.
 */
export function adaptiveKeyframeCount(
  durationSeconds: number | undefined,
  explicitMaxKeyframes?: number,
): number {
  const desired =
    durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 30
      ? DEFAULT_KEYFRAME_COUNT
      : durationSeconds <= 60
        ? 10
        : durationSeconds <= 90
          ? 12
          : durationSeconds <= 120
            ? 16
            : durationSeconds <= 180
              ? 20
              : MAX_ADAPTIVE_KEYFRAMES
  const cap =
    explicitMaxKeyframes === undefined
      ? MAX_ADAPTIVE_KEYFRAMES
      : Number.isFinite(explicitMaxKeyframes)
        ? Math.min(
            MAX_ADAPTIVE_KEYFRAMES,
            Math.max(0, Math.floor(explicitMaxKeyframes)),
          )
        : 0
  return Math.min(desired, cap)
}

function nearestSceneCutInRange(
  sceneCuts: number[],
  start: number,
  end: number,
  target: number,
): number | undefined {
  let nearest: number | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const cut of sceneCuts) {
    if (cut < start || cut > end) continue
    const distance = Math.abs(cut - target)
    if (distance < nearestDistance) {
      nearest = cut
      nearestDistance = distance
    }
  }
  return nearest
}

/**
 * Cover the entire timeline first. Scene cuts may refine one temporal bucket,
 * but dense early cuts can never consume evidence reserved for later buckets.
 */
export function selectEvidenceTimestamps(
  durationSeconds: number,
  sceneCuts: number[],
  maxFrames: number,
): number[] {
  const targetCount = Number.isFinite(maxFrames)
    ? Math.max(0, Math.floor(maxFrames))
    : 0
  if (targetCount <= 0 || durationSeconds <= 0) return []
  const edge = Math.min(0.2, durationSeconds * 0.05)
  const end = Math.max(edge, durationSeconds - edge)
  const cuts = sceneCuts
    .filter((cut) => Number.isFinite(cut) && cut >= edge && cut <= end)
    .sort((a, b) => a - b)
  const selected: number[] = []
  const add = (candidate: number): boolean => {
    const timestamp = Math.min(
      Math.max(candidate, edge),
      end,
    )
    if (
      selected.some(
        (existing) =>
          Math.abs(existing - timestamp) < MIN_KEYFRAME_SPACING_SECONDS,
      )
    ) return false
    selected.push(timestamp)
    return true
  }

  // Start, the 1-3 second hook window, and the ending are protected anchors.
  add(edge)
  let hook: number | undefined
  if (targetCount >= 3) {
    hook = durationSeconds >= 3
      ? Math.min(2, Math.max(1, durationSeconds * 0.08))
      : durationSeconds / 2
    add(hook)
  }
  if (targetCount >= 2) add(end)

  const remaining = Math.max(0, targetCount - selected.length)
  if (remaining > 0) {
    const interiorStart = Math.min(
      end,
      Math.max(edge, (hook ?? edge) + MIN_KEYFRAME_SPACING_SECONDS),
    )
    const interiorEnd = Math.max(
      interiorStart,
      end - MIN_KEYFRAME_SPACING_SECONDS,
    )
    const span = interiorEnd - interiorStart
    for (let index = 0; index < remaining; index += 1) {
      const bucketStart = interiorStart + (index / remaining) * span
      const bucketEnd = interiorStart + ((index + 1) / remaining) * span
      const midpoint = (bucketStart + bucketEnd) / 2
      const cut = nearestSceneCutInRange(cuts, bucketStart, bucketEnd, midpoint)
      add(cut === undefined ? midpoint : Math.min(bucketEnd, cut + 0.04))
    }
  }

  // Very short clips or de-duplication can leave a slot empty. Refill the
  // largest uncovered gaps, retaining full-timeline balance.
  while (selected.length < targetCount) {
    const ordered = [...selected].sort((a, b) => a - b)
    let bestCandidate: number | undefined
    let bestGap = 0
    for (let index = 1; index < ordered.length; index += 1) {
      const left = ordered[index - 1]
      const right = ordered[index]
      const gap = right - left
      if (gap <= bestGap || gap < MIN_KEYFRAME_SPACING_SECONDS * 2) continue
      const midpoint = (left + right) / 2
      const cut = nearestSceneCutInRange(
        cuts,
        left + MIN_KEYFRAME_SPACING_SECONDS,
        right - MIN_KEYFRAME_SPACING_SECONDS,
        midpoint,
      )
      bestCandidate = cut === undefined ? midpoint : cut + 0.04
      bestGap = gap
    }
    if (bestCandidate === undefined || !add(bestCandidate)) break
  }
  return selected.sort((a, b) => a - b).map((value) => Number(value.toFixed(2)))
}

export interface TimestampedKeyframe {
  timestamp: number
  data: string
}

/** Select a coverage-preserving subset instead of deleting frames from the tail. */
export function selectUniformKeyframeSubset<T extends TimestampedKeyframe>(
  frames: T[],
  maxFrames: number,
): T[] {
  const limit = Number.isFinite(maxFrames)
    ? Math.max(0, Math.floor(maxFrames))
    : 0
  const ordered = [...frames].sort((a, b) => a.timestamp - b.timestamp)
  if (limit >= ordered.length) return ordered
  if (limit === 0) return []

  const selected = new Set<number>([0])
  if (limit >= 2) selected.add(ordered.length - 1)
  if (limit >= 3) {
    let hookIndex = 0
    let hookDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < ordered.length; index += 1) {
      const distance = Math.abs(ordered[index].timestamp - 1.5)
      if (distance < hookDistance) {
        hookIndex = index
        hookDistance = distance
      }
    }
    selected.add(hookIndex)
  }

  while (selected.size < limit) {
    let bestIndex = -1
    let bestDistance = -1
    for (let index = 0; index < ordered.length; index += 1) {
      if (selected.has(index)) continue
      const distance = Math.min(
        ...[...selected].map((selectedIndex) =>
          Math.abs(ordered[index].timestamp - ordered[selectedIndex].timestamp),
        ),
      )
      if (distance > bestDistance) {
        bestIndex = index
        bestDistance = distance
      }
    }
    if (bestIndex < 0) break
    selected.add(bestIndex)
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => ordered[index])
}

/** Fit frames around already-reserved video/audio base64 bytes. */
export function fitKeyframesToBase64Budget<T extends TimestampedKeyframe>(
  frames: T[],
  reservedBase64Bytes: number,
  maxBase64Bytes: number,
): T[] {
  const available = Math.max(0, maxBase64Bytes - reservedBase64Bytes)
  const ordered = [...frames].sort((a, b) => a.timestamp - b.timestamp)
  const bytes = (items: T[]) =>
    items.reduce(
      (total, frame) => total + Buffer.byteLength(frame.data, 'ascii'),
      0,
    )
  if (bytes(ordered) <= available) return ordered
  for (let limit = ordered.length - 1; limit > 0; limit -= 1) {
    const subset = selectUniformKeyframeSubset(ordered, limit)
    if (bytes(subset) <= available) return subset
  }
  return []
}

async function extractKeyframes(
  path: string,
  dir: string,
  timestamps: number[],
  ffmpegBin: string,
): Promise<Array<{ timestamp: number; data: string }>> {
  const frames: Array<{ timestamp: number; data: string }> = []
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index]
    const output = join(dir, `frame-${String(index + 1).padStart(2, '0')}.jpg`)
    try {
      await execFileAsync(
        ffmpegBin,
        [
          '-y',
          '-nostdin',
          '-ss',
          timestamp.toFixed(3),
          '-protocol_whitelist',
          LOCAL_INPUT_PROTOCOLS,
          '-i',
          path,
          '-frames:v',
          '1',
          '-vf',
          "scale='if(gte(iw,ih),-2,768)':'if(gte(iw,ih),768,-2)'",
          '-q:v',
          '3',
          output,
        ],
        { timeout: 35_000 },
      )
      frames.push({
        timestamp,
        data: (await readFile(output)).toString('base64'),
      })
    } catch {
      // A single corrupt frame must not discard the remaining evidence.
    }
  }
  return frames
}

export function targetVideoBitrateKbps(
  targetBytes: number,
  durationSeconds: number,
  audioKbps = 64,
): number {
  if (durationSeconds <= 0) return 300
  return Math.max(300, Math.floor((targetBytes * 8) / 1000 / durationSeconds - audioKbps))
}

async function transcodeVideo(
  input: string,
  output: string,
  duration: number,
  targetBytes: number,
  ffmpegBin: string,
  includeAudio = true,
): Promise<boolean> {
  const bitrate = targetVideoBitrateKbps(
    targetBytes,
    duration || 12,
    includeAudio ? 64 : 0,
  )
  try {
    await execFileAsync(
      ffmpegBin,
      [
        '-y',
        '-nostdin',
        '-protocol_whitelist',
        LOCAL_INPUT_PROTOCOLS,
        '-i',
        input,
        '-map',
        '0:v:0',
        ...(includeAudio ? ['-map', '0:a:0?'] : []),
        '-vf',
        "scale='if(gte(iw,ih),-2,480)':'if(gte(iw,ih),480,-2)'",
        '-c:v',
        'libx264',
        '-b:v',
        `${bitrate}k`,
        '-preset',
        'veryfast',
        ...(includeAudio ? ['-c:a', 'aac', '-b:a', '64k'] : ['-an']),
        '-movflags',
        '+faststart',
        output,
      ],
      { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 },
    )
    return (await stat(output)).size > 0
  } catch {
    return false
  }
}

async function removeVideoAudioTrack(
  input: string,
  output: string,
  ffmpegBin: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      ffmpegBin,
      [
        '-y',
        '-nostdin',
        '-protocol_whitelist',
        LOCAL_INPUT_PROTOCOLS,
        '-i',
        input,
        '-map',
        '0:v:0',
        '-c:v',
        'copy',
        '-an',
        '-movflags',
        '+faststart',
        output,
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    )
    return (await stat(output)).size > 0
  } catch {
    return false
  }
}

async function extractAudio(
  input: string,
  output: string,
  ffmpegBin: string,
): Promise<string | null> {
  try {
    await execFileAsync(
      ffmpegBin,
      [
        '-y',
        '-nostdin',
        '-protocol_whitelist',
        LOCAL_INPUT_PROTOCOLS,
        '-i',
        input,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-b:a',
        '64k',
        output,
      ],
      { timeout: 180_000 },
    )
    return (await readFile(output)).toString('base64')
  } catch {
    return null
  }
}

function imageMime(mimeType: string, path: string): string {
  if (mimeType.startsWith('image/')) return mimeType
  const ext = extname(path).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

export function fitsCumulativeInlineBudget(
  usedRawBytes: number,
  usedBase64Bytes: number,
  nextRawBytes: number,
  nextBase64Bytes: number,
  rawBudgetBytes: number,
  base64BudgetBytes: number,
): boolean {
  return (
    [
      usedRawBytes,
      usedBase64Bytes,
      nextRawBytes,
      nextBase64Bytes,
      rawBudgetBytes,
      base64BudgetBytes,
    ].every((value) => Number.isFinite(value) && value >= 0) &&
    usedRawBytes + nextRawBytes <= rawBudgetBytes &&
    usedBase64Bytes + nextBase64Bytes <= base64BudgetBytes
  )
}

async function prepareMixedMedia(
  input: PrepareMediaInput,
  options: PrepareMediaOptions,
): Promise<PreparedMedia> {
  const inlineMaxBytes =
    options.inlineMaxBytes ??
    numberFromEnv('GEMINI_INLINE_VIDEO_MAX_BYTES', DEFAULT_INLINE_MAX_BYTES)
  const transcodeTargetBytes =
    options.transcodeTargetBytes ??
    numberFromEnv(
      'GEMINI_TRANSCODE_TARGET_BYTES',
      DEFAULT_TRANSCODE_TARGET_BYTES,
    )
  const downloadMaxBytes =
    options.downloadMaxBytes ??
    numberFromEnv('MULTIMODAL_DOWNLOAD_MAX_BYTES', DEFAULT_DOWNLOAD_MAX_BYTES)
  const maxBase64Bytes = Math.ceil((inlineMaxBytes * 4) / 3) + 4
  const plan = planMixedMediaSources(input)
  const warnings: string[] = []
  const cleanups: Array<() => Promise<void>> = []
  let durationSeconds: number | undefined
  let primaryMediaPrepared = false
  let primaryAudioTrackRemoved: boolean | undefined
  let primarySourceAudioTrack: SourceAudioTrackStatus = plan.primaryVideoUrl
    ? 'unknown'
    : 'not_applicable'
  let primaryAudioInputProvenance: AudioInputProvenance = plan.primaryVideoUrl
    ? 'unknown'
    : 'none'
  let combinedParts: GeminiMediaPart[] = []

  if (plan.additionalVideoCount > 0) {
    warnings.push(
      `混合素材包含 ${plan.additionalVideoCount + 1} 个独立视频；受单次请求总预算限制，首阶段仅分析主视频，另 ${plan.additionalVideoCount} 个视频未分析`,
    )
  }

  if (plan.primaryVideoUrl) {
    const primaryInlineMaxBytes = Math.max(1, Math.floor(inlineMaxBytes * 0.7))
    try {
      const primary = await prepareMedia(plan.primaryVideoUrl, 'video', {
        ...options,
        inlineMaxBytes: primaryInlineMaxBytes,
        transcodeTargetBytes: Math.max(
          1,
          Math.min(
            transcodeTargetBytes,
            Math.floor(primaryInlineMaxBytes * 0.8),
          ),
        ),
        downloadMaxBytes,
        maxKeyframes: Math.min(
          options.maxKeyframes ??
            (plan.hasExplicitTypes && plan.supplementalImageUrls.length > 0
              ? MIXED_MEDIA_KEYFRAME_CAP
              : MAX_ADAPTIVE_KEYFRAMES),
          plan.hasExplicitTypes && plan.supplementalImageUrls.length > 0
            ? MIXED_MEDIA_KEYFRAME_CAP
            : MAX_ADAPTIVE_KEYFRAMES,
        ),
      })
      cleanups.push(primary.cleanup)
      durationSeconds = primary.durationSeconds
      primaryAudioTrackRemoved = primary.audioTrackRemoved
      primarySourceAudioTrack = primary.sourceAudioTrack ?? 'unknown'
      primaryAudioInputProvenance = primary.audioInputProvenance ?? 'unknown'
      warnings.push(...primary.warnings)
      const fittedPrimary = fitMediaPartsToBase64Budget(
        primary.parts,
        maxBase64Bytes,
      )
      combinedParts = fittedPrimary.parts
      primaryMediaPrepared = fittedPrimary.parts.some((part) => 'inlineData' in part)
      if (fittedPrimary.droppedInlineParts > 0) {
        warnings.push(
          `主视频证据超过单次请求总预算，已跳过 ${fittedPrimary.droppedInlineParts} 个关键帧/媒体片段`,
        )
      }
    } catch (error) {
      warnings.push(
        `主视频读取失败，继续分析静态图片：${error instanceof Error ? error.message : '未知错误'}`,
      )
    }
  }

  if (plan.supplementalImageUrls.length > 0) {
    const usedBase64Bytes = inlinePayloadBytes(combinedParts)
    const remainingBase64Bytes = Math.max(0, maxBase64Bytes - usedBase64Bytes)
    const remainingRawBytes = Math.floor((remainingBase64Bytes * 3) / 4)
    if (remainingRawBytes <= 0) {
      warnings.push(
        `混合素材中的 ${plan.supplementalImageUrls.length} 张补充图片因单次请求总预算不足而未分析`,
      )
    } else {
      try {
        const supplemental = await prepareMedia(
          plan.supplementalImageUrls,
          'carousel',
          {
            ...options,
            inlineMaxBytes: remainingRawBytes,
            downloadMaxBytes: Math.min(downloadMaxBytes, remainingRawBytes),
          },
        )
        cleanups.push(supplemental.cleanup)
        combinedParts.push(...supplemental.parts)
        warnings.push(
          ...supplemental.warnings.map((warning) =>
            warning
              .replace(/^轮播/, '混合素材')
              .replace(
                '轮播条目不是图片文件',
                '检测到额外视频；受单次请求总预算限制，首阶段未分析该视频',
              ),
          ),
        )
      } catch (error) {
        warnings.push(
          `补充图片均无法读取：${error instanceof Error ? error.message : '未知错误'}`,
        )
      }
    }
  }

  const finalFit = fitMediaPartsToBase64Budget(combinedParts, maxBase64Bytes)
  if (finalFit.droppedInlineParts > 0) {
    warnings.push(
      `混合素材达到单次请求总预算，另 ${finalFit.droppedInlineParts} 个媒体片段未分析`,
    )
  }
  const parts = finalFit.parts
  const inlineParts = parts.filter(
    (part): part is InlineDataPart => 'inlineData' in part,
  )
  const hasInlineVideo = inlineParts.some((part) =>
    part.inlineData.mimeType.startsWith('video/'),
  )
  const hasAudio = inlineParts.some((part) =>
    part.inlineData.mimeType.startsWith('audio/'),
  )
  const visualImageCount = inlineParts.filter((part) =>
    part.inlineData.mimeType.startsWith('image/'),
  ).length
  const keyframeCount = timestampedKeyframeCount(parts)
  const mode: PreparedMediaMode = hasInlineVideo
    ? visualImageCount > 0
      ? 'video_inline_keyframes'
      : 'video_inline'
    : visualImageCount > 0
      ? primaryMediaPrepared
        ? hasAudio
          ? 'video_frames_audio'
          : 'video_frames'
        : 'image_inline'
      : hasAudio
        ? 'video_audio'
      : 'text_only'
  const audioInputProvenance: AudioInputProvenance = hasAudio
    ? 'separate_audio'
    : hasInlineVideo
      ? primarySourceAudioTrack === 'absent' || primaryAudioTrackRemoved === true
        ? 'none'
        : primaryAudioInputProvenance === 'inline_video'
          ? 'inline_video'
          : primaryAudioInputProvenance === 'unknown'
            ? 'unknown'
            : 'none'
      : 'none'

  return {
    parts,
    mode,
    keyframeCount,
    durationSeconds,
    sourceAudioTrack: primarySourceAudioTrack,
    audioInputProvenance,
    audioTrackRemoved: hasInlineVideo ? primaryAudioTrackRemoved : undefined,
    warnings:
      warnings.length > 0 || parts.length > 0
        ? warnings
        : ['没有可下载媒体，已使用文本证据分析'],
    cleanup: async () => {
      await Promise.allSettled(cleanups.map((cleanup) => cleanup()))
    },
  }
}

export async function prepareMedia(
  mediaUrl: PrepareMediaInput,
  mediaKind: SourceMediaKind,
  options: PrepareMediaOptions = {},
): Promise<PreparedMedia> {
  if (mediaKind === 'mixed') return prepareMixedMedia(mediaUrl, options)
  const dir = await mkdtemp(join(tmpdir(), 'portfolio-analysis-'))
  const cleanup = () => rm(dir, { recursive: true, force: true })
  const source = sourceRecord(mediaUrl)
  const legacyUrls = legacyMediaUrls(mediaUrl)
  const mediaUrls =
    legacyUrls.length > 0
      ? legacyUrls
      : mediaKind === 'video'
        ? uniqueMediaUrls(source?.videoUrls ?? [])
        : uniqueMediaUrls(source?.imageUrls ?? [])
  if (mediaUrls.length === 0 || mediaKind === 'text') {
    return {
      parts: [],
      mode: 'text_only',
      keyframeCount: 0,
      sourceAudioTrack: mediaKind === 'video' ? 'unknown' : 'not_applicable',
      audioInputProvenance: 'none',
      warnings: ['没有可下载媒体，已使用文本证据分析'],
      cleanup,
    }
  }

  const inlineMaxBytes =
    options.inlineMaxBytes ??
    numberFromEnv('GEMINI_INLINE_VIDEO_MAX_BYTES', DEFAULT_INLINE_MAX_BYTES)
  const transcodeTargetBytes =
    options.transcodeTargetBytes ??
    numberFromEnv(
      'GEMINI_TRANSCODE_TARGET_BYTES',
      DEFAULT_TRANSCODE_TARGET_BYTES,
    )
  const downloadMaxBytes =
    options.downloadMaxBytes ??
    numberFromEnv('MULTIMODAL_DOWNLOAD_MAX_BYTES', DEFAULT_DOWNLOAD_MAX_BYTES)
  const maxBase64Bytes = Math.ceil((inlineMaxBytes * 4) / 3) + 4
  const ffmpegBin = options.ffmpegBin ?? process.env.FFMPEG_BIN ?? 'ffmpeg'
  const ffprobeBin = options.ffprobeBin ?? process.env.FFPROBE_BIN ?? 'ffprobe'

  try {
    if (mediaKind === 'carousel') {
      const parts: GeminiMediaPart[] = []
      const warnings: string[] = []
      const selected = mediaUrls.slice(0, 6)
      // A carousel is one Gemini request: budgets are cumulative, not per URL.
      const rawBudgetBytes = Math.min(downloadMaxBytes, inlineMaxBytes)
      const base64BudgetBytes = Math.ceil((inlineMaxBytes * 4) / 3) + 4
      let rawBytes = 0
      let base64Bytes = 0
      for (let index = 0; index < selected.length; index += 1) {
        try {
          const remainingRawBytes = rawBudgetBytes - rawBytes
          if (remainingRawBytes <= 0) {
            warnings.push('轮播图片已达到总原始字节预算，剩余图片未读取')
            break
          }
          const image = await downloadRemoteMedia(
            selected[index],
            dir,
            remainingRawBytes,
            `carousel-${index + 1}`,
            options.allowClashFakeIp,
          )
          if (image.kind !== 'image') throw new Error('轮播条目不是图片文件')
          await captureDownloadedMedia(
            options,
            image,
            `carousel-${index + 1}`,
            warnings,
          )
          const data = (await readFile(image.path)).toString('base64')
          const encodedBytes = Buffer.byteLength(data, 'ascii')
          const fitsBudget = fitsCumulativeInlineBudget(
            rawBytes,
            base64Bytes,
            image.byteLength,
            encodedBytes,
            rawBudgetBytes,
            base64BudgetBytes,
          )
          rawBytes += image.byteLength
          if (!fitsBudget) {
            warnings.push(`轮播第 ${index + 1} 张超过总 base64 预算，已跳过`)
            continue
          }
          base64Bytes += encodedBytes
          parts.push({ text: `轮播图片 ${index + 1} / ${selected.length}` })
          parts.push({
            inlineData: {
              mimeType: imageMime(image.mimeType, image.path),
              data,
            },
          })
        } catch (error) {
          warnings.push(
            `轮播第 ${index + 1} 张读取失败：${error instanceof Error ? error.message : '未知错误'}`,
          )
        }
      }
      if (mediaUrls.length > selected.length) {
        warnings.push(`轮播共 ${mediaUrls.length} 张，首阶段最多分析前 ${selected.length} 张`)
      }
      if (parts.length === 0) throw new Error('轮播图片均无法读取')
      return {
        parts,
        mode: 'image_inline',
        keyframeCount: parts.filter((part) => 'inlineData' in part).length,
        sourceAudioTrack: 'not_applicable',
        audioInputProvenance: 'none',
        warnings,
        cleanup,
      }
    }

    const candidateWarnings: string[] = []
    let downloaded: Awaited<ReturnType<typeof downloadRemoteMedia>> | undefined
    for (let index = 0; index < Math.min(mediaUrls.length, 3); index += 1) {
      try {
        const candidate = await downloadRemoteMedia(
          mediaUrls[index],
          dir,
          mediaKind === 'image'
            ? Math.min(downloadMaxBytes, 12 * 1024 * 1024)
            : downloadMaxBytes,
          `source-${index + 1}`,
          options.allowClashFakeIp,
        )
        if (mediaKind === 'image' && candidate.kind !== 'image') {
          throw new Error('图片素材 URL 实际返回了视频')
        }
        if (mediaKind === 'video' && candidate.kind !== 'video') {
          throw new Error('视频素材 URL 实际返回了图片')
        }
        downloaded = candidate
        break
      } catch (error) {
        candidateWarnings.push(
          `素材候选 ${index + 1} 读取失败：${error instanceof Error ? error.message : '未知错误'}`,
        )
      }
    }
    if (!downloaded) throw new Error(candidateWarnings.join('；') || '媒体读取失败')
    await captureDownloadedMedia(
      options,
      downloaded,
      downloaded.kind === 'video' ? 'original-video' : 'original-image',
      candidateWarnings,
    )
    if (downloaded.kind === 'image') {
      return {
        parts: [
          {
            inlineData: {
              mimeType: imageMime(downloaded.mimeType, downloaded.path),
              data: (await readFile(downloaded.path)).toString('base64'),
            },
          },
        ],
        mode: 'image_inline',
        keyframeCount: 1,
        sourceAudioTrack: 'not_applicable',
        audioInputProvenance: 'none',
        warnings: candidateWarnings,
        cleanup,
      }
    }

    const warnings: string[] = [...candidateWarnings]
    const ffmpegReady = await commandExists(ffmpegBin)
    const ffprobeReady = await commandExists(ffprobeBin)
    const sourceMediaInfo = ffprobeReady
      ? await probeMediaInfo(downloaded.path, ffprobeBin)
      : { sourceAudioTrack: 'unknown' as const }
    const durationSeconds = sourceMediaInfo.durationSeconds
    const sourceAudioTrack = sourceMediaInfo.sourceAudioTrack
    if (sourceAudioTrack === 'present') {
      warnings.push('已确认源视频包含音轨。')
    } else if (sourceAudioTrack === 'absent') {
      warnings.push('已确认源视频没有音轨，将按真实静音素材处理。')
    } else {
      warnings.push('无法确认源视频是否包含音轨。')
    }
    let frames: Array<{ timestamp: number; data: string }> = []
    const targetKeyframeCount = adaptiveKeyframeCount(
      durationSeconds,
      options.maxKeyframes,
    )
    if (ffmpegReady && durationSeconds && targetKeyframeCount > 0) {
      const cuts = await detectSceneCuts(downloaded.path, ffmpegBin)
      const timestamps = selectEvidenceTimestamps(
        durationSeconds,
        cuts,
        targetKeyframeCount,
      )
      frames = await extractKeyframes(
        downloaded.path,
        dir,
        timestamps,
        ffmpegBin,
      )
    } else if (targetKeyframeCount > 0) {
      warnings.push('FFmpeg/ffprobe 不可用或时长未知，未生成关键帧')
    }

    let inlinePath = downloaded.path
    let inlineMimeType = downloaded.mimeType
    let audioTrackRemoved: boolean | undefined
    if (options.stripAudioTrack && ffmpegReady) {
      const visualOnly = join(dir, 'visual-only.mp4')
      const stripped =
        (await removeVideoAudioTrack(downloaded.path, visualOnly, ffmpegBin)) ||
        (await transcodeVideo(
          downloaded.path,
          visualOnly,
          durationSeconds ?? 12,
          transcodeTargetBytes,
          ffmpegBin,
          false,
        ))
      if (stripped) {
        inlinePath = visualOnly
        inlineMimeType = 'video/mp4'
        audioTrackRemoved = true
        warnings.push('已为视觉模型生成无音轨视频。')
      } else {
        audioTrackRemoved = false
        warnings.push('无法确认已移除视频音轨；视觉模型将仅使用关键帧。')
      }
    } else if (options.stripAudioTrack) {
      audioTrackRemoved = false
      warnings.push('FFmpeg 不可用，无法生成无音轨视频；视觉模型将仅使用关键帧。')
    }
    if ((await stat(inlinePath)).size > inlineMaxBytes && ffmpegReady) {
      const transcoded = join(dir, 'transcoded.mp4')
      const ok = await transcodeVideo(
        downloaded.path,
        transcoded,
        durationSeconds ?? 12,
        transcodeTargetBytes,
        ffmpegBin,
        !options.stripAudioTrack,
      )
      if (ok) {
        inlinePath = transcoded
        inlineMimeType = 'video/mp4'
        if (options.stripAudioTrack) audioTrackRemoved = true
      }
      else {
        warnings.push(
          options.stripAudioTrack
            ? '无音轨视频压缩失败，视觉模型将仅使用关键帧'
            : '视频压缩失败，尝试使用关键帧与独立音频',
        )
      }
    }

    let inlineSize = (await stat(inlinePath)).size
    const frameBase64Bytes = frames.reduce(
      (total, frame) => total + Buffer.byteLength(frame.data, 'ascii'),
      0,
    )
    const inlineBase64Bytes = 4 * Math.ceil(inlineSize / 3)
    if (
      inlineSize <= inlineMaxBytes &&
      frames.length > 0 &&
      inlineBase64Bytes + frameBase64Bytes > maxBase64Bytes &&
      ffmpegReady
    ) {
      // Keyframes supplement the complete video; never sacrifice nearly the
      // entire video budget to unusually large JPEGs. The final uniform trim
      // below decides which frames fit inside this bounded reserve.
      const reservedFrameBase64Bytes = Math.min(
        frameBase64Bytes,
        Math.floor(maxBase64Bytes * 0.25),
      )
      const availableVideoBase64Bytes =
        maxBase64Bytes - reservedFrameBase64Bytes
      const budgetedTargetBytes = Math.max(
        256 * 1024,
        Math.min(
          transcodeTargetBytes,
          Math.floor((availableVideoBase64Bytes * 3 * 0.94) / 4),
        ),
      )
      if (budgetedTargetBytes < inlineSize) {
        const budgetedVideo = join(dir, 'budgeted.mp4')
        const budgeted = await transcodeVideo(
          downloaded.path,
          budgetedVideo,
          durationSeconds ?? 12,
          budgetedTargetBytes,
          ffmpegBin,
          !options.stripAudioTrack,
        )
        if (budgeted) {
          const budgetedSize = (await stat(budgetedVideo)).size
          if (budgetedSize < inlineSize && budgetedSize <= inlineMaxBytes) {
            inlinePath = budgetedVideo
            inlineMimeType = 'video/mp4'
            inlineSize = budgetedSize
            if (options.stripAudioTrack) audioTrackRemoved = true
            warnings.push('已压缩完整视频，为全时间轴关键帧预留请求预算。')
          }
        }
      }
    }

    const parts: GeminiMediaPart[] = []
    let hasInlineVideo = false
    let hasAudio = false
    let inlineAudioTrack: Exclude<SourceAudioTrackStatus, 'not_applicable'> =
      'unknown'
    if (inlineSize <= inlineMaxBytes) {
      parts.push({
        inlineData: {
          mimeType: inlineMimeType,
          data: (await readFile(inlinePath)).toString('base64'),
        },
      })
      hasInlineVideo = true
      if (options.stripAudioTrack && audioTrackRemoved === true) {
        inlineAudioTrack = 'absent'
      } else if (ffprobeReady) {
        inlineAudioTrack = (await probeMediaInfo(inlinePath, ffprobeBin)).sourceAudioTrack
      }
      if (
        !options.stripAudioTrack &&
        sourceAudioTrack === 'present' &&
        inlineAudioTrack !== 'present'
      ) {
        const audio = await extractAudio(
          downloaded.path,
          join(dir, 'inline-fallback-audio.mp3'),
          ffmpegBin,
        )
        if (
          audio &&
          inlinePayloadBytes(parts) + Buffer.byteLength(audio, 'ascii') <=
            maxBase64Bytes
        ) {
          parts.push({ inlineData: { mimeType: 'audio/mpeg', data: audio } })
          hasAudio = true
          warnings.push('完整视频音轨未能验证，已额外附加独立音轨。')
        } else {
          warnings.push('源视频含音轨，但最终 inline 视频未能验证音轨且独立音轨附加失败。')
        }
      }
    } else if (ffmpegReady && !options.stripAudioTrack) {
      const audio = await extractAudio(downloaded.path, join(dir, 'audio.mp3'), ffmpegBin)
      if (audio) {
        if (Buffer.byteLength(audio, 'ascii') <= maxBase64Bytes) {
          parts.push({ inlineData: { mimeType: 'audio/mpeg', data: audio } })
          hasAudio = true
        } else {
          warnings.push('独立音轨超过单次请求总预算，已跳过音轨以保留全时间轴画面证据')
        }
      }
      warnings.push('视频超过 inline 预算，已退化为关键帧' + (hasAudio ? ' + 音频' : ''))
    } else {
      warnings.push('视频超过 inline 预算且无法抽帧，模型只会看到文本证据')
    }

    const budgetedFrames = fitKeyframesToBase64Budget(
      frames,
      inlinePayloadBytes(parts),
      maxBase64Bytes,
    )
    if (budgetedFrames.length < frames.length) {
      warnings.push(
        `关键帧超过单次请求总预算，已按全时间轴从 ${frames.length} 张均匀保留 ${budgetedFrames.length} 张`,
      )
    }
    for (const frame of budgetedFrames) {
      parts.push({ text: `关键帧时间：${frame.timestamp.toFixed(2)} 秒` })
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: frame.data },
      })
    }

    const mode: PreparedMediaMode = hasInlineVideo
      ? budgetedFrames.length > 0
        ? 'video_inline_keyframes'
        : 'video_inline'
      : budgetedFrames.length > 0
        ? hasAudio
          ? 'video_frames_audio'
          : 'video_frames'
        : hasAudio
          ? 'video_audio'
          : 'text_only'
    const audioInputProvenance: AudioInputProvenance = hasAudio
      ? 'separate_audio'
      : hasInlineVideo
        ? sourceAudioTrack === 'absent' || inlineAudioTrack === 'absent'
          ? 'none'
          : inlineAudioTrack === 'present'
            ? 'inline_video'
            : 'unknown'
        : 'none'
    return {
      parts,
      mode,
      keyframeCount: budgetedFrames.length,
      durationSeconds,
      sourceAudioTrack,
      audioInputProvenance,
      audioTrackRemoved: hasInlineVideo ? audioTrackRemoved : undefined,
      warnings,
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
