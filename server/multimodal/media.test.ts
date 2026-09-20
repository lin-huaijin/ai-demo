import { describe, expect, it } from 'vitest'
import {
  adaptiveKeyframeCount,
  assertSafeRemoteUrl,
  classifyMediaPayload,
  fitMediaPartsToBase64Budget,
  fitKeyframesToBase64Budget,
  fitsCumulativeInlineBudget,
  isAllowedResolvedAddress,
  isPublicIpAddress,
  planMixedMediaSources,
  parseFfprobeMediaInfo,
  selectEvidenceTimestamps,
  selectUniformKeyframeSubset,
  targetVideoBitrateKbps,
} from './media.ts'

describe('multimodal media preparation', () => {
  it('distinguishes source audio streams from truly silent video containers', () => {
    expect(
      parseFfprobeMediaInfo(
        JSON.stringify({
          streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
          format: { duration: '34.7' },
        }),
      ),
    ).toEqual({ durationSeconds: 34.7, sourceAudioTrack: 'present' })
    expect(
      parseFfprobeMediaInfo(
        JSON.stringify({
          streams: [{ codec_type: 'video' }],
          format: { duration: 8 },
        }),
      ),
    ).toEqual({ durationSeconds: 8, sourceAudioTrack: 'absent' })
    expect(parseFfprobeMediaInfo('not-json')).toEqual({
      sourceAudioTrack: 'unknown',
    })
  })

  it('prioritizes scene boundaries and fills the remaining frame budget', () => {
    const timestamps = selectEvidenceTimestamps(10, [2, 7], 5)

    expect(timestamps).toHaveLength(5)
    expect(timestamps.some((value) => Math.abs(value - 2) < 0.1)).toBe(true)
    expect(timestamps.some((value) => Math.abs(value - 7) < 0.1)).toBe(true)
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b))
    expect(new Set(timestamps).size).toBe(timestamps.length)
  })

  it('scales keyframes with duration while preserving explicit hard caps', () => {
    expect(adaptiveKeyframeCount(undefined)).toBe(8)
    expect(adaptiveKeyframeCount(12)).toBe(8)
    expect(adaptiveKeyframeCount(30)).toBe(8)
    expect(adaptiveKeyframeCount(30.01)).toBe(10)
    expect(adaptiveKeyframeCount(60.01)).toBe(12)
    expect(adaptiveKeyframeCount(90.01)).toBe(16)
    expect(adaptiveKeyframeCount(120.01)).toBe(20)
    expect(adaptiveKeyframeCount(180.01)).toBe(24)
    expect(adaptiveKeyframeCount(900)).toBe(24)
    expect(adaptiveKeyframeCount(130, 6)).toBe(6)
    expect(adaptiveKeyframeCount(130, 0)).toBe(0)
    expect(adaptiveKeyframeCount(130, 99)).toBe(20)
  })

  it('keeps start, hook, ending and full-timeline buckets despite dense early cuts', () => {
    const timestamps = selectEvidenceTimestamps(
      130,
      [1, 1.4, 1.8, 2.2, 2.6, 3, 3.4, 4, 4.5, 45, 82, 110],
      20,
    )

    expect(timestamps).toHaveLength(20)
    expect(timestamps[0]).toBeLessThanOrEqual(0.2)
    expect(timestamps.some((value) => value >= 1 && value <= 3)).toBe(true)
    expect(timestamps.at(-1)).toBeGreaterThanOrEqual(129.8)
    for (let start = 0; start < 130; start += 26) {
      expect(
        timestamps.some((value) => value >= start && value <= start + 26),
      ).toBe(true)
    }
    const gaps = timestamps.slice(1).map((value, index) => value - timestamps[index])
    expect(Math.max(...gaps)).toBeLessThan(16)
  })

  it('uniformly thins keyframes without deleting the end of the timeline', () => {
    const frames = [0.2, 1.5, 10, 20, 30, 40, 50, 59.8].map((timestamp) => ({
      timestamp,
      data: 'x'.repeat(10),
    }))

    const subset = selectUniformKeyframeSubset(frames, 4)
    expect(subset.map(({ timestamp }) => timestamp)).toEqual([0.2, 1.5, 30, 59.8])

    const fitted = fitKeyframesToBase64Budget(frames, 60, 100)
    expect(fitted).toHaveLength(4)
    expect(fitted[0].timestamp).toBe(0.2)
    expect(fitted.some(({ timestamp }) => timestamp === 1.5)).toBe(true)
    expect(fitted.at(-1)?.timestamp).toBe(59.8)
  })

  it('never produces an unusably tiny target video bitrate', () => {
    expect(targetVideoBitrateKbps(11 * 1024 * 1024, 20)).toBeGreaterThan(300)
    expect(targetVideoBitrateKbps(1024, 300)).toBe(300)
  })

  it('blocks local and private network media URLs before download', async () => {
    await expect(assertSafeRemoteUrl('http://127.0.0.1/video.mp4')).rejects.toThrow(
      /内网/,
    )
    await expect(assertSafeRemoteUrl('http://localhost/video.mp4')).rejects.toThrow(
      /本机/,
    )
    await expect(assertSafeRemoteUrl('file:///etc/passwd')).rejects.toThrow(
      /http\/https/,
    )
    await expect(
      assertSafeRemoteUrl('http://[::ffff:127.0.0.1]/video.mp4'),
    ).rejects.toThrow(/非公网|内网/)
    await expect(
      assertSafeRemoteUrl('http://[2001:db8::1]/video.mp4'),
    ).rejects.toThrow(/非公网|内网/)
    await expect(
      assertSafeRemoteUrl('https://8.8.8.8/playlist.m3u8'),
    ).rejects.toThrow(/HLS|DASH|concat/)
  })

  it('accepts only globally routable literal IP addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true)
    expect(isPublicIpAddress('127.0.0.1')).toBe(false)
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicIpAddress('::ffff:8.8.8.8')).toBe(false)
    expect(isPublicIpAddress('fc00::1')).toBe(false)
    expect(isPublicIpAddress('fe80::1')).toBe(false)
    expect(isPublicIpAddress('2001::1')).toBe(false)
    expect(isPublicIpAddress('2001:db8::1')).toBe(false)
    expect(isPublicIpAddress('2002:7f00:1::')).toBe(false)
    expect(isPublicIpAddress('3ffe::1')).toBe(false)
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('allows Clash Fake-IP only behind an explicit DNS-result opt-in', () => {
    expect(isAllowedResolvedAddress('198.18.1.8')).toBe(false)
    expect(isAllowedResolvedAddress('198.18.1.8', true)).toBe(true)
    expect(isAllowedResolvedAddress('198.19.255.254', true)).toBe(true)
    expect(isAllowedResolvedAddress('192.168.1.8', true)).toBe(false)
    expect(isAllowedResolvedAddress('127.0.0.1', true)).toBe(false)
  })

  it('rejects manifests and HTML even when the server claims binary media', () => {
    for (const payload of [
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000',
      '<?xml version="1.0"?><MPD type="static"></MPD>',
      'ffconcat version 1.0\nfile file:///etc/passwd',
      '<!doctype html><html><body>login</body></html>',
    ]) {
      expect(() =>
        classifyMediaPayload(Buffer.from(payload), 'application/octet-stream'),
      ).toThrow(/HLS|DASH|concat|HTML/)
    }
  })

  it('uses file signatures so video cannot be mislabeled as JPEG', () => {
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.alloc(16),
    ])
    expect(classifyMediaPayload(mp4, 'image/jpeg')).toEqual({
      kind: 'video',
      mimeType: 'video/mp4',
    })
    expect(
      classifyMediaPayload(Buffer.from([0xff, 0xd8, 0xff, 0xdb]), 'video/mp4'),
    ).toEqual({ kind: 'image', mimeType: 'image/jpeg' })
    expect(() =>
      classifyMediaPayload(Buffer.from('not a media file'), 'application/octet-stream'),
    ).toThrow(/无法确认/)
  })

  it('applies carousel raw and base64 limits cumulatively', () => {
    expect(fitsCumulativeInlineBudget(4, 8, 5, 7, 10, 16)).toBe(true)
    expect(fitsCumulativeInlineBudget(6, 8, 5, 7, 10, 16)).toBe(false)
    expect(fitsCumulativeInlineBudget(4, 10, 5, 7, 10, 16)).toBe(false)
  })

  it('plans one primary video plus stills and reports every extra video', () => {
    const plan = planMixedMediaSources({
      videoUrls: [
        'https://cdn.example/one.mp4',
        'https://cdn.example/two.mp4',
        'https://cdn.example/three.mp4',
      ],
      imageUrls: [
        'https://cdn.example/one.jpg',
        'https://cdn.example/two.jpg',
      ],
    })

    expect(plan).toEqual({
      primaryVideoUrl: 'https://cdn.example/one.mp4',
      supplementalImageUrls: [
        'https://cdn.example/one.jpg',
        'https://cdn.example/two.jpg',
      ],
      additionalVideoCount: 2,
      hasExplicitTypes: true,
    })
  })

  it('keeps label and payload pairs together when the request-wide budget is full', () => {
    const result = fitMediaPartsToBase64Budget(
      [
        { text: '图片 1' },
        { inlineData: { mimeType: 'image/jpeg', data: 'aaaa' } },
        { text: '图片 2' },
        { inlineData: { mimeType: 'image/jpeg', data: 'bbbb' } },
      ],
      4,
    )

    expect(result.parts).toEqual([
      { text: '图片 1' },
      { inlineData: { mimeType: 'image/jpeg', data: 'aaaa' } },
    ])
    expect(result.droppedInlineParts).toBe(1)
  })
})
