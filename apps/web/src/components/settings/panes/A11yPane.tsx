import { Accessibility } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Btn, Card, Segmented, Switch } from '../../ui/Primitives'
import { useAppearance } from '../../shell/useTheme'
import { readZoomLevel, setZoomLevel, type ZoomLevel } from '../zoomPreference'

/* 「缩放与可访问性」栏。
 *
 * 缩放通过桌面桥接调整当前窗口，偏好保存在本机并在启动时恢复。
 * 浏览器预览没有桌面桥接时，控件禁用并如实说明。 */

const ZOOM_OPTIONS: readonly { value: ZoomLevel; label: string }[] = [
  { value: '100', label: '100%' },
  { value: '125', label: '125%' },
  { value: '150', label: '150%' }
]

export function A11yPane(): React.JSX.Element {
  const { motion, setMotion } = useAppearance()
  const [zoom, setZoom] = useState<ZoomLevel>(readZoomLevel)
  const [zoomBusy, setZoomBusy] = useState(false)
  const [zoomError, setZoomError] = useState<string>()
  const zoomAvailable = typeof window !== 'undefined' && Boolean(window.mojingDesktop)

  const changeZoom = useCallback((level: ZoomLevel): void => {
    setZoomBusy(true)
    setZoomError(undefined)
    void setZoomLevel(level)
      .then(() => setZoom(level))
      .catch((error: unknown) => setZoomError(error instanceof Error ? error.message : '缩放失败，请重试。'))
      .finally(() => setZoomBusy(false))
  }, [])

  const reset = useCallback((): void => {
    setMotion(true)
    if (zoomAvailable && zoom !== '100') changeZoom('100')
  }, [changeZoom, setMotion, zoom, zoomAvailable])

  return (
    <>
      <Card
        icon={Accessibility}
        title="缩放与动效"
        headRight={<Btn size="sm" onClick={reset} disabled={motion && zoom === '100'}>恢复默认</Btn>}
      >
        <div className="mjp-rowline">
          <div>
            <div className="lab">界面缩放</div>
            <div className="help">调整应用界面的显示大小</div>
          </div>
          <div>
            <Segmented value={zoom} options={ZOOM_OPTIONS} onChange={changeZoom} disabled={!zoomAvailable || zoomBusy} />
            {!zoomAvailable && <p className="mjp-hint is-warn" style={{ marginTop: 6 }}>界面缩放仅在墨境桌面版可用。</p>}
            {zoomError && <p className="mjp-hint is-warn" role="alert" style={{ marginTop: 6 }}>{zoomError}</p>}
          </div>
          <div />
        </div>

        <div className="mjp-rowline">
          <div>
            <div className="lab">减少动效</div>
            <div className="help">减少页面切换时的动画</div>
          </div>
          <div>
            <Switch checked={!motion} onChange={(reduce) => setMotion(!reduce)} label={motion ? '正常动效' : '已减少动效'} />
          </div>
          <div />
        </div>

      </Card>
    </>
  )
}
