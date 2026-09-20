import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ArtifactNotFoundError,
  ArtifactValidationError,
  createArtifactAssetId,
  createLocalArtifactStore,
  sanitizeArtifactJson,
  validateArtifactId,
} from './store.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function testStore(projectId = 'campaign-demo') {
  const rootDir = await mkdtemp(join(tmpdir(), 'intent-artifacts-test-'))
  temporaryRoots.push(rootDir)
  let counter = 0
  const store = createLocalArtifactStore({
    rootDir,
    projectId,
    now: () => new Date('2026-07-21T10:20:30.000Z'),
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  })
  return { rootDir, store }
}

describe('local artifact store identifiers', () => {
  it('creates a stable asset ID from a normalized source URL', () => {
    const first = createArtifactAssetId({
      sourceUrl:
        'HTTPS://www.TikTok.com/@demo/video/123/?sender_device=pc&utm_source=test#section',
      mediaUrl: 'https://cdn.example/video.mp4?expires=1',
    })
    const second = createArtifactAssetId({
      sourceUrl: 'https://www.tiktok.com/@demo/video/123',
      mediaUrl: 'https://other.example/fallback.mp4',
    })
    expect(first).toBe(second)
    expect(first).toMatch(/^asset_[a-f0-9]{24}$/)

    expect(
      createArtifactAssetId({
        mediaUrl: 'https://cdn.example/video.mp4?expires=1&signature=one',
      }),
    ).toBe(
      createArtifactAssetId({
        mediaUrl: 'https://cdn.example/video.mp4?expires=2&signature=two',
      }),
    )
  })

  it('strictly rejects traversal and malformed IDs', () => {
    expect(() => validateArtifactId('projectId', '../outside')).toThrow(
      ArtifactValidationError,
    )
    expect(() => validateArtifactId('assetId', 'asset/child')).toThrow(
      ArtifactValidationError,
    )
    expect(() => validateArtifactId('runId', '.')).toThrow(
      ArtifactValidationError,
    )
  })
})

