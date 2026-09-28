import { Moon } from 'lucide-react'
import { useCallback } from 'react'
import { Btn, Card, Segmented } from '../../ui/Primitives'
import type { MojingFont, MojingThemeMode } from '../../shell/useTheme'
import { useAppearance } from '../../shell/useTheme'

/** 主题与正文字体写入共用的外观偏好，修改后立即生效。 */

const THEME_OPTIONS: readonly { value: MojingThemeMode; label: string }[] = [
  { value: 'paper', label: '日间' },
  { value: 'night', label: '夜间' },
  { value: 'system', label: '跟随系统' }
]

const FONT_OPTIONS: readonly { value: MojingFont; label: string }[] = [
  { value: 'system', label: '系统默认' },
  { value: 'serif', label: '宋体优先' },
  { value: 'sans', label: '无衬线' }
]

export function ThemePane(): React.JSX.Element {
  const { mode, font, setMode, setFont } = useAppearance()

  const reset = useCallback((): void => {
    setMode('paper')
    setFont('serif')
  }, [setMode, setFont])

  return (
    <>
      <Card
        icon={Moon}
        title="主题与字体"
        headRight={<Btn size="sm" onClick={reset}>恢复默认</Btn>}
      >
        <div className="mjp-rowline">
          <div>
            <div className="lab">主题</div>
            <div className="help">日间暖纸 / 夜间深墨绿灰 / 跟随系统深色偏好</div>
          </div>
          <div>
            <Segmented value={mode} options={THEME_OPTIONS} onChange={setMode} />
          </div>
          <div />
        </div>

        <div className="mjp-rowline">
          <div>
            <div className="lab">正文字体</div>
            <div className="help">只影响小说正文（编辑器正文区），不改界面字体</div>
          </div>
          <div>
            <Segmented value={font} options={FONT_OPTIONS} onChange={setFont} />
            <p className="mjp-prose-preview" style={{ fontFamily: 'var(--font-prose)' }}>
              预览：月光落在青石板上，风从巷口穿过，吹动了门楣上褪色的红纸。
            </p>
          </div>
          <div />
        </div>
      </Card>

    </>
  )
}
