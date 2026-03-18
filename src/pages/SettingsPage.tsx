import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { getSettings, saveSettings } from '../lib/api';
import type { SystemConfig } from '../lib/models';

const defaultState: Partial<SystemConfig> = {
  apify_token: '',
  linkedin_cookies: '',
  linkedin_user_agent: '',
  proxy_country: '',
  apify_comment_sort_type: 'RELEVANCE',
  apify_min_delay: 2,
  apify_max_delay: 7,
};

export function SettingsPage() {
  const [form, setForm] = useState<Partial<SystemConfig>>(defaultState);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings().then(setForm).catch(() => setForm(defaultState));
  }, []);

  function setValue<Key extends keyof SystemConfig>(key: Key, value: SystemConfig[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveSettings({
        apify_token: form.apify_token ?? '',
        linkedin_user_agent: form.linkedin_user_agent ?? '',
        proxy_country: form.proxy_country ?? '',
        apify_comment_sort_type: form.apify_comment_sort_type ?? 'RELEVANCE',
        apify_min_delay: form.apify_min_delay ?? 2,
        apify_max_delay: form.apify_max_delay ?? 7,
        linkedin_cookies: form.linkedin_cookies ?? '',
      });
      alert('Settings saved.');
    } catch (error) {
      alert(`Unable to save settings: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Settings</h1>
          <span className="status-badge"><span className="dot" /> Config</span>
        </div>
      </header>

      <section className="page-shell">
        <form className="panel settings-form" onSubmit={onSave}>
          <div className="panel-title-wrap">
            <h2 className="panel-title">Apify Configuration</h2>
            <p className="panel-subtitle">
              Insert your Apify API token here. The pipeline reads these values to run
              profile post scraping and comment scraping. Zapier connection settings are
              managed in Integrations.
            </p>
          </div>

          <div className="field-grid-two">
            <label>Apify API Token<input type="password" value={form.apify_token ?? ''} onChange={(e) => setValue('apify_token', e.target.value)} /></label>
            <label>LinkedIn User Agent<input value={form.linkedin_user_agent ?? ''} onChange={(e) => setValue('linkedin_user_agent', e.target.value)} /></label>
            <label>Proxy Country<input value={form.proxy_country ?? ''} onChange={(e) => setValue('proxy_country', e.target.value)} placeholder="US" /></label>
            <label>Comment Sort Type
              <select value={form.apify_comment_sort_type ?? 'RELEVANCE'} onChange={(e) => setValue('apify_comment_sort_type', e.target.value as 'RECENT' | 'RELEVANCE')}>
                <option value="RELEVANCE">RELEVANCE</option>
                <option value="RECENT">RECENT</option>
              </select>
            </label>
            <label>Min Delay (seconds)<input type="number" min={0} value={form.apify_min_delay ?? 2} onChange={(e) => setValue('apify_min_delay', Number(e.target.value))} /></label>
            <label>Max Delay (seconds)<input type="number" min={0} value={form.apify_max_delay ?? 7} onChange={(e) => setValue('apify_max_delay', Number(e.target.value))} /></label>
            <label className="span-two">LinkedIn Cookies<textarea value={form.linkedin_cookies ?? ''} onChange={(e) => setValue('linkedin_cookies', e.target.value)} rows={4} /></label>
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
        </form>
      </section>
    </>
  );
}
