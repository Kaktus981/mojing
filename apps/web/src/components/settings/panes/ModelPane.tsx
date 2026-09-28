import { Cpu } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ProviderConfigInput, ProviderConfigPublic } from '../../../../../../packages/contracts/src'
import { mojingClient } from '../../../api/mojingClient'
import { Banner, Btn, Card, Status, Tag } from '../../ui/Primitives'
import { DEFAULT_PROVIDER_FORM, LOOPBACK, ProviderConfigForm } from '../ProviderConfigForm'
import { usePaneActions } from '../PaneActions'

/* 「模型 API」栏。
 * 读写真实接口：GET /api/providers 取回已保存配置（后端返回的是
 * 不含 apiKey 的公开投影），PUT /api/providers 保存，POST /api/providers/test 探活。
 * 密钥旁路：前端只回传用户本次输入，不读取本机已保存的密钥明文。 */

type FormMessage = { tone: 'info' | 'ok' | 'error'; text: string }

export function ModelPane(): React.JSX.Element {
  const [form, setForm] = useState<ProviderConfigInput>(DEFAULT_PROVIDER_FORM)
  const [hasSavedKey, setHasSavedKey] = useState(false)
  const [savedCount, setSavedCount] = useState<number | null>(null)
  const [serviceOk, setServiceOk] = useState<boolean | null>(null)
  const [message, setMessage] = useState<FormMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback((): void => {
    setLoading(true)
    void Promise.allSettled([mojingClient.providers.list(), mojingClient.system.health()])
      .then(([providers, health]) => {
        if (providers.status === 'fulfilled') {
          const items: ProviderConfigPublic[] = providers.value
          setSavedCount(items.length)
          const item = items[0]
          if (item) {
            setForm({ ...item, apiKey: undefined })
            setHasSavedKey(item.hasApiKey)
          }
        } else {
          setSavedCount(null)
          setMessage({ tone: 'error', text: providers.reason instanceof Error ? providers.reason.message : String(providers.reason) })
        }
        setServiceOk(health.status === 'fulfilled' ? health.value.ok : false)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const patch = useCallback((value: Partial<ProviderConfigInput>): void => setForm((current) => ({ ...current, ...value })), [])

  const test = useCallback((): void => {
    setBusy(true)
    void mojingClient.providers
      .test(form)
      .then((result) => setMessage({ tone: result.ok ? 'ok' : 'error', text: `${result.message}${result.latencyMs ? `（${result.latencyMs}ms）` : ''}` }))
      .catch((error: unknown) => setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) }))
      .finally(() => setBusy(false))
  }, [form])

  const save = useCallback((): void => {
    setBusy(true)
    void mojingClient.providers
      .save(form)
      .then((saved) => {
        setForm({ ...saved, apiKey: undefined })
        setHasSavedKey(saved.hasApiKey)
        setSavedCount((current) => (current === null || current === 0 ? 1 : current))
        setMessage({ tone: 'ok', text: '模型配置已安全保存。' })
      })
      .catch((error: unknown) => setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) }))
      .finally(() => setBusy(false))
  }, [form])

  usePaneActions(
    <>
      <Btn size="sm" onClick={test} disabled={busy || loading}>{busy ? '测试中…' : '测试连接'}</Btn>
      <Btn size="sm" variant="primary" onClick={save} disabled={busy || loading}>保存配置</Btn>
    </>
  )

  return (
    <>
      <Card
        icon={Cpu}
        title="模型 API"
        headRight={
          serviceOk === null ? (
            <Tag tone="outline">检测中</Tag>
          ) : serviceOk ? (
            <Status tone="ok">本机服务可达</Status>
          ) : (
            <Status tone="danger">服务不可达</Status>
          )
        }
      >
        <p className="mjp-modal-note">
          密钥仅保存在本机，不会写入项目或导出文件。测试连接会发起一次模型调用。
        </p>

        {loading ? <p className="mjp-hint">正在读取已保存的模型配置…</p> : null}

        <ProviderConfigForm value={form} onChange={patch} hasSavedKey={hasSavedKey} disabled={busy || loading} />

        {message ? (
          <p className={`mjp-form-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
        {savedCount === 1 && !hasSavedKey && !LOOPBACK.test(form.baseUrl) ? (
          <Banner tone="warn" title="当前配置没有可用密钥">
            已保存的配置没有密钥。若非本机服务，请重新输入 API Key 后保存。
          </Banner>
        ) : null}
      </Card>

    </>
  )
}
