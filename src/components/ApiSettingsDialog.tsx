import { useEffect, useRef, useState } from 'react'
import {
  clearRuntimeApiCredentials,
  getRuntimeApiCredentials,
  getRuntimeMultimodalProfile,
  setRuntimeApiCredentials,
  setRuntimeApiSettings,
  type RuntimeApiCredential,
  type RuntimeApiCredentials,
  type RuntimeMultimodalProfile,
} from '../lib/apiAccess'

interface ApiSettingsDialogProps {
  open: boolean
  onClose: () => void
}

interface MultimodalProfileStatus {
  configured: boolean
  providerConfigured: boolean
  provider: 'gemini' | 'kimi' | 'seed' | 'fusion'
  model: string
  audio: boolean
}

interface ApiSettingsStatus {
  services: {
    scrapecreators: { configured: boolean }
    foreplay: { configured: boolean }
    gemini: { configured: boolean; model: string }
    downstream: {
      configured: boolean
      c01Model: string
      p02Model: string
    }
    multimodal: {
      activeProfile: RuntimeMultimodalProfile
      profiles: Record<RuntimeMultimodalProfile, MultimodalProfileStatus>
    }
    intentShorts: { configured: boolean }
  }
}

const SERVICES: Array<{
  id: 'scrapecreators' | 'foreplay'
  credential: RuntimeApiCredential
  mark: string
  name: string
  role: string
  detail: string
  placeholder: string
}> = [
  {
    id: 'scrapecreators',
    credential: 'scrapeCreatorsApiKey',
    mark: 'SC',
    name: 'ScrapeCreators',
    role: '素材入口',
    detail: '读取 TikTok、Instagram、Facebook 的素材、元数据与可用字幕。',
    placeholder: '输入 ScrapeCreators API Key',
  },
  {
    id: 'foreplay',
    credential: 'foreplayApiKey',
    mark: 'FP',
    name: 'Foreplay',
    role: '广告灵感库',
    detail: '按关键词、品类和平台检索广告，并带回素材与广告信号。',
    placeholder: '输入 Foreplay API Key',
  },
]

const MODEL_PROFILES: Array<{
  id: RuntimeMultimodalProfile
  name: string
  capability: string
}> = [
  {
    id: 'fusion',
    name: 'Gemini × Seed 融合',
    capability: 'Seed 细看画面；Gemini 复核声音、暗线与语义',
  },
  {
    id: 'gemini',
    name: 'Gemini 3.1 Pro',
    capability: '完整视频、音轨、暗线与语义',
  },
  {
    id: 'seed-2.1-pro',
    name: 'Seed 2.1 Pro',
    capability: '画面、OCR 与镜头细节',
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    capability: '视频画面；音轨与 ASR 暂不采信',
  },
]

const PROFILE_CREDENTIALS: Record<
  RuntimeMultimodalProfile,
  RuntimeApiCredential[]
> = {
  gemini: ['geminiApiKey'],
  'kimi-k3': ['kimiApiKey'],
  'seed-2.1-pro': ['seedApiKey'],
  fusion: ['geminiApiKey', 'seedApiKey'],
}

const CREDENTIAL_LABELS: Partial<Record<RuntimeApiCredential, string>> = {
  geminiApiKey: 'Gemini 3.1 Pro',
  kimiApiKey: 'Kimi K3',
  seedApiKey: 'Seed 2.1 Pro',
}

