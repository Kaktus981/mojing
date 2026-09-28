import type { ProviderConfigInput } from '../../../../../packages/contracts/src'

/* 模型服务配置表单（受控）：只在应用设置中心使用。
 * 组件负责渲染与回传补丁，测试连接和保存由设置页处理。 */

/** 本机回环地址：这些地址上的模型服务无需 API Key。 */
export const LOOPBACK = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i

export const DEFAULT_PROVIDER_FORM: ProviderConfigInput = {
  name: 'OpenAI 兼容模型',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5',
  contextWindow: 128000,
  supportsStreaming: true,
  supportsJsonSchema: true,
  currency: 'CNY',
  showCost: false
}

type ProviderConfigFormProps = {
  value: ProviderConfigInput
  onChange: (patch: Partial<ProviderConfigInput>) => void
  /** 后端是否已保存密钥：决定 API Key 输入框的标签与占位文案。 */
  hasSavedKey: boolean
  disabled?: boolean
}

export function ProviderConfigForm({ value, onChange, hasSavedKey, disabled }: ProviderConfigFormProps): React.JSX.Element {
  const isLoopback = LOOPBACK.test(value.baseUrl)
  return (
    <div className="mjp-form-grid">
      <label className="mjp-field full">
        <span className="lbl">{hasSavedKey ? 'API Key（已保存）' : 'API Key'}</span>
        <input
          className="mjp-input"
          type="password"
          value={value.apiKey ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder={hasSavedKey ? '留空表示继续使用已保存的密钥' : isLoopback ? '本机模型可留空' : '请重新输入 API Key'}
        />
      </label>
      <label className="mjp-field full">
        <span className="lbl">Base URL</span>
        <input className="mjp-input" value={value.baseUrl} disabled={disabled} onChange={(event) => onChange({ baseUrl: event.target.value })} />
      </label>
      <label className="mjp-field full">
        <span className="lbl">模型名称</span>
        <input className="mjp-input" value={value.model} disabled={disabled} onChange={(event) => onChange({ model: event.target.value })} />
      </label>
      {isLoopback ? (
        <p className="mjp-inline-note full">本机模型服务可以不填写 API Key。</p>
      ) : null}
      <details className="mjp-settings-advanced full">
        <summary>高级设置</summary>
        <div className="mjp-settings-advanced-body mjp-form-grid">
          <label className="mjp-field">
            <span className="lbl">配置名称</span>
            <input className="mjp-input" value={value.name} disabled={disabled} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <label className="mjp-field">
            <span className="lbl">上下文窗口</span>
            <input className="mjp-input" type="number" min={4096} max={2000000} value={value.contextWindow} disabled={disabled} onChange={(event) => onChange({ contextWindow: Number(event.target.value) })} />
          </label>
          <label className="mjp-check full">
            <input type="checkbox" checked={value.supportsStreaming} disabled={disabled} onChange={(event) => onChange({ supportsStreaming: event.target.checked })} />
            支持流式输出（长任务推荐）
          </label>
          <label className="mjp-check full">
            <input type="checkbox" checked={value.supportsJsonSchema} disabled={disabled} onChange={(event) => onChange({ supportsJsonSchema: event.target.checked })} />
            支持结构化输出（JSON Schema）
          </label>
          <label className="mjp-field">
            <span className="lbl">默认单次输出上限</span>
            <input className="mjp-input" type="number" min={256} max={200000} step={1000} aria-label="默认单次输出上限" value={value.maxOutputTokens ?? ''} disabled={disabled} placeholder="留空则使用默认 16000" onChange={(event) => onChange({ maxOutputTokens: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </label>
          <label className="mjp-field">
            <span className="lbl">输出上限参数</span>
            <select className="mjp-select" aria-label="输出上限参数" value={value.outputTokenParameter ?? 'auto'} disabled={disabled} onChange={(event) => onChange({ outputTokenParameter: event.target.value as ProviderConfigInput['outputTokenParameter'] })}>
              <option value="auto">自动（推荐）</option>
              <option value="max_completion_tokens">max_completion_tokens</option>
              <option value="max_tokens">max_tokens</option>
            </select>
          </label>
          <p className="mjp-inline-note full">若模型不支持所选的输出上限参数，墨境会提示调整。</p>
        </div>
      </details>
    </div>
  )
}
