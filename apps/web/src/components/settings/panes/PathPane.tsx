import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNovelStore } from '../../../novelStore'
import { Banner, Btn, Card } from '../../ui/Primitives'

/** 桌面版分别迁移项目数据与缓存日志；切换均在重启后生效。 */
export function PathPane(): React.JSX.Element {
  const project = useNovelStore((state) => state.project)
  const persistNow = useNovelStore((state) => state.persistNow)
  const [dataDirectory, setDataDirectory] = useState<string>()
  const [supportDirectory, setSupportDirectory] = useState<string>()
  const [pathBusy, setPathBusy] = useState(false)
  const [supportBusy, setSupportBusy] = useState(false)
  const [pathError, setPathError] = useState<string>()
  const [supportError, setSupportError] = useState<string>()
  const desktop = typeof window === 'undefined' ? undefined : window.mojingDesktop

  useEffect(() => {
    void desktop?.getDataDirectory().then(setDataDirectory).catch((error: unknown) => {
      setPathError(error instanceof Error ? error.message : '读取数据目录失败。')
    })
    void desktop?.getSupportDirectory().then(setSupportDirectory).catch((error: unknown) => {
      setSupportError(error instanceof Error ? error.message : '读取缓存与日志目录失败。')
    })
  }, [desktop])

  const moveData = useCallback((): void => {
    if (!desktop) return
    setPathBusy(true)
    setPathError(undefined)
    void (async () => {
      if (project && !await persistNow()) throw new Error('当前项目尚未保存，已取消目录迁移。')
      await desktop.chooseDataDirectory()
    })().catch((error: unknown) => {
      setPathError(error instanceof Error ? error.message : '目录迁移未开始。')
    }).finally(() => setPathBusy(false))
  }, [desktop, persistNow, project])

  const moveSupport = useCallback((): void => {
    if (!desktop) return
    setSupportBusy(true)
    setSupportError(undefined)
    void (async () => {
      if (project && !await persistNow()) throw new Error('当前项目尚未保存，已取消目录迁移。')
      await desktop.chooseSupportDirectory()
    })().catch((error: unknown) => {
      setSupportError(error instanceof Error ? error.message : '缓存与日志目录迁移未开始。')
    }).finally(() => setSupportBusy(false))
  }, [desktop, persistNow, project])

  return (
    <>
      <Card icon={FolderOpen} title="存储位置">
        <div className="mjp-rowline">
          <div><div className="lab">项目数据</div><div className="help">复制并核对后重启切换；原目录保留</div></div>
          <div className="mjp-path">{desktop ? dataDirectory ?? '正在读取…' : '桌面版可管理'}</div>
          <div>{desktop && <Btn size="sm" disabled={pathBusy || !dataDirectory} onClick={moveData}>{pathBusy ? '准备中…' : '选择目录并重启'}</Btn>}</div>
        </div>
        {pathError && <Banner tone="danger" title="数据目录操作未完成">{pathError}</Banner>}
        <div className="mjp-rowline">
          <div><div className="lab">缓存与日志</div><div className="help">重启后切换；保留旧日志，缓存重新生成</div></div>
          <div className="mjp-path">{desktop ? supportDirectory ?? '正在读取…' : '桌面版可管理'}</div>
          <div>{desktop && <Btn size="sm" disabled={supportBusy || !supportDirectory} onClick={moveSupport}>{supportBusy ? '准备中…' : '选择目录并重启'}</Btn>}</div>
        </div>
        {supportError && <Banner tone="danger" title="缓存与日志目录操作未完成">{supportError}</Banner>}
      </Card>
    </>
  )
}
