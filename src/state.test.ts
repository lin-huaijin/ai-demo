import { describe, expect, it } from 'vitest'
import {
  activeDerivedRecords,
  automaticBreakdownCandidates,
  canEnterAutomaticBreakdown,
  retainFailedGateAfterUnsuccessfulRetry,
} from './state'
import type { HotItem } from './types'

function hotItem(
  status: HotItem['multimodalAnalysisStatus'],
  error?: string,
): HotItem {
  return {
    id: 'source-1',
    marketId: 'us',
    platform: 'tiktok',
    title: 'source',
    likes: 0,
    views: 0,
    source: 'views_top',
    topicTags: ['travel'],
    formatFit: ['video'],
    oneLiner: '原始素材',
    suggestedFeature: 'f2f',
    collectedAt: '2026-07-20T00:00:00.000Z',
    dedupeKey: 'source-1',
    multimodalAnalysisStatus: status,
    multimodalAnalysisError: error,
  }
}

describe('multimodal breakdown gate', () => {
  it('keeps failed sources out while preserving all other established paths', () => {
    const items = [
      { id: 'complete', multimodalAnalysisStatus: 'complete' as const },
      { id: 'degraded', multimodalAnalysisStatus: 'degraded' as const },
      { id: 'skipped', multimodalAnalysisStatus: 'skipped' as const },
      { id: 'legacy' },
      {
        id: 'failed',
        multimodalAnalysisStatus: 'failed' as const,
        multimodalAnalysisError: 'MM01 coverage 8.4%',
      },
    ]

    const result = automaticBreakdownCandidates(items)

    expect(result.map((item) => item.id)).toEqual([
      'complete',
      'degraded',
      'skipped',
      'legacy',
    ])
    expect(items).toHaveLength(5)
    expect(items[4].multimodalAnalysisError).toBe('MM01 coverage 8.4%')
  })

  it('treats failed as a hard gate rather than a degraded or skipped result', () => {
    expect(canEnterAutomaticBreakdown({ multimodalAnalysisStatus: 'failed' })).toBe(false)
    expect(canEnterAutomaticBreakdown({ multimodalAnalysisStatus: 'degraded' })).toBe(true)
    expect(canEnterAutomaticBreakdown({ multimodalAnalysisStatus: 'skipped' })).toBe(true)
  })

  it('keeps a failed source quarantined until a retry actually succeeds', () => {
    const previous = hotItem('failed', '覆盖不足')
    const unavailable = hotItem('skipped', '服务端尚未配置当前多模态模型。')
    unavailable.artifact = {
      projectId: 'default',
      assetId: 'asset_latest',
      runId: 'run_latest',
      status: 'failed',
      manifestUrl: '/manifest',
      exportUrl: '/export',
    }
    unavailable.artifactWarning = '最新运行仅部分归档'
    const retained = retainFailedGateAfterUnsuccessfulRetry(previous, unavailable)

    expect(retained.multimodalAnalysisStatus).toBe('failed')
    expect(retained.multimodalAnalysisError).toBe('服务端尚未配置当前多模态模型。')
    expect(retained.oneLiner).toBe(previous.oneLiner)
    expect(retained.artifact).toBe(unavailable.artifact)
    expect(retained.artifactWarning).toBe('最新运行仅部分归档')

    const completed = hotItem('complete')
    expect(
      retainFailedGateAfterUnsuccessfulRetry(previous, completed),
    ).toBe(completed)
  })

  it('retains historical records while excluding them from active selectors', () => {
    const records = [
      { id: 'breakdown-1', hotItemId: 'source-1' },
      { id: 'breakdown-2', hotItemId: 'source-2' },
    ]
    const active = activeDerivedRecords(records, [
      { id: 'source-1', multimodalAnalysisStatus: 'failed' },
      { id: 'source-2', multimodalAnalysisStatus: 'complete' },
    ])

    expect(active).toEqual([{ id: 'breakdown-2', hotItemId: 'source-2' }])
    expect(records).toHaveLength(2)
    expect(
      activeDerivedRecords(records, [
        { id: 'source-1', multimodalAnalysisStatus: 'complete' },
        { id: 'source-2', multimodalAnalysisStatus: 'complete' },
      ]),
    ).toEqual(records)
  })
})