describe('local artifact store lifecycle', () => {
  it('preserves allowlisted identity parameters while removing tracking data', async () => {
    const { store } = await testStore('youtube-project')
    const reference = await store.beginRun({
      sourceUrl:
        'https://www.youtube.com/watch?v=video-id&utm_source=tracking&token=secret',
    })
    const asset = await store.readAssetManifest(
      reference.projectId,
      reference.assetId,
    )
    expect(asset.source.canonicalUrl).toBe(
      'https://www.youtube.com/watch?v=video-id',
    )
  })

  it('keeps every asset when the first project runs start concurrently', async () => {
    const { store } = await testStore('parallel-project')
    const [first, second] = await Promise.all([
      store.beginRun({ sourceUrl: 'https://example.com/video/first' }),
      store.beginRun({ sourceUrl: 'https://example.com/video/second' }),
    ])
    const assets = await store.listAssets()
    expect(assets.map((asset) => asset.assetId).sort()).toEqual(
      [first.assetId, second.assetId].sort(),
    )
  })

  it('persists pending, media, complete analysis and workflow by project/asset/run', async () => {
    const { rootDir, store } = await testStore()
    const reference = await store.beginRun({
      sourceUrl:
        'https://www.tiktok.com/@demo/video/123?sender_device=pc&access_token=do-not-store',
      title: '测试素材',
      platform: 'tiktok',
      requestedModel: 'gemini-3.1-pro',
      metadata: {
        apiKey: 'sk-this-must-not-be-stored-123456',
        headers: { Authorization: 'Bearer also-secret' },
        safe: 'kept',
      },
    })

    expect(reference).toMatchObject({
      projectId: 'campaign-demo',
      status: 'pending',
    })
    expect(reference.assetId).toMatch(/^asset_/)
    expect(reference.runId).toMatch(/^run_/)
    const pending = await store.readRunManifest(reference)
    expect(pending.status).toBe('pending')
    expect(pending.requestMetadata).toEqual({
      apiKey: '[redacted]',
      headers: '[redacted]',
      safe: 'kept',
    })
    expect(pending.source.canonicalUrl).not.toContain('access_token')

    const downloaded = join(rootDir, 'downloaded-video.mp4')
    await writeFile(downloaded, Buffer.from('original video bytes'))
    const sourceRecord = await store.copyDownloadedMedia(reference, {
      filePath: downloaded,
      originalName: 'source-video.mp4',
      mimeType: 'video/mp4',
      sourceUrl: 'https://signed.example/video.mp4?token=secret',
      role: 'original-video',
    })
    expect(sourceRecord.path).toMatch(
      /^source\/media\/original-video-[a-f0-9]{12}\.mp4$/,
    )
    await expect(
      stat(
        join(
          rootDir,
          'projects',
          reference.projectId,
          'sources',
          reference.assetId,
          ...sourceRecord.path.split('/'),
        ),
      ),
    ).resolves.toMatchObject({ size: 20 })

    const videoBase64 = Buffer.from('analysis video').toString('base64')
    const imageBase64 = Buffer.from('jpeg keyframe').toString('base64')
    const audioBase64 = Buffer.from('analysis audio').toString('base64')
    await store.persistPreparedMedia(reference, {
      mode: 'video_inline_keyframes',
      durationSeconds: 12.5,
      keyframeCount: 1,
      sourceAudioTrack: 'present',
      audioInputProvenance: 'separate_audio',
      audioTrackRemoved: false,
      warnings: [],
      parts: [
        { inlineData: { mimeType: 'video/mp4', data: videoBase64 } },
        { text: '关键帧时间：1.250s' },
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        { inlineData: { mimeType: 'audio/mpeg', data: audioBase64 } },
      ],
    })

    const largeInline = Buffer.alloc(900, 7).toString('base64')
    const completed = await store.completeRun(reference, {
      analysis: {
        summary: '完整分析',
        mm01: { module: 'MM01' },
        contextResearch: { module: 'C01' },
        p02Handoff: { module: 'P02F' },
        p02: { theme: 'test' },
        api_key: 'test-placeholder-key',
        authorization: 'Bearer test-token',
        inlineData: largeInline,
      },
      reportedModel: 'gemini-3.1-pro',
      usage: { inputTokens: 321, outputTokens: 123 },
    })
    expect(completed.status).toBe('complete')
    await store.saveWorkflowSnapshot(reference, {
      p01: { status: 'complete' },
      p02: { prompt: '可回查的提示词快照' },
      promptChain: [
        {
          id: 'P01',
          active: true,
          prompt: 'P01 source https://cdn.example/video.mp4?token=secret&expires=1',
        },
        { id: 'MM01', active: true, prompt: 'MM01 prompt' },
        { id: 'C01', active: true, prompt: 'C01 prompt' },
        { id: 'P02F', active: true, prompt: 'P02F prompt' },
        { id: 'P02', active: true, prompt: 'P02 prompt' },
        { id: '../escape', active: true, prompt: 'must not write' },
      ],
      breakdown: { core: 'local result' },
      sourceUrl: 'https://example.com/watch?v=source&utm_source=track',
      thumbnailUrl: 'https://cdn.example/thumb.jpg?token=secret&vendor=custom',
      landingUrl: 'https://landing.example/path?campaign=private',
      apiKey: 'sk-workflow-secret-123456789',
      settings: {
        geminiApiKey: 'opaque-gemini-value',
        downstreamApiKey: 'opaque-downstream-value',
        scrapeCreatorsApiKey: 'opaque-scrape-value',
        foreplayApiKey: 'opaque-foreplay-value',
        teamAccessToken: 'opaque-team-value',
        intentShortsBridgeToken: 'opaque-bridge-value',
        usage: { inputTokens: 42, outputTokens: 9, totalTokens: 51 },
      },
    })

    const run = await store.readRunManifest(reference)
    expect(run.status).toBe('complete')
    expect(run.reportedModel).toBe('gemini-3.1-pro')
    expect(run.usage).toEqual({ inputTokens: 321, outputTokens: 123 })
    expect(run.files.map((file) => file.kind)).toEqual(
      expect.arrayContaining([
        'original-video',
        'analysis-video',
        'keyframe',
        'analysis-audio',
        'media-metadata',
        'analysis',
        'workflow-snapshot',
        'stage-mm01',
        'stage-c01',
        'stage-p02f',
        'stage-p02',
        'prompt-p01',
        'local-breakdown',
      ]),
    )

    const exportBundle = await store.exportRun(reference)
    expect(exportBundle.reference.status).toBe('complete')
    expect(exportBundle.project).not.toHaveProperty('assets')
    expect(exportBundle.analysis).toEqual({
      summary: '完整分析',
      mm01: { module: 'MM01' },
      contextResearch: { module: 'C01' },
      p02Handoff: { module: 'P02F' },
      p02: { theme: 'test' },
      api_key: '[redacted]',
      authorization: '[redacted]',
      inlineData: '[omitted inline binary]',
    })
    expect(exportBundle.workflow).toEqual({
      p01: { status: 'complete' },
      p02: { prompt: '可回查的提示词快照' },
      promptChain: [
        {
          id: 'P01',
          active: true,
          prompt: 'P01 source https://cdn.example/video.mp4',
        },
        { id: 'MM01', active: true, prompt: 'MM01 prompt' },
        { id: 'C01', active: true, prompt: 'C01 prompt' },
        { id: 'P02F', active: true, prompt: 'P02F prompt' },
        { id: 'P02', active: true, prompt: 'P02 prompt' },
        { id: '../escape', active: true, prompt: 'must not write' },
      ],
      breakdown: { core: 'local result' },
      sourceUrl: 'https://example.com/watch',
      thumbnailUrl: 'https://cdn.example/thumb.jpg',
      landingUrl: 'https://landing.example/path',
      apiKey: '[redacted]',
      settings: {
        geminiApiKey: '[redacted]',
        downstreamApiKey: '[redacted]',
        scrapeCreatorsApiKey: '[redacted]',
        foreplayApiKey: '[redacted]',
        teamAccessToken: '[redacted]',
        intentShortsBridgeToken: '[redacted]',
        usage: { inputTokens: 42, outputTokens: 9, totalTokens: 51 },
      },
    })
    const serialized = JSON.stringify(exportBundle)
    expect(serialized).not.toContain('sk-')
    for (const secret of [
      'opaque-gemini-value',
      'opaque-downstream-value',
      'opaque-scrape-value',
      'opaque-foreplay-value',
      'opaque-team-value',
      'opaque-bridge-value',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).not.toContain(largeInline)
    expect(serialized).not.toContain(videoBase64)

    const storedFiles = await store.listStoredFiles(reference)
    expect(storedFiles).toEqual(
      expect.arrayContaining([
        'analysis.json',
        'inputs/analysis-video-001.mp4',
        'inputs/analysis-audio-001.mp3',
        'keyframes/keyframe-001-1.250s.jpg',
        'manifest.json',
        'media.json',
        'prompts/P01.json',
        'prompts/MM01.json',
        'prompts/C01.json',
        'prompts/P02F.json',
        'prompts/P02.json',
        'stages/MM01.json',
        'stages/C01.json',
        'stages/P02F.json',
        'stages/P02.json',
        'stages/local-breakdown.json',
        'workflow.json',
      ]),
    )
    expect(storedFiles).not.toContain('prompts/../escape.json')
    expect(
      run.files
        .filter((file) => file.kind.startsWith('prompt-'))
        .map((file) => file.kind),
    ).toEqual([
      'prompt-p01',
      'prompt-mm01',
      'prompt-c01',
      'prompt-p02f',
      'prompt-p02',
    ])
    expect(
      run.files
        .filter(
          (file) =>
            file.kind.startsWith('stage-') &&
            !file.kind.startsWith('stage-local-'),
        )
        .map((file) => file.kind),
    ).toEqual(['stage-mm01', 'stage-c01', 'stage-p02f', 'stage-p02'])
    expect(
      (await store.readRunFile(reference, 'analysis.json')).toString('utf8'),
    ).toContain('完整分析')
    expect(
      JSON.parse(
        (await store.readRunFile(reference, 'stages/C01.json')).toString('utf8'),
      ),
    ).toEqual({ module: 'C01' })
    expect(
      JSON.parse(
        (await store.readRunFile(reference, 'media.json')).toString('utf8'),
      ),
    ).toMatchObject({
      sourceAudioTrack: 'present',
      audioInputProvenance: 'separate_audio',
    })
    await expect(store.readRunFile(reference, '../manifest.json')).rejects.toBeInstanceOf(
      ArtifactValidationError,
    )

    const assets = await store.listAssets()
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      assetId: reference.assetId,
      runCount: 1,
      latestRun: { status: 'complete' },
    })
  })

  it('keeps legacy analysis bundles readable without inventing a C01 stage', async () => {
    const { store } = await testStore('legacy-analysis-project')
    const reference = await store.beginRun({
      sourceUrl: 'https://example.com/video/legacy-analysis',
      requestedModel: 'gemini-3.1-pro',
    })

    const legacyAnalysis = {
      mm01: { module: 'MM01', legacy: true },
      p02Handoff: { module: 'P02F', legacy: true },
      p02: { theme: 'legacy' },
    }
    await store.completeRun(reference, { analysis: legacyAnalysis })

    const run = await store.readRunManifest(reference)
    expect(
      run.files
        .filter((file) => file.kind.startsWith('stage-'))
        .map((file) => file.kind),
    ).toEqual(['stage-mm01', 'stage-p02f', 'stage-p02'])
    expect(await store.exportRun(reference)).toMatchObject({
      analysis: legacyAnalysis,
    })
    await expect(
      store.readRunFile(reference, 'stages/C01.json'),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError)
    expect(await store.listStoredFiles(reference)).not.toContain(
      'stages/C01.json',
    )
  })

  it('records a failed run without leaking credentials', async () => {
    const { store } = await testStore('failure-project')
    const reference = await store.beginRun({
      mediaUrl: 'https://cdn.example/failure.mp4?signed=volatile',
      requestedModel: 'kimi-k3',
    })
    const bearerSecret = 'a'.repeat(16)
    const apiSecret = `sk-${'x'.repeat(20)}`
    const error = new Error(
      `upstream failed with Bearer ${bearerSecret} and ${apiSecret}`,
    ) as NodeJS.ErrnoException
    error.code = 'UPSTREAM_FAILED'
    const failed = await store.failRun(reference, error)
    expect(failed.status).toBe('failed')
    const run = await store.readRunManifest(reference)
    expect(run).toMatchObject({
      status: 'failed',
      error: { code: 'UPSTREAM_FAILED' },
    })
    expect(JSON.stringify(run)).not.toContain(bearerSecret)
    expect(JSON.stringify(run)).not.toContain(apiSecret)
    expect((await store.exportRun(reference)).error).toMatchObject({
      code: 'UPSTREAM_FAILED',
    })
  })

  it('does not allow arbitrary file reads or nonexistent records', async () => {
    const { store } = await testStore()
    const reference = await store.beginRun({
      sourceUrl: 'https://example.com/video/one',
    })
    await expect(store.readRunFile(reference, 'not-listed.txt')).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    )
    await expect(
      store.readAssetManifest(reference.projectId, '../escape'),
    ).rejects.toBeInstanceOf(ArtifactValidationError)
  })
})

