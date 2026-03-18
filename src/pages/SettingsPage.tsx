import { CircleHelp } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { getSettings, saveSettings } from '../lib/api';
import type { SystemConfig } from '../lib/models';
import type { ReactNode } from 'react';

const defaultState: Partial<SystemConfig> = {
  apify_token: '',
  linkedin_cookies: '',
  linkedin_user_agent: '',
  proxy_country: 'US',
  apify_comment_sort_type: 'RELEVANCE',
  apify_min_delay: 2,
  apify_max_delay: 7,
};

type HelpTextProps = {
  label: string;
  description: ReactNode;
};

function HelpText({ label, description }: HelpTextProps) {
  return (
    <span className="label-with-help">
      <span>{label}</span>
      <span className="help-trigger" tabIndex={0} aria-label={`${label} help`}>
        <CircleHelp size={14} />
        <span className="help-bubble" role="tooltip">{description}</span>
      </span>
    </span>
  );
}

export function SettingsPage() {
  const [form, setForm] = useState<Partial<SystemConfig>>(defaultState);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((settings) => setForm({ ...settings, proxy_country: 'US' }))
      .catch(() => setForm(defaultState));
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
        proxy_country: 'US',
        apify_comment_sort_type: form.apify_comment_sort_type ?? 'RELEVANCE',
        apify_min_delay: Math.max(2, form.apify_min_delay ?? 2),
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
            <h2 className="panel-title">
              <HelpText
                label="Apify Configuration"
                description="Configuration values used by the pipeline to scrape posts and comments from tracked LinkedIn profiles."
              />
            </h2>
            <p className="panel-subtitle">
              <HelpText
                label="Insert your Apify API token here. The pipeline reads these values to run profile post scraping and comment scraping. Zapier connection settings are managed in Integrations."
                description="These settings control Apify authentication and scraper behavior. Zapier webhook setup stays in Integrations."
              />
            </p>
          </div>

          <div className="field-grid-two">
            <label>
              <HelpText label="Apify API Token" description="Your Apify API token used to authenticate profile and comment scraping actor calls." />
              <input type="password" value={form.apify_token ?? ''} onChange={(e) => setValue('apify_token', e.target.value)} />
            </label>

            <label>
              <HelpText label="User Agent" description="Browser user-agent string sent with LinkedIn requests." />
              <input value={form.linkedin_user_agent ?? ''} onChange={(e) => setValue('linkedin_user_agent', e.target.value)} placeholder="user agent" />
              <a
                className="btn btn-secondary settings-helper-link"
                href="https://www.google.com/search?q=my+user+agent"
                target="_blank"
                rel="noreferrer"
              >
                Click here to get your user agent
              </a>
            </label>

            <label>
              <HelpText label="Proxy Country" description="Currently fixed to US. Additional countries are not enabled yet." />
              <input value="US" disabled readOnly />
            </label>

            <label>
              <HelpText label="Comment Sort Type" description="Order of scraped comments returned by the actor: RELEVANCE or RECENT." />
              <select value={form.apify_comment_sort_type ?? 'RELEVANCE'} onChange={(e) => setValue('apify_comment_sort_type', e.target.value as 'RECENT' | 'RELEVANCE')}>
                <option value="RELEVANCE">RELEVANCE</option>
                <option value="RECENT">RECENT</option>
              </select>
            </label>

            <label>
              <HelpText label="Min Delay (seconds)" description="Minimum wait time between requests to reduce request burst behavior." />
              <input type="number" min={2} value={form.apify_min_delay ?? 2} onChange={(e) => setValue('apify_min_delay', Math.max(2, Number(e.target.value)))} />
            </label>

            <label>
              <HelpText label="Max Delay (seconds)" description="Maximum wait time between requests for randomized pacing." />
              <input type="number" min={0} value={form.apify_max_delay ?? 7} onChange={(e) => setValue('apify_max_delay', Number(e.target.value))} />
            </label>

            <label className="span-two">
              <HelpText
                label="Cookies"
                description={(
                  <>
                    Cookies are used to authorize the actor with linkedin.com
                    <br />
                    <br />
                    Follow these steps to get the cookies:
                    <br />
                    Install Cookie-Editor chrome extension
                    <br />
                    Login to your linkedin.com account
                    <br />
                    Click on the extension and export the linkedin cookies
                    <br />
                    Paste the copied contents here
                    <br />
                    Video - How to get cookies (https://youtu.be/YuKp9BlVgNM?si=jvfeuBLSaw8Am_2K)
                    <br />
                    <br />
                    JSON field name: cookies
                  </>
                )}
              />
              <textarea value={form.linkedin_cookies ?? ''} onChange={(e) => setValue('linkedin_cookies', e.target.value)} rows={4} />
              <a
                className="btn btn-secondary settings-helper-link"
                href="https://youtu.be/YuKp9BlVgNM?si=jvfeuBLSaw8Am_2K"
                target="_blank"
                rel="noreferrer"
              >
                Video - How to get cookies
              </a>
            </label>
          </div>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
        </form>
      </section>
    </>
  );
}
