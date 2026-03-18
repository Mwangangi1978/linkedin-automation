import { useEffect, useMemo, useState } from 'react';
import { CircleHelp, Download, Link, Linkedin, Plus } from 'lucide-react';
import { createTrackedProfile, listTrackedProfiles, toggleProfileIntegration } from '../lib/api';
import type { TrackedProfile } from '../lib/models';
import { formatRelativeLabel, truncate } from '../lib/utils';

const intervalOptions = [
  { value: '2h', label: 'Every 2 hrs' },
  { value: '4h', label: 'Every 4 hrs' },
  { value: '6h', label: 'Every 6 hrs' },
  { value: '12h', label: 'Every 12 hrs' },
  { value: '1d', label: 'Every day' },
  { value: '2d', label: 'Every 2 days' },
  { value: '1w', label: 'Every week' },
  { value: '2w', label: 'Every 2 weeks' },
];

type HelpTextProps = {
  label: string;
  description: string;
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

export function TrackedProfilesPage() {
  const [rows, setRows] = useState<TrackedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profileUrl, setProfileUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [lookbackDays, setLookbackDays] = useState(7);
  const [maxPosts, setMaxPosts] = useState(25);
  const [notes, setNotes] = useState('');

  async function load() {
    setLoading(true);
    try {
      setRows(await listTrackedProfiles());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onAddProfile() {
    if (!profileUrl.trim()) {
      alert('Profile URL is required');
      return;
    }

    setSaving(true);
    try {
      await createTrackedProfile({
        profile_url: profileUrl.trim(),
        display_name: displayName.trim() || profileUrl.replace('https://www.linkedin.com/in/', ''),
        post_lookback_days: lookbackDays,
        max_posts_per_run: maxPosts,
        notes,
        is_active: true,
      });

      setProfileUrl('');
      setDisplayName('');
      setNotes('');
      await load();
    } catch (error) {
      alert(`Unable to save profile: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleState(row: TrackedProfile) {
    await toggleProfileIntegration(row.id, !row.is_active);
    await load();
  }

  const activeCount = useMemo(() => rows.filter((row) => row.is_active).length, [rows]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Tracked Profiles</h1>
          <span className="status-badge"><span className="dot" /> Synced</span>
        </div>
        <div className="topbar-right">
          <button className="btn btn-secondary"><Download size={14} /> Export CSV</button>
          <button className="btn btn-primary" onClick={onAddProfile} disabled={saving}><Plus size={14} /> Add Profile</button>
        </div>
      </header>

      <section className="page-shell">
        <div className="page-frame">
          <div className="hero-card">
            <div className="hero-copy">
              <div className="eyebrow">LinkedIn source management</div>
              <h2 className="hero-title">Tracked Profiles</h2>
              <p className="page-description">
                Add profile URLs, set lookback windows, and keep your scraping queue focused on relevant creators.
              </p>
            </div>
            <div className="hero-stats">
              <div className="mini-stat"><span className="mini-stat-label">Active profiles</span><span className="mini-stat-value">{activeCount}</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Avg interval</span><span className="mini-stat-value">4 hrs</span></div>
              <div className="mini-stat"><span className="mini-stat-label">Queue health</span><span className="mini-stat-value">Healthy</span></div>
            </div>
          </div>

          <div className="grid-shell">
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title-wrap">
                  <h3 className="panel-title">
                    <HelpText label="Add tracked profile" description="Create a source profile record for your scraping workflow." />
                  </h3>
                  <p className="panel-subtitle">
                    <HelpText label="Store LinkedIn URL, lookback days, and caps per run." description="This saves the profile URL, how far back to fetch posts, and how many posts to process each run." />
                  </p>
                </div>
                <div className="chip">
                  <Link size={12} />
                  <HelpText label="Source config" description="Core settings that define how this profile is scraped." />
                </div>
              </div>

              <div className="form-stack">
                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">
                      <HelpText label="Profile URL" description="The public LinkedIn profile link to monitor." />
                    </label>
                    <div className="field-surface">
                      <Linkedin size={16} className="field-icon" />
                      <input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://www.linkedin.com/in/username" aria-label="https://www.linkedin.com/in/username" />
                    </div>
                  </div>
                  <div className="field-group">
                    <label className="field-label">
                      <HelpText label="Lookback" description="How many recent days of posts to include when scraping this profile." />
                    </label>
                    <div className="field-surface">
                      <input type="number" min={1} max={90} value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))} />
                    </div>
                  </div>
                  <div className="field-group">
                    <label className="field-label">
                      <HelpText label="Max posts/run" description="The maximum number of posts to process from this profile in one pipeline run." />
                    </label>
                    <div className="field-surface">
                      <input type="number" min={1} max={500} value={maxPosts} onChange={(e) => setMaxPosts(Number(e.target.value))} />
                    </div>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">
                      <HelpText label="Display name" description="Friendly name shown in your dashboard and queue views." />
                    </label>
                    <div className="field-surface">
                      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Daniel Harper" />
                    </div>
                  </div>
                  <div className="field-group">
                    <label className="field-label">
                      <HelpText label="Notes" description="Optional context for this source, such as campaign or outreach segment." />
                    </label>
                    <div className="field-surface">
                      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Founder outreach list" />
                    </div>
                  </div>
                  <div className="field-group">
                    <label className="field-label">
                      <HelpText label="Presets" description="Quick interval defaults you can pick in hours, days, or weeks." />
                    </label>
                    <div className="field-surface">
                      <select defaultValue="4h">
                        {intervalOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="form-actions">
                  <p className="helper-text">
                    <HelpText label="Tip: weekly runs usually work best with 14-30 day lookback windows." description="If you run once per week, a 14-30 day lookback helps avoid missing posts between runs." />
                  </p>
                  <button className="btn btn-primary" onClick={onAddProfile} disabled={saving}><Plus size={14} /> Save profile</button>
                </div>
              </div>

              <div className="section-divider" />

              <div className="panel-header">
                <div className="panel-title-wrap">
                  <h3 className="panel-title">Current sources</h3>
                  <p className="panel-subtitle">Profiles currently monitored by the workflow.</p>
                </div>
                <div className="chip">{rows.length} total profiles</div>
              </div>

              <div className="table-wrap">
                <div className="table-head">
                  <div>Profile</div><div>URL</div><div>Lookback</div><div>Last sync</div><div>Integration</div>
                </div>
                {loading ? (
                  <div className="profile-row"><div className="profile-cell">Loading...</div></div>
                ) : rows.length === 0 ? (
                  <div className="profile-row"><div className="profile-cell">No tracked profiles yet.</div></div>
                ) : rows.map((row) => (
                  <div key={row.id} className="profile-row">
                    <div className="profile-cell">
                      <div className="profile-main">
                        <div className="avatar-placeholder">{(row.display_name ?? 'P').slice(0, 1).toUpperCase()}</div>
                        <div className="profile-name-wrap">
                          <div className="profile-name">{row.display_name ?? 'Unnamed profile'}</div>
                          <div className="profile-meta">Max posts/run: {row.max_posts_per_run}</div>
                        </div>
                      </div>
                    </div>
                    <div className="profile-cell url-text">{truncate(row.profile_url, 52)}</div>
                    <div className="profile-cell"><span className="interval-badge">{row.post_lookback_days} days</span></div>
                    <div className="profile-cell muted-copy">{formatRelativeLabel(row.last_scraped_at)}</div>
                    <div className="profile-cell">
                      <button className={`pill-status ${row.is_active ? 'active' : 'paused'}`} onClick={() => void toggleState(row)}>
                        <span className={`toggle ${row.is_active ? 'on' : ''}`} /> {row.is_active ? 'On' : 'Off'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="side-stack">
              <div className="panel">
                <div className="panel-title-wrap">
                  <h3 className="panel-title">
                    <HelpText label="Interval presets" description="Suggested monitoring cadences you can apply by account posting frequency." />
                  </h3>
                  <p className="panel-subtitle">
                    <HelpText label="Quick defaults for account activity levels." description="Pick a recommended interval based on how often a profile typically posts." />
                  </p>
                </div>
                <div className="summary-list">
                  <div className="summary-item"><span className="summary-label">High-volume creators</span><span className="summary-value">Every 2 days</span></div>
                  <div className="summary-item"><span className="summary-label">Founders & operators</span><span className="summary-value">Every 4 days</span></div>
                  <div className="summary-item"><span className="summary-label">Niche experts</span><span className="summary-value">Every week</span></div>
                  <div className="summary-item"><span className="summary-label">Low-frequency accounts</span><span className="summary-value">Every 2 weeks</span></div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title-wrap">
                  <h3 className="panel-title">Next scrape queue</h3>
                  <p className="panel-subtitle">Upcoming profiles by scrape priority.</p>
                </div>
                <div className="queue-list">
                  {rows.slice(0, 3).map((row) => (
                    <div key={row.id} className="queue-item">
                      <div className="queue-copy">
                        <div className="queue-title">{row.display_name ?? row.profile_url}</div>
                        <div className="queue-text">Lookback {row.post_lookback_days} days • max {row.max_posts_per_run} posts/run</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
