import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Banner, Btn, Card } from '../../ui/Primitives'

/* 桌面版读取实际应用版本；没有正式发布来源时不伪造更新检查结果。 */

export function AboutPane(): React.JSX.Element {
  const desktop = typeof window === 'undefined' ? undefined : window.mojingDesktop
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    void desktop?.getAppVersion().then(setVersion).catch(() => setVersion(''))
  }, [desktop])

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true)
    setFeedback(undefined)
    setError(undefined)
    try {
      const result = await action()
      if (result !== 'cancelled') setFeedback(success)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请重试。')
    } finally { setBusy(false) }
  }

  return (
    <>
      <Card icon={Info} title="版本与更新">
        <div className="mjp-rowline">
          <div><div className="lab">当前版本</div></div>
          <div>{version ? `v${version}` : desktop ? version === '' ? '暂不可用' : '读取中' : '桌面版可查看'}</div>
          <div />
        </div>
        <div className="mjp-rowline">
          <div><div className="lab">检查更新</div><div className="help">尚未开放；配置正式发布来源后可用</div></div>
          <div />
          <Btn size="sm" disabled>检查更新</Btn>
        </div>
      </Card>

      <Card icon={Info} title="诊断与缓存">
        <div className="mjp-rowline">
          <div><div className="lab">诊断信息</div><div className="help">导出版本、服务状态和项目数量，不包含正文或密钥</div></div>
          <div />
          <Btn size="sm" disabled={!desktop || busy} onClick={() => desktop && void run(() => desktop.exportDiagnostics(), '诊断信息已导出。')}>导出诊断信息</Btn>
        </div>
        <div className="mjp-rowline">
          <div><div className="lab">界面缓存</div><div className="help">清理页面缓存，不删除项目、密钥和偏好</div></div>
          <div />
          <Btn size="sm" disabled={!desktop || busy} onClick={() => desktop && void run(() => desktop.clearCache(), '界面缓存已清理。')}>清理界面缓存</Btn>
        </div>
        {!desktop && <p className="mjp-muted">以上操作在墨境桌面版中可用。</p>}
        {feedback && <Banner tone="info" title="操作完成">{feedback}</Banner>}
        {error && <Banner tone="danger" title="操作未完成">{error}</Banner>}
      </Card>
    </>
  )
}