describe('artifact JSON sanitization', () => {
  it('keeps token usage while redacting credentials, headers and circular values', () => {
    const circular: Record<string, unknown> = {
      usage: { inputTokens: 10, outputTokens: 5 },
      apiKey: 'secret',
      geminiApiKey: 'opaque-gemini-value',
      downstreamApiKey: 'opaque-downstream-value',
      scrapeCreatorsApiKey: 'opaque-scrape-value',
      foreplayApiKey: 'opaque-foreplay-value',
      teamAccessToken: 'opaque-team-value',
      intentShortsBridgeToken: 'opaque-bridge-value',
      headers: { authorization: 'Bearer secret' },
      text: 'safe',
      canonicalUrl: 'https://www.youtube.com/watch?v=video-id',
      prompt: 'source https://signed.example/video.mp4?token=secret',
    }
    circular.circular = circular
    expect(sanitizeArtifactJson(circular)).toEqual({
      usage: { inputTokens: 10, outputTokens: 5 },
      apiKey: '[redacted]',
      geminiApiKey: '[redacted]',
      downstreamApiKey: '[redacted]',
      scrapeCreatorsApiKey: '[redacted]',
      foreplayApiKey: '[redacted]',
      teamAccessToken: '[redacted]',
      intentShortsBridgeToken: '[redacted]',
      headers: '[redacted]',
      text: 'safe',
      canonicalUrl: 'https://www.youtube.com/watch?v=video-id',
      prompt: 'source https://signed.example/video.mp4',
      circular: '[omitted circular reference]',
    })
  })
})
