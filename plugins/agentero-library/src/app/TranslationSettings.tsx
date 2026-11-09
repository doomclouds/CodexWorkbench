import { useEffect, useState } from 'react';
import type { TranslationSettings as Configuration } from '../contracts/translation';
import { callTool } from './api';
import { messageOf } from './model';

export function TranslationSettings({ preview }: { preview: boolean }) {
  const [value, setValue] = useState<Configuration>({ provider: 'cli', baseUrl: '', model: '', targetLanguage: 'zh-CN', hasApiKey: false });
  const [key, setKey] = useState(''); const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => {
    if (preview) return; let cancelled = false;
    void callTool<Configuration>('translation_settings_read').then(data => { if (!cancelled) setValue(data); }).catch(reason => { if (!cancelled) setError(messageOf(reason)); });
    return () => { cancelled = true; };
  }, [preview]);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try { setValue(await callTool<Configuration>('translation_settings_update', { set: { provider: value.provider, baseUrl: value.baseUrl, model: value.model, targetLanguage: value.targetLanguage, ...(key ? { apiKey: key } : {}), clearApiKey: clearKey } })); setKey(''); setClearKey(false); setNotice('翻译设置已保存。'); }
    catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }
  return <section className="settings-section">
    <h3>选区与全文翻译</h3>
    <label htmlFor="translation-provider">翻译方式</label>
    <select id="translation-provider" value={value.provider} disabled={busy} onChange={e => setValue({ ...value, provider: e.target.value as Configuration['provider'] })}><option value="cli">Agentero 文本翻译</option><option value="openai">OpenAI 兼容模型服务</option></select>
    <label htmlFor="translation-language">默认目标语言</label><input id="translation-language" value={value.targetLanguage} disabled={busy} onChange={e => setValue({ ...value, targetLanguage: e.target.value })} />
    {value.provider === 'openai' && <>
      <label htmlFor="translation-url">API 服务地址</label><input id="translation-url" value={value.baseUrl} placeholder="https://你的服务地址/v1" disabled={busy} onChange={e => setValue({ ...value, baseUrl: e.target.value })} />
      <label htmlFor="translation-model">模型</label><input id="translation-model" value={value.model} disabled={busy} onChange={e => setValue({ ...value, model: e.target.value })} />
      <label htmlFor="translation-key">API Key</label><input id="translation-key" type="password" autoComplete="off" value={key} placeholder={value.hasApiKey ? '已保存；留空保留原值' : '本地模型无需凭据时可留空'} disabled={busy} onChange={e => setKey(e.target.value)} />
      {value.hasApiKey && <label className="checkbox-row"><input type="checkbox" checked={clearKey} disabled={busy} onChange={e => setClearKey(e.target.checked)} />清除已保存的 API Key</label>}
    </>}
    <p className="field-help">仅在你主动翻译时，将所选文字／段落发送到对应服务。密钥只保存在本机，不进入论文或对话；后台翻译不会使用 Codex 登录态。</p>
    <button disabled={busy || preview} onClick={() => void save()}>{busy ? '正在保存…' : '保存翻译设置'}</button>
    {error && <p className="error-text" role="alert">{error}</p>}{notice && <p className="success-text" role="status">{notice}</p>}
  </section>;
}
