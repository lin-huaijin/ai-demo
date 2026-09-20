import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  clearRuntimeApiCredentials,
  setRuntimeApiCredentials,
  setRuntimeMultimodalProfile,
} from '../lib/apiAccess'
import { ApiSettingsDialog } from './ApiSettingsDialog'

afterEach(() => clearRuntimeApiCredentials())

describe('ApiSettingsDialog multimodal profiles', () => {
  it('offers Seed 2.1 Pro and a readable Gemini × Seed fusion option', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsDialog open onClose={vi.fn()} />,
    )

    expect(html).toContain('Seed 2.1 Pro')
    expect(html).toContain('Gemini × Seed 融合')
    expect(html).toContain('Seed 细看画面；Gemini 复核声音、暗线与语义')
    expect(html).toContain('视频预处理运行在哪里？')
    expect(html).toContain('本地开发时就是当前电脑；部署后则由服务器负责')
    expect(html).toContain('MM01 → C01 搜索 → 本地 P02F → P02')
    expect(html).toContain('C01 搜索 / P02 文本模型 API Key')
    expect(html).toContain('multimodal-downstreamApiKey')
    expect(html).toContain('前端只临时传入密钥')
    expect(html).not.toContain('XGAPI')
  })

  it('shows both in-memory API key fields when fusion is selected', () => {
    setRuntimeMultimodalProfile('fusion')
    const html = renderToStaticMarkup(
      <ApiSettingsDialog open onClose={vi.fn()} />,
    )

    expect(html).toContain('Gemini 3.1 Pro API Key')
    expect(html).toContain('Seed 2.1 Pro API Key')
    expect(html).toContain('multimodal-geminiApiKey')
    expect(html).toContain('multimodal-seedApiKey')
    expect(html).toContain(
      'Seed 先做视觉取证，Gemini 再结合原媒体复核，并对齐共识、冲突与采用结论',
    )
    expect(html).not.toContain('双模型先独立取证')
    expect(html).toContain('C01 搜索 / P02 文本模型 API Key')
  })

  it('does not claim fusion is ready when only one session key is present', () => {
    setRuntimeMultimodalProfile('fusion')
    setRuntimeApiCredentials({ geminiApiKey: 'gemini-only' })

    const html = renderToStaticMarkup(
      <ApiSettingsDialog open onClose={vi.fn()} />,
    )

    expect(html).toContain('待补齐密钥')
  })

  it('does not claim the full chain is ready when the downstream key is absent', () => {
    setRuntimeMultimodalProfile('gemini')
    setRuntimeApiCredentials({ geminiApiKey: 'gemini-only' })

    const html = renderToStaticMarkup(
      <ApiSettingsDialog open onClose={vi.fn()} />,
    )

    expect(html).toContain('待补齐密钥')
    expect(html).toContain('C01 搜索 / P02 文本模型 API Key')
  })

  it('labels an entered session credential as present but unverified', () => {
    setRuntimeMultimodalProfile('gemini')
    setRuntimeApiCredentials({
      geminiApiKey: 'gemini-key',
      downstreamApiKey: 'downstream-key',
    })

    const html = renderToStaticMarkup(
      <ApiSettingsDialog open onClose={vi.fn()} />,
    )

    expect(html).toContain('本次会话凭据 · 未验证')
    expect(html).not.toContain('服务端已配置')
  })
})
