import { memo, useState } from 'react'
import { AppShell } from '../shell/AppShell'
import { MojingMark } from '../shell/MojingMark'
import type { MojingTheme } from '../shell/useTheme'
import { PaneActionsProvider } from './PaneActions'
import { A11yPane } from './panes/A11yPane'
import { AboutPane } from './panes/AboutPane'
import { ModelPane } from './panes/ModelPane'
import { PathPane } from './panes/PathPane'
import { ThemePane } from './panes/ThemePane'
import { SETTINGS_SECTIONS, getSettingsSection, type SettingsSectionId } from './settingsNavigation'

function AppearancePane(): React.JSX.Element {
  return <><ThemePane /><A11yPane /></>
}

const PANES = {
  path: memo(PathPane),
  model: memo(ModelPane),
  appearance: memo(AppearancePane),
  about: memo(AboutPane)
}

type SettingsPageProps = {
  theme: MojingTheme
  onToggleTheme: () => void
  embedded?: boolean
}

export function SettingsPage({ theme, onToggleTheme, embedded = false }: SettingsPageProps): React.JSX.Element {
  const [active, setActive] = useState<SettingsSectionId>('path')
  const [paneActions, setPaneActions] = useState<React.ReactNode>(null)
  const meta = getSettingsSection(active)
  const Pane = PANES[active]

  return (
    <AppShell
      railItems={[]}
      activeRailId=""
      onSelectRail={() => {}}
      brand={<MojingMark />}
      breadcrumb={['设置中心']}
      saveState={null}
      theme={theme}
      onToggleTheme={onToggleTheme}
      bareBody
      showTopBar={false}
      embedded={embedded}
    >
      <div className="mjp-body mjp-settings">
        <aside className="mjp-snav">
          <div className="mjp-snav-head">
            <div className="name">设置中心</div>
            <div className="sub">应用偏好与本机服务</div>
          </div>
          <nav className="mjp-snav-scroll mjp-scroll" aria-label="设置栏目">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`mjp-snav-section${section.id === active ? ' is-active' : ''}`}
                aria-current={section.id === active ? 'page' : undefined}
                onClick={() => {
                  if (section.id !== active) {
                    setPaneActions(null)
                    setActive(section.id)
                  }
                }}
              >
                <section.icon size={17} strokeWidth={1.7} />
                <span className="lbl">{section.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="mjp-canvas">
          <div className="mjp-canvas-scroll mjp-scroll">
            <div className="mjp-settings-page">
              <header className="mjp-settings-hero">
                <div className="mjp-settings-heading">
                  <p className="eyebrow">设置中心</p>
                  <h2>{meta.label}</h2>
                  <p>{meta.sub}</p>
                </div>
                <div className="actions">{paneActions}</div>
              </header>
              <main className="mjp-settings-content">
                <PaneActionsProvider value={setPaneActions}>
                  <Pane />
                </PaneActionsProvider>
              </main>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
