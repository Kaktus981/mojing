import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROVIDER_FORM } from '../ProviderConfigForm'

vi.mock('../../../api/mojingClient', () => ({ mojingClient: {} }))

const { ModelPane } = await import('./ModelPane')

const modelState = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: <T,>(initial: T): [T, (value: T) => void] => {
      const index = modelState.index++
      return [index in modelState.values ? modelState.values[index] as T : initial, () => undefined]
    }
  }
})

describe('模型 API 状态', () => {
  it('本机 API 可达时不将未经测试的模型标成已连接', () => {
    // ModelPane state order: form, saved key, count, local service, message, busy, loading.
    modelState.index = 0
    modelState.values = [DEFAULT_PROVIDER_FORM, false, 1, true, null, false, false]

    const html = renderToStaticMarkup(<ModelPane />)

    expect(html).toContain('本机服务可达')
    expect(html).not.toContain('>已连接<')
  })

  it('本机回环模型未填写密钥时不显示缺密钥警告', () => {
    modelState.index = 0
    modelState.values = [{ ...DEFAULT_PROVIDER_FORM, baseUrl: 'http://localhost:54671/v1' }, false, 1, true, null, false, false]

    const html = renderToStaticMarkup(<ModelPane />)

    expect(html).toContain('本机模型可留空')
    expect(html).not.toContain('当前配置没有可用密钥')
  })
})
