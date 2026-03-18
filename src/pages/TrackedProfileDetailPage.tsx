import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { getTrackedProfile, triggerRun, toggleProfileIntegration } from '../lib/api';
import type { TrackedProfile } from '../lib/models';
import { formatRelativeLabel } from '../lib/utils';

type RunSummary = {
  profilesProcessed: number;
  postsFound: number;
  newPostsScraped: number;
  commentsCollected: number;
  newUniqueAuthors: number;
  crmPushesSucceeded: number;
  crmPushesFailed: number;
};

export function TrackedProfileDetailPage() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<TrackedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  async function load() {
    if (!profileId) {
      return;
    }

    setLoading(true);
    try {
      const data = await getTrackedProfile(profileId);
      setProfile(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profileId]);

  async function onToggleAutomation() {
    if (!profile) {
      return;
    }

    const nextEnabled = !profile.is_active;
    setToggling(true);

    try {
      await toggleProfileIntegration(profile.id, nextEnabled);
      const updatedProfile = { ...profile, is_active: nextEnabled };
      setProfile(updatedProfile);

      if (nextEnabled) {
        setRunning(true);
        try {
          const runResult = await triggerRun('manual', profile.id);
          if (runResult?.summary) {
            setSummary(runResult.summary as RunSummary);
          }
          alert('Automation enabled and scrape started for this profile.');
        } finally {
          setRunning(false);
        }

        await load();
      } else {
        setSummary(null);
        alert('Automation paused for this profile.');
      }
    } catch (error) {
      alert(`Unable to update automation: ${String(error)}`);
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <section className="page-shell">
        <div className="panel">
          <p className="panel-subtitle">Loading profile...</p>
        </div>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="page-shell">
        <div className="panel">
          <p className="panel-subtitle">Profile not found.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/tracked-profiles')}>
            <ArrowLeft size={14} /> Back to tracked profiles
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Profile Automation</h1>
          <span className="status-badge"><span className="dot" /> {profile.is_active ? 'Active' : 'Paused'}</span>
        </div>
        <div className="topbar-right">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCcw size={14} /> Refresh
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/tracked-profiles')}>
            <ArrowLeft size={14} /> Back
          </button>
        </div>
      </header>

      <section className="page-shell">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="panel-title">{profile.display_name ?? 'Unnamed profile'}</h2>
              <p className="panel-subtitle">
                <a href={profile.profile_url} target="_blank" rel="noreferrer" className="profile-link">
                  {profile.profile_url}
                </a>
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <div className="table-head">
              <div>Profile</div><div>URL</div><div>Lookback</div><div>Last sync</div><div>Integration</div>
            </div>
            <div className="profile-row">
              <div className="profile-cell">
                <div className="profile-main">
                  <div className="avatar-placeholder">{(profile.display_name ?? 'P').slice(0, 1).toUpperCase()}</div>
                  <div className="profile-name-wrap">
                    <div className="profile-name">{profile.display_name ?? 'Unnamed profile'}</div>
                    <div className="profile-meta">Max posts/run: {profile.max_posts_per_run}</div>
                  </div>
                </div>
              </div>
              <div className="profile-cell url-text">{profile.profile_url}</div>
              <div className="profile-cell"><span className="interval-badge">{profile.post_lookback_days} days</span></div>
              <div className="profile-cell muted-copy">{formatRelativeLabel(profile.last_scraped_at)}</div>
              <div className="profile-cell">
                <button
                  className={`pill-status ${profile.is_active ? 'active' : 'paused'}`}
                  onClick={() => void onToggleAutomation()}
                  disabled={toggling || running}
                >
                  <span className={`toggle ${profile.is_active ? 'on' : ''}`} /> {profile.is_active ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          </div>
          <p className="helper-text">
            {running ? 'Scraper is running for this profile...' : profile.is_active ? 'Automation is enabled for this profile.' : 'Automation is paused for this profile.'}
          </p>
        </div>

        {summary ? (
          <div className="panel">
            <div className="panel-title-wrap">
              <h2 className="panel-title">Latest scrape result</h2>
              <p className="panel-subtitle">Returned after enabling automation for this profile.</p>
            </div>
            <div className="summary-grid">
              <div><span>Profiles</span><strong>{summary.profilesProcessed}</strong></div>
              <div><span>Posts found</span><strong>{summary.postsFound}</strong></div>
              <div><span>New posts</span><strong>{summary.newPostsScraped}</strong></div>
              <div><span>Comments</span><strong>{summary.commentsCollected}</strong></div>
              <div><span>New authors</span><strong>{summary.newUniqueAuthors}</strong></div>
              <div><span>CRM pushed</span><strong>{summary.crmPushesSucceeded}</strong></div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
