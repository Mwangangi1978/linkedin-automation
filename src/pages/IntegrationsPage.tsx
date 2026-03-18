import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createZapierHook,
  deleteZapierHook,
  listZapierHooks,
  updateZapierHook,
} from '../lib/api';
import type { ZapierHook } from '../lib/models';

type HookForm = {
  name: string;
  webhook_url: string;
  auth_header: string;
  api_key: string;
  lookback_days: number;
  is_active: boolean;
};

const defaultForm: HookForm = {
  name: '',
  webhook_url: '',
  auth_header: 'Authorization',
  api_key: '',
  lookback_days: 7,
  is_active: true,
};

const samplePayload = {
  first_name: 'Alex',
  last_name: 'Morgan',
  linkedin_url: 'https://www.linkedin.com/in/alexmorgan',
  lead_source: 'LinkedIn Comment Scraper',
  comment_text: 'Great post on outbound strategy.',
  source_post_url: 'https://www.linkedin.com/posts/example-post',
  source_leader_name: 'Daniel Harper',
  source_profile_url: 'https://www.linkedin.com/in/danielharper',
  date_discovered: new Date().toISOString(),
};

export function IntegrationsPage() {
  const [form, setForm] = useState<HookForm>(defaultForm);
  const [hooks, setHooks] = useState<ZapierHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setHooks(await listZapierHooks());
    } catch {
      setHooks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeHooks = useMemo(() => hooks.filter((hook) => hook.is_active).length, [hooks]);

  function setValue<Key extends keyof HookForm>(key: Key, value: HookForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.webhook_url.trim()) {
      alert('Hook name and webhook URL are required.');
      return;
    }

    setSaving(true);
    try {
      await createZapierHook({
        name: form.name.trim(),
        webhook_url: form.webhook_url.trim(),
        auth_header: form.auth_header.trim() || 'Authorization',
        api_key: form.api_key.trim() || null,
        lookback_days: form.lookback_days,
        is_active: form.is_active,
      });
      setForm(defaultForm);
      await load();
    } catch (error) {
      alert(`Unable to save Zapier hook: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function onToggleHook(hook: ZapierHook) {
    await updateZapierHook(hook.id, { is_active: !hook.is_active });
    await load();
  }

  async function onDeleteHook(id: string) {
    await deleteZapierHook(id);
    await load();
  }

  async function onSendTestPayload(hook: Pick<ZapierHook, 'webhook_url' | 'api_key' | 'auth_header'>) {
    const endpoint = hook.webhook_url.trim();
    const apiKey = hook.api_key?.trim() ?? '';
    const authHeader = hook.auth_header?.trim() || 'Authorization';

    setTesting(true);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };

      if (apiKey) {
        headers[authHeader] = authHeader.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(samplePayload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      alert('Test payload sent to Zapier. Check your Zap runs/history.');
    } catch (error) {
      alert(`Unable to send test payload: ${String(error)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Integrations</h1>
          <span className="status-badge"><span className="dot" /> {activeHooks > 0 ? `${activeHooks} active hooks` : 'No active hooks'}</span>
        </div>
      </header>

      <section className="page-shell">
        <form className="panel settings-form" onSubmit={onSave}>
          <div className="panel-title-wrap">
            <h2 className="panel-title">Zapier Hooks</h2>
            <p className="panel-subtitle">
              Add one or more Zapier webhooks. Each hook has its own lookback window used by the pipeline to decide which authors to send.
            </p>
          </div>

          <div className="field-grid-two">
            <label>
              Hook name
              <input
                value={form.name}
                onChange={(e) => setValue('name', e.target.value)}
                placeholder="Founders Zap"
                disabled={loading}
              />
            </label>

            <label>
              Lookback (days)
              <input
                type="number"
                min={1}
                max={90}
                value={form.lookback_days}
                onChange={(e) => setValue('lookback_days', Number(e.target.value))}
                disabled={loading}
              />
            </label>

            <label className="span-two">
              Zapier Webhook URL
              <input
                value={form.webhook_url}
                onChange={(e) => setValue('webhook_url', e.target.value)}
                placeholder="https://hooks.zapier.com/hooks/catch/..."
                disabled={loading}
              />
            </label>

            <label>
              API Key (optional)
              <input
                type="password"
                value={form.api_key}
                onChange={(e) => setValue('api_key', e.target.value)}
                placeholder="Optional"
                disabled={loading}
              />
            </label>

            <label>
              Auth Header
              <input
                value={form.auth_header}
                onChange={(e) => setValue('auth_header', e.target.value)}
                placeholder="Authorization"
                disabled={loading}
              />
            </label>
          </div>

          <div className="table-wrap">
            <div className="table-head">
              <div>Payload field</div><div>Example value</div><div>Description</div><div>Status</div><div>Type</div>
            </div>
            <div className="profile-row"><div className="profile-cell">linkedin_url</div><div className="profile-cell url-text">https://www.linkedin.com/in/alexmorgan</div><div className="profile-cell">Comment author profile URL</div><div className="profile-cell muted-copy">always</div><div className="profile-cell">string</div></div>
            <div className="profile-row"><div className="profile-cell">comment_text</div><div className="profile-cell url-text">Great post on outbound strategy.</div><div className="profile-cell">Comment body</div><div className="profile-cell muted-copy">when available</div><div className="profile-cell">string</div></div>
            <div className="profile-row"><div className="profile-cell">source_profile_url</div><div className="profile-cell url-text">https://www.linkedin.com/in/danielharper</div><div className="profile-cell">Tracked profile that produced the comment author</div><div className="profile-cell muted-copy">always</div><div className="profile-cell">string</div></div>
            <div className="profile-row"><div className="profile-cell">source_post_url</div><div className="profile-cell url-text">https://www.linkedin.com/posts/example-post</div><div className="profile-cell">Post where the author commented</div><div className="profile-cell muted-copy">when available</div><div className="profile-cell">string</div></div>
            <div className="profile-row"><div className="profile-cell">first_name / last_name</div><div className="profile-cell url-text">Alex / Morgan</div><div className="profile-cell">Parsed commenter names</div><div className="profile-cell muted-copy">when available</div><div className="profile-cell">string</div></div>
          </div>

          <div className="form-actions">
            <p className="helper-text">Each run sends authors discovered within each hook's lookback window, tracked per hook for retries and deduplication.</p>
            <div className="topbar-right">
              <button className="btn btn-primary" disabled={saving || loading}>{saving ? 'Saving...' : 'Add hook'}</button>
            </div>
          </div>

          <div className="section-divider" />

          <div className="table-wrap">
            <div className="table-head">
              <div>Name</div><div>Lookback</div><div>Endpoint</div><div>Status</div><div>Actions</div>
            </div>
            {hooks.length === 0 ? (
              <div className="profile-row"><div className="profile-cell">No Zapier hooks configured yet.</div></div>
            ) : hooks.map((hook) => (
              <div className="profile-row" key={hook.id}>
                <div className="profile-cell">{hook.name}</div>
                <div className="profile-cell"><span className="interval-badge">{hook.lookback_days} days</span></div>
                <div className="profile-cell url-text">{hook.webhook_url}</div>
                <div className="profile-cell">
                  <span className={`pill-status ${hook.is_active ? 'active' : 'paused'}`}>{hook.is_active ? 'active' : 'paused'}</span>
                </div>
                <div className="profile-cell topbar-right">
                  <button type="button" className="btn btn-secondary" onClick={() => void onSendTestPayload(hook)} disabled={testing}>Test</button>
                  <button type="button" className="btn btn-secondary" onClick={() => void onToggleHook(hook)}>{hook.is_active ? 'Pause' : 'Enable'}</button>
                  <button type="button" className="btn btn-secondary" onClick={() => void onDeleteHook(hook.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </form>
      </section>
    </>
  );
}
