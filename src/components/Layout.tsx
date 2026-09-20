import { useLayoutEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { applyTheme, readThemePreference, type AppTheme } from '../lib/theme'
import { ApiSettingsDialog } from './ApiSettingsDialog'

const links = [
  { to: '/', step: '00', label: '总览', desc: '流程地图' },
  { to: '/inspire', step: '01', label: '素材拆解', desc: '识别 · 拆解' },
  { to: '/screen', step: '02', label: '人工筛选', desc: '进制作 · 淘汰' },
  { to: '/produce', step: '03', label: '创意制作', desc: '形态 · 脚本' },
  { to: '/push', step: '04', label: '机审投放', desc: '审核 · 推送' },
  { to: '/archive', step: 'LIB', label: '热点库', desc: '归档 · 检索' },
]

function IntentBrandMark() {
  return (
    <svg viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <g
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 19V10a4 4 0 0 1 4-4h9" />
        <path d="M53 6h9a4 4 0 0 1 4 4v9" />
        <path d="M66 53v9a4 4 0 0 1-4 4h-9" />
        <path d="M19 66h-9a4 4 0 0 1-4-4v-9" />
        <path d="M6 36h5M61 36h5" />
      </g>
      <g transform="translate(36.29 36) scale(.95) translate(-36.29 -36)">
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M57.188 49.758 46.794 21.783c-.565-1.5-.993-2.804-2.298-3.776-1.067-1.077-3.107-1.694-4.624-1.694h-9.896c-1.506 0-2.986.612-4.048 1.679-1.31.971-2.299 2.275-2.869 3.775l-8 21.243a5.73 5.73 0 0 0 .655 5.275 5.74 5.74 0 0 0 4.713 2.465H26.9c.085 0 .169.048.217.127l1.913 3.263a3.13 3.13 0 0 0 2.214 1.521c.142.016.29.027.428.027 1.305 0 2.457-.819 2.864-2.033l1.046-2.905h11.646c.259 0 .517.058.766.18l5.3 2.36c.386.196.819.296 1.252.296.935 0 1.802-.459 2.33-1.22.529-.771.645-1.742.312-2.608ZM31.899 52.63a.255.255 0 0 1-.238.164.278.278 0 0 1-.232-.137l-1.881-3.206a3.08 3.08 0 0 0-2.648-1.526h-6.473a2.89 2.89 0 0 1-2.393-1.246 2.88 2.88 0 0 1-.328-2.677l8-21.242a5.7 5.7 0 0 1 2.066-2.63 5.65 5.65 0 0 1 3.181-.998h8.919c.835 0 1.601.333 2.151.951.084.095.164.195.243.301a2.88 2.88 0 0 1 .322 2.687L31.899 52.63Z"
        />
      </g>
    </svg>
  )
}

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<AppTheme>(() => readThemePreference())

  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  const nextTheme = theme === 'warm' ? 'dark' : 'warm'

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <NavLink
          className="brand"
          to="/"
          aria-label="AI Creative Workflow Demo 首页"
        >
          <span className="brand-mark">
            <IntentBrandMark />
          </span>
          <span className="brand-copy">
          <strong>AI Creative Workflow</strong>
            <small>Creative Workflow · Beta</small>
          </span>
        </NavLink>
        <div className="sidebar-intro">
          <span className="context-kicker">创意工作流</span>
          <p>链接入库 → 拆解 → 筛选 → 制作 → 投放</p>
        </div>
        <nav className="nav" aria-label="工作流主导航">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <span className="nav-step">{link.step}</span>
              <span className="nav-copy">
                <strong>{link.label}</strong>
                <small>{link.desc}</small>
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-meta" aria-label="版本和界面设置">
          <span className="sidebar-version">Beta · V0.2</span>
          <div className="sidebar-controls">
            <button
              className="api-settings-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-haspopup="dialog"
              aria-label="打开 API 接口设置（3 条能力链路，多种分析模型）"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14M5 12h14M5 17h14" />
                <circle cx="9" cy="7" r="2" />
                <circle cx="15" cy="12" r="2" />
                <circle cx="11" cy="17" r="2" />
              </svg>
              <span>API 接口</span>
              <b>3</b>
            </button>
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme(nextTheme)}
              aria-label={`切换到${nextTheme === 'dark' ? '深色' : '暖色'}主题`}
              title={`切换到${nextTheme === 'dark' ? '深色' : '暖色'}主题`}
            >
              {theme === 'warm' ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </aside>
      <main className="main" id="main-content">
        <div className="main-inner">
          <Outlet />
        </div>
      </main>
      <ApiSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
