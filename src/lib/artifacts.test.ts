import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listArtifactAssets,
  parseArtifactReference,
  parseArtifactWarning,
  saveWorkflowArtifactSnapshot,
} from './artifacts.ts'
import {
  clearRuntimeApiCredentials,
  setRuntimeApiCredentials,
} from './apiAccess.ts'

afterEach(() => clearRuntimeApiCredentials())

describe('artifact client contract', () => {
  it('turns the server reference into stable internal archive URLs', () => {
    expect(
      parseArtifactReference({
        artifact: {
          projectId: 'default',
          assetId: 'asset_123',
          runId: 'run_456',
          status: 'complete',
        },
      }),
    ).toMatchObject({
      projectId: 'default',
      assetId: 'asset_123',
      runId: 'run_456',
      status: 'complete',
      manifestUrl: '/api/artifacts/projects/default/assets/asset_123',
      exportUrl:
        '/api/artifacts/projects/default/assets/asset_123/runs/run_456/export',
    })
  })

  it('rejects partial or unknown references', () => {
    expect(
      parseArtifactReference({
        artifact: { projectId: 'default', assetId: '../escape', status: 'saved' },
      }),
    ).toBeUndefined()
    expect(
      parseArtifactWarning({ artifactWarning: '本地磁盘不可写' }),
    ).toBe('本地磁盘不可写')
  })

  it('reads asset lists and writes workflow snapshots through bounded routes', async () => {
    setRuntimeApiCredentials({ teamAccessToken: 'archive-access' })
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ assets: [{ assetId: 'asset_123' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    expect(await listArtifactAssets(fetchImpl)).toEqual([{ assetId: 'asset_123' }])
    await saveWorkflowArtifactSnapshot(
      {
        projectId: 'default',
        assetId: 'asset_123',
        runId: 'run_456',
        status: 'complete',
        manifestUrl: '',
        exportUrl: '',
      },
      {
        hotItem: {} as never,
        produceCount: 0,
        savedAt: '2026-07-21T00:00:00.000Z',
      },
      fetchImpl,
    )

    expect(fetchImpl).toHaveBeenLastCalledWith(
      '/api/artifacts/projects/default/assets/asset_123/runs/run_456/workflow',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/artifacts',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer archive-access',
        }),
      }),
    )
  })
})