const EMPTY_STATUS: ApiSettingsStatus = {
  services: {
    scrapecreators: { configured: false },
    foreplay: { configured: false },
    gemini: { configured: false, model: 'gemini-3.1-pro-preview-thinking' },
    downstream: {
      configured: false,
      c01Model: 'gpt-5-mini',
      p02Model: 'gpt-5-mini',
    },
    multimodal: {
      activeProfile: 'gemini',
      profiles: {
        gemini: {
          configured: false,
          providerConfigured: false,
          provider: 'gemini',
          model: 'gemini-3.1-pro-preview-thinking',
          audio: true,
        },
        'kimi-k3': {
          configured: false,
          providerConfigured: false,
          provider: 'kimi',
          model: 'kimi-k3',
          audio: false,
        },
        'seed-2.1-pro': {
          configured: false,
          providerConfigured: false,
          provider: 'seed',
          model: 'doubao-seed-2-1-pro-260628',
          audio: false,
        },
        fusion: {
          configured: false,
          providerConfigured: false,
          provider: 'fusion',
          model: 'Gemini + Seed 2.1 Pro',
          audio: true,
        },
      },
    },
    intentShorts: { configured: false },
  },
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function configuredService(value: unknown): boolean {
  return record(value)?.configured === true
}

function normalizeProfile(value: unknown): RuntimeMultimodalProfile {
  return value === 'kimi-k3' ||
    value === 'seed-2.1-pro' ||
    value === 'fusion'
    ? value
    : 'gemini'
}

function normalizeApiSettingsStatus(value: unknown): ApiSettingsStatus {
  const services = record(record(value)?.services)
  if (!services) throw new Error('settings status unavailable')
  const legacyGemini = record(services.gemini)
  const downstream = record(services.downstream)
  const downstreamConfigured = downstream?.configured === true
  const multimodal = record(services.multimodal)
  const profiles = record(multimodal?.profiles)
  const gemini = record(profiles?.gemini)
  const kimi = record(profiles?.['kimi-k3'])
  const seed = record(profiles?.['seed-2.1-pro'])
  const fusion = record(profiles?.fusion)
  const activeProfile = normalizeProfile(multimodal?.activeProfile)
  return {
    services: {
      scrapecreators: { configured: configuredService(services.scrapecreators) },
      foreplay: { configured: configuredService(services.foreplay) },
      gemini: {
        configured: configuredService(services.gemini),
        model:
          typeof legacyGemini?.model === 'string'
            ? legacyGemini.model
            : 'gemini-3.1-pro-preview-thinking',
      },
      downstream: {
        configured: downstreamConfigured,
        c01Model:
          typeof downstream?.c01Model === 'string'
            ? downstream.c01Model
            : 'gpt-5-mini',
        p02Model:
          typeof downstream?.p02Model === 'string'
            ? downstream.p02Model
            : 'gpt-5-mini',
      },
      multimodal: {
        activeProfile,
        profiles: {
          gemini: {
            configured:
              (gemini ? gemini.configured === true : configuredService(services.gemini)) &&
              downstreamConfigured,
            providerConfigured:
              gemini?.providerConfigured === true || configuredService(services.gemini),
            provider: 'gemini',
            model:
              typeof gemini?.model === 'string'
                ? gemini.model
                : typeof legacyGemini?.model === 'string'
                  ? legacyGemini.model
                  : 'gemini-3.1-pro-preview-thinking',
            audio: gemini?.audio !== false,
          },
          'kimi-k3': {
            configured: kimi?.configured === true && downstreamConfigured,
            providerConfigured:
              kimi?.providerConfigured === true || kimi?.configured === true,
            provider: 'kimi',
            model: typeof kimi?.model === 'string' ? kimi.model : 'kimi-k3',
            audio: false,
          },
          'seed-2.1-pro': {
            configured: seed?.configured === true && downstreamConfigured,
            providerConfigured:
              seed?.providerConfigured === true || seed?.configured === true,
            provider: 'seed',
            model:
              typeof seed?.model === 'string'
                ? seed.model
                : 'doubao-seed-2-1-pro-260628',
            audio: seed?.audio === true,
          },
          fusion: {
            configured: fusion?.configured === true && downstreamConfigured,
            providerConfigured:
              fusion?.providerConfigured === true || fusion?.configured === true,
            provider: 'fusion',
            model:
              typeof fusion?.model === 'string'
                ? fusion.model
                : 'Gemini + Seed 2.1 Pro',
            audio: fusion?.audio !== false,
          },
        },
      },
      intentShorts: { configured: configuredService(services.intentShorts) },
    },
  }
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 12 4c5.2 0 8.6 4.4 9.5 6.1a4 4 0 0 1 0 3.8 13 13 0 0 1-2.1 2.8M6.2 6.2a13.6 13.6 0 0 0-3.7 3.9 4 4 0 0 0 0 3.8C3.4 15.6 6.8 20 12 20c1.2 0 2.3-.2 3.3-.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 10.1a4 4 0 0 0 0 3.8C3.4 15.6 6.8 20 12 20s8.6-4.4 9.5-6.1a4 4 0 0 0 0-3.8C20.6 8.4 17.2 4 12 4S3.4 8.4 2.5 10.1Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function ApiSettingsDialog({ open, onClose }: ApiSettingsDialogProps) {
  const [draft, setDraft] = useState<RuntimeApiCredentials>(() =>
    getRuntimeApiCredentials(),
  )
  const [draftProfile, setDraftProfile] = useState<RuntimeMultimodalProfile>(
    () => getRuntimeMultimodalProfile() ?? 'gemini',
  )
  const [status, setStatus] = useState<ApiSettingsStatus>(EMPTY_STATUS)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [revealed, setRevealed] = useState<Set<RuntimeApiCredential>>(
    () => new Set(),
  )
  const [notice, setNotice] = useState('')
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const profileTouchedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setDraft(getRuntimeApiCredentials())
    setDraftProfile(getRuntimeMultimodalProfile() ?? 'gemini')
    profileTouchedRef.current = false
    setRevealed(new Set())
    setStatusLoaded(false)
    setStatusError('')
    setNotice('')
    const previousFocus = document.activeElement as HTMLElement | null
    const controller = new AbortController()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    void fetch('/api/settings/status', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('status unavailable')
        return normalizeApiSettingsStatus(await response.json())
      })
      .then((nextStatus) => {
        setStatus(nextStatus)
        setStatusLoaded(true)
        setStatusError('')
        if (!profileTouchedRef.current && !getRuntimeMultimodalProfile()) {
          setDraftProfile(nextStatus.services.multimodal.activeProfile)
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setStatus(EMPTY_STATUS)
        setStatusLoaded(false)
        setStatusError('服务端配置状态暂时无法读取')
      })
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [onClose, open])

  if (!open) return null

  function update(credential: RuntimeApiCredential, value: string) {
    setDraft((current) => ({ ...current, [credential]: value }))
  }

  function toggleReveal(credential: RuntimeApiCredential) {
    setRevealed((current) => {
      const next = new Set(current)
      if (next.has(credential)) next.delete(credential)
      else next.add(credential)
      return next
    })
  }

  function serviceState(
    id: 'scrapecreators' | 'foreplay',
    credential: RuntimeApiCredential,
  ) {
    const applied = getRuntimeApiCredentials()[credential]
    if (draft[credential].trim() !== applied) {
      return { label: '待应用', kind: 'pending' }
    }
    if (applied) {
      return { label: '本次会话凭据 · 未验证', kind: 'session' }
    }
    if (statusError) return { label: '状态未知', kind: 'unknown' }
    if (status.services[id].configured) {
      return { label: '凭据已填入 · 未验证', kind: 'server' }
    }
    return { label: '待配置', kind: 'missing' }
  }

  function applySettings() {
    const shouldApplyProfile =
      statusLoaded ||
      profileTouchedRef.current ||
      Boolean(getRuntimeMultimodalProfile())
    if (shouldApplyProfile) setRuntimeApiSettings(draft, draftProfile)
    else setRuntimeApiCredentials(draft)
    setDraft(getRuntimeApiCredentials())
    setNotice(
      shouldApplyProfile
        ? '模型与密钥已应用到本次会话；刷新页面后临时设置会自动清空。'
        : '密钥已应用到本次会话；模型继续使用服务端默认。',
    )
  }

  function clearSettings() {
    clearRuntimeApiCredentials()
    setDraft(getRuntimeApiCredentials())
    if (statusLoaded) {
      setDraftProfile(status.services.multimodal.activeProfile)
    }
    setRevealed(new Set())
    setNotice('临时密钥已清除，多模态模型已恢复为服务端默认。')
  }

  const multimodalCredentials = PROFILE_CREDENTIALS[draftProfile]
  const selectedModel = status.services.multimodal.profiles[draftProfile]
  const appliedCredentials = getRuntimeApiCredentials()
  const appliedProfile =
    getRuntimeMultimodalProfile() ?? status.services.multimodal.activeProfile
  const multimodalPending =
    draftProfile !== appliedProfile ||
    draft.downstreamApiKey.trim() !== appliedCredentials.downstreamApiKey ||
    multimodalCredentials.some(
      (credential) =>
        draft[credential].trim() !== appliedCredentials[credential],
    )
  const serverCredentialConfigured: Partial<
    Record<RuntimeApiCredential, boolean>
  > = {
    geminiApiKey:
      status.services.multimodal.profiles.gemini.providerConfigured,
    kimiApiKey:
      status.services.multimodal.profiles['kimi-k3'].providerConfigured,
    seedApiKey:
      status.services.multimodal.profiles['seed-2.1-pro'].providerConfigured,
  }
  const hasSessionProviderCredential = multimodalCredentials.some(
    (credential) => Boolean(appliedCredentials[credential]),
  )
  const hasEveryEffectiveProviderCredential = multimodalCredentials.every(
    (credential) =>
      Boolean(appliedCredentials[credential]) ||
      serverCredentialConfigured[credential] === true,
  )
  const hasSessionDownstreamCredential = Boolean(
    appliedCredentials.downstreamApiKey,
  )
  const hasEffectiveDownstreamCredential =
    hasSessionDownstreamCredential || status.services.downstream.configured
  const hasEveryEffectiveCredential =
    hasEveryEffectiveProviderCredential && hasEffectiveDownstreamCredential
  const hasSessionCredential =
    hasSessionProviderCredential || hasSessionDownstreamCredential
  const multimodalState = multimodalPending
    ? { label: '待应用', kind: 'pending' }
    : hasSessionCredential && hasEveryEffectiveCredential
      ? { label: '本次会话凭据 · 未验证', kind: 'session' }
      : hasSessionCredential
        ? { label: '待补齐密钥', kind: 'missing' }
      : statusError
        ? { label: '状态未知', kind: 'unknown' }
        : selectedModel.configured
          ? { label: '凭据已填入 · 未验证', kind: 'server' }
          : { label: '待配置', kind: 'missing' }
  const downstreamPending =
    draft.downstreamApiKey.trim() !== appliedCredentials.downstreamApiKey
  const downstreamState = downstreamPending
    ? { label: '待应用', kind: 'pending' }
    : hasSessionDownstreamCredential
      ? { label: '本次会话凭据 · 未验证', kind: 'session' }
      : statusError
        ? { label: '状态未知', kind: 'unknown' }
        : status.services.downstream.configured
          ? { label: '凭据已填入 · 未验证', kind: 'server' }
          : { label: '待配置', kind: 'missing' }
  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={drawerRef}
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-settings-title"
      >
        <header className="settings-header">
          <div>
            <span className="settings-kicker">CONNECTION DECK</span>
            <h2 id="api-settings-title">API 接口设置</h2>
            <p>素材入口、灵感库与四段分析链；每次结果都保留模型来源。</p>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button settings-close"
            type="button"
            onClick={onClose}
            aria-label="关闭 API 设置"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="settings-security-note">
          <span aria-hidden="true">●</span>
          <p>
            临时密钥只存在当前标签页内存，不会写入 localStorage、URL 或前端构建。团队部署仍推荐在服务端环境变量中托管。
            多模态分析会发送到服务端为当前部署配置的模型网关，请确保临时密钥与所选模型的部署配置匹配。
          </p>
        </div>
        {statusError && (
          <p className="settings-status-error" role="status">
            {statusError}；临时密钥仍可填写并应用。
          </p>
        )}

        <div className="api-service-list">
          {SERVICES.map((service, index) => {
            const state = serviceState(service.id, service.credential)
            const isRevealed = revealed.has(service.credential)
            return (
              <article className="api-service-card" key={service.id}>
                <div className="api-service-index">0{index + 1}</div>
                <div className={`api-service-mark ${service.id}`}>
                  {service.mark}
                </div>
                <div className="api-service-content">
                  <div className="api-service-heading">
                    <div>
                      <strong>{service.name}</strong>
                      <span>{service.role}</span>
                    </div>
                    <span className={`connection-state ${state.kind}`}>
                      {state.label}
                    </span>
                  </div>
                  <p>{service.detail}</p>
                  <div className="secret-field">
                    <input
                      type={isRevealed ? 'text' : 'password'}
                      value={draft[service.credential]}
                      onChange={(event) =>
                        update(service.credential, event.target.value)
                      }
                      placeholder={service.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`${service.name} API Key`}
                    />
                    <button
                      type="button"
                      onClick={() => toggleReveal(service.credential)}
                      aria-label={`${isRevealed ? '隐藏' : '显示'} ${service.name} 密钥`}
                    >
                      <EyeIcon hidden={!isRevealed} />
                    </button>
                  </div>
                </div>
              </article>
            )
          })}

          <article className="api-service-card multimodal-service-card">
            <div className="api-service-index">03</div>
            <div className="api-service-mark multimodal">MM</div>
            <div className="api-service-content">
              <div className="api-service-heading">
                <div>
                  <strong>多模态分析</strong>
                  <span>反推拆解</span>
                </div>
                <span className={`connection-state ${multimodalState.kind}`}>
                  {multimodalState.label}
                </span>
              </div>
              <p>
                使用 MM01 → C01 搜索 → 本地 P02F → P02 证据链。融合模式由
                Seed 细看画面，再由 Gemini 结合音轨、暗线和语义复核；C01
                与 P02 使用独立的文本模型，不复用多模态密钥。
              </p>
              <div className="api-runtime-note">
                <strong>视频预处理运行在哪里？</strong>
                <span>
                  FFmpeg 与 ffprobe 安装在运行 Node 服务的电脑或服务器，不在浏览器里运行。本地开发时就是当前电脑；部署后则由服务器负责。素材拆解页会实时提示完整视频、关键帧和降级状态。
                </span>
              </div>

              <fieldset className="model-profile-picker">
                <legend>选择本次会话的分析方式</legend>
                {MODEL_PROFILES.map((profile) => (
                  <label
                    className={draftProfile === profile.id ? 'selected' : ''}
                    key={profile.id}
                  >
                    <input
                      type="radio"
                      name="multimodal-profile"
                      value={profile.id}
                      checked={draftProfile === profile.id}
                      onChange={() => {
                        profileTouchedRef.current = true
                        setDraftProfile(profile.id)
                      }}
                    />
                    <span>
                      <strong>{profile.name}</strong>
                      <small>
                        {status.services.multimodal.activeProfile === profile.id
                          ? '服务端默认'
                          : profile.id === 'fusion'
                            ? '推荐'
                            : '可选'}{' '}
                        · {profile.capability}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>

              <small id="multimodal-model-detail" aria-live="polite">
                所选模型：{selectedModel.model} ·{' '}
                {draftProfile === 'fusion'
                  ? 'Seed 先做视觉取证，Gemini 再结合原媒体复核，并对齐共识、冲突与采用结论'
                  : selectedModel.audio
                    ? '含音频证据能力'
                    : '音频与 ASR 按缺失处理'}
              </small>
              <div className="multimodal-key-fields">
                {multimodalCredentials.map((credential) => {
                  const modelName = CREDENTIAL_LABELS[credential] ?? '模型'
                  const isRevealed = revealed.has(credential)
                  return (
                    <div key={credential}>
                      <label
                        className="secret-field-label"
                        htmlFor={`multimodal-${credential}`}
                      >
                        {modelName} API Key
                      </label>
                      <div className="secret-field">
                        <input
                          id={`multimodal-${credential}`}
                          type={isRevealed ? 'text' : 'password'}
                          value={draft[credential]}
                          onChange={(event) => update(credential, event.target.value)}
                          placeholder={`输入 ${modelName} API Key`}
                          autoComplete="off"
                          spellCheck={false}
                          aria-describedby="multimodal-model-detail"
                        />
                        <button
                          type="button"
                          onClick={() => toggleReveal(credential)}
                          aria-label={`${isRevealed ? '隐藏' : '显示'} ${modelName} 密钥`}
                        >
                          <EyeIcon hidden={!isRevealed} />
                        </button>
                      </div>
                    </div>
                  )
                })}
                <div className="downstream-key-field">
                  <div className="downstream-key-heading">
                    <label
                      className="secret-field-label"
                      htmlFor="multimodal-downstreamApiKey"
                    >
                      C01 搜索 / P02 文本模型 API Key
                    </label>
                    <span className={`connection-state ${downstreamState.kind}`}>
                      {downstreamState.label}
                    </span>
                  </div>
                  <div className="secret-field">
                    <input
                      id="multimodal-downstreamApiKey"
                      type={revealed.has('downstreamApiKey') ? 'text' : 'password'}
                      value={draft.downstreamApiKey}
                      onChange={(event) =>
                        update('downstreamApiKey', event.target.value)
                      }
                      placeholder="输入 C01 / P02 文本模型 API Key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => toggleReveal('downstreamApiKey')}
                      aria-label={`${
                        revealed.has('downstreamApiKey') ? '隐藏' : '显示'
                      } C01 / P02 文本模型密钥`}
                    >
                      <EyeIcon hidden={!revealed.has('downstreamApiKey')} />
                    </button>
                  </div>
                  <small>
                    C01：{status.services.downstream.c01Model} · P02：
                    {status.services.downstream.p02Model}。模型和接口地址由服务端固定，前端只临时传入密钥。
                  </small>
                </div>
              </div>
            </div>
          </article>
        </div>

        <details className="access-settings">
          <summary>
            <span>
              <strong>访问与集成</strong>
            <small>部署访问口令 · 外部工具桥接预留</small>
            </span>
            <span aria-hidden="true">＋</span>
          </summary>
          <div className="access-settings-body">
            <label>
              <span>团队访问口令</span>
              <small>用于解锁受保护的抓取和多模态调用，不是供应商 API Key。</small>
              <input
                type="password"
                value={draft.teamAccessToken}
                onChange={(event) => update('teamAccessToken', event.target.value)}
                placeholder="MULTIMODAL_ACCESS_TOKEN"
                autoComplete="off"
              />
            </label>
            <label>
              <span>外部工具桥接口令</span>
              <small>
                可选。上游访问密码仍只在服务端保存；这里仅填写合并桥接的临时口令。
              </small>
              <input
                type="password"
                value={draft.intentShortsBridgeToken}
                onChange={(event) =>
                  update('intentShortsBridgeToken', event.target.value)
                }
                placeholder="EXTERNAL_TOOL_BRIDGE_ACCESS_TOKEN"
                autoComplete="off"
              />
            </label>
            <span
              className={`shorts-bridge-state ${status.services.intentShorts.configured ? 'ready' : ''}`}
            >
              外部工具服务端桥接：
              {status.services.intentShorts.configured
                ? '凭据已填入 · 未验证'
                : '未启用'}
            </span>
          </div>
        </details>

        <footer className="settings-footer">
          <div aria-live="polite">{notice}</div>
          <div>
            <button className="btn btn-ghost" type="button" onClick={clearSettings}>
              清除临时密钥
            </button>
            <button className="btn btn-primary" type="button" onClick={applySettings}>
              应用到本次会话
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
