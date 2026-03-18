import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getSettings, saveSettings } from '../lib/api';
import type { SystemConfig } from '../lib/models';

const defaultForm: Partial<SystemConfig> = {
  crm_endpoint: '',
  crm_api_key: '',
  crm_auth_header: 'Authorization',
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
  const [form, setForm] = useState<Partial<SystemConfig>>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getSettings()
      .then((settings) => setForm(settings))
      .catch(() => setForm(defaultForm))
      .finally(() => setLoading(false));
  }, []);

  const isConnected = useMemo(() => Boolean(form.crm_endpoint?.trim()), [form.crm_endpoint]);

  function setValue<Key extends keyof SystemConfig>(key: Key, value: SystemConfig[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveSettings({
        crm_endpoint: form.crm_endpoint?.trim() ?? '',
        crm_api_key: form.crm_api_key?.trim() ?? '',
        crm_auth_header: form.crm_auth_header?.trim() || 'Authorization',
      });
      alert('Zapier integration saved. New scraped comment authors will be delivered to this webhook.');
    } catch (error) {
      alert(`Unable to save Zapier integration: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function onSendTestPayload() {
    const endpoint = form.crm_endpoint?.trim();
    const apiKey = form.crm_api_key?.trim();
    const authHeader = form.crm_auth_header?.trim() || 'Authorization';

    if (!endpoint) {
      alert('Add a Zapier webhook URL first.');
      return;
    }

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
          <span className="status-badge"><span className="dot" /> {isConnected ? 'Connected' : 'Not connected'}</span>
        </div>
      </header>

      <section className="page-shell">
        <form className="panel settings-form" onSubmit={onSave}>
          <div className="panel-title-wrap">
            <h2 className="panel-title">Zapier Integration</h2>
            <p className="panel-subtitle">
              Connect a Zapier webhook to receive scraped comment authors and source profile URLs via API.
            </p>
          </div>

          <div className="field-grid-two">
            <label className="span-two">
              Zapier Webhook URL
              <input
                value={form.crm_endpoint ?? ''}
                onChange={(e) => setValue('crm_endpoint', e.target.value)}
                placeholder="https://hooks.zapier.com/hooks/catch/..."
                disabled={loading}
              />
            </label>

            <label>
              API Key (optional)
              <input
                type="password"
                value={form.crm_api_key ?? ''}
                onChange={(e) => setValue('crm_api_key', e.target.value)}
                placeholder="Optional"
                disabled={loading}
              />
            </label>

            <label>
              Auth Header
              <input
                value={form.crm_auth_header ?? 'Authorization'}
                onChange={(e) => setValue('crm_auth_header', e.target.value)}
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
            <p className="helper-text">Once saved, every new scraped comment author is automatically sent to your Zapier endpoint from the run pipeline.</p>
            <div className="topbar-right">
              <button type="button" className="btn btn-secondary" onClick={onSendTestPayload} disabled={testing || loading}>
                {testing ? 'Sending...' : 'Send test payload'}
              </button>
              <button className="btn btn-primary" disabled={saving || loading}>{saving ? 'Saving...' : 'Save integration'}</button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}
