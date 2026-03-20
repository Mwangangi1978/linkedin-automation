import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { getLatestRunForProfile, getSettings, getTrackedProfile, triggerRun, toggleProfileIntegration } from '../lib/api';
import type { ScrapeRun, SystemConfig, TrackedProfile } from '../lib/models';
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
  const [latestRun, setLatestRun] = useState<ScrapeRun | null>(null);
  const [settings, setSettings] = useState<Pick<SystemConfig, 'schedule_enabled' | 'default_schedule'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshingRun, setRefreshingRun] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  async function load() {
    if (!profileId) {
      return;
    }

    setLoading(true);
    setActionError(null);
    try {
      const [dataResult, runResult, configResult] = await Promise.allSettled([
        getTrackedProfile(profileId),
        getLatestRunForProfile(profileId),
        getSettings(),
      ]);

      if (dataResult.status === 'fulfilled') {
        setProfile(dataResult.value);
      } else {
        throw dataResult.reason;
      }

      if (runResult.status === 'fulfilled') {
        setLatestRun(runResult.value);
      } else {
        setLatestRun(null);
      }

      if (configResult.status === 'fulfilled') {
        setSettings({
          schedule_enabled: Boolean(configResult.value?.schedule_enabled),
          default_schedule: configResult.value?.default_schedule ?? 'Not set',
        });
      }
    } catch (error) {
      setActionError(`Unable to load profile state: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function refreshRunState() {
    if (!profileId) {
      return;
    }

    setRefreshingRun(true);
    try {
      const [runData, configData, profileData] = await Promise.all([
        getLatestRunForProfile(profileId),
        getSettings(),
        getTrackedProfile(profileId),
      ]);

      setLatestRun(runData);
      setSettings({
        schedule_enabled: Boolean(configData?.schedule_enabled),
        default_schedule: configData?.default_schedule ?? 'Not set',
      });
      setProfile(profileData);
    } catch {
      // Ignore silent refresh errors to avoid breaking active monitoring.
    } finally {
      setRefreshingRun(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profileId]);

  useEffect(() => {
    if (!profileId) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshRunState();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [profileId]);

  const liveStageLabel = useMemo(() => {
    if (!latestRun) {
      return 'Idle';
    }

    if (latestRun.status === 'completed') {
      return 'Completed';
    }

    if (latestRun.status === 'failed') {
      const lastStage = latestRun.error_log
        ?.slice()
        .reverse()
        .find((entry) => typeof entry?.stage === 'string')?.stage;

      if (typeof lastStage === 'string' && lastStage.trim() && lastStage !== 'fatal') {
        return `Failed (${lastStage})`;
      }

      return 'Failed';
    }

    if (latestRun.profiles_processed === 0) {
      return 'Initializing run';
    }

    if (latestRun.posts_found === 0) {
      return 'Scraping profile posts';
    }

    if (latestRun.comments_collected === 0) {
      return 'Scraping post comments';
    }

    if ((latestRun.crm_pushes_succeeded + latestRun.crm_pushes_failed) > 0) {
      return 'Pushing leads to CRM';
    }

    return 'Saving and deduplicating leads';
  }, [latestRun]);

  const runStatusText = useMemo(() => {
    if (!profile) {
      return 'Loading profile status...';
    }

    if (!profile.is_active) {
      return 'Automation is paused for this profile.';
    }

    if (latestRun?.status === 'running') {
      return `Scraping is currently running for this profile (${liveStageLabel}).`;
    }

    if (latestRun?.status === 'failed') {
      return 'The latest scrape failed. Check diagnostics below.';
    }

    if (latestRun?.status === 'completed') {
      if (settings?.schedule_enabled) {
        return `Scrape completed. Waiting for next scheduled run (${settings.default_schedule}).`;
      }
      return 'Scrape completed. Automatic scheduling is currently disabled.';
    }

    if (settings?.schedule_enabled) {
      return `No completed run yet. Waiting for schedule (${settings.default_schedule}) or manual run.`;
    }

    return 'No run yet. Start a manual run to begin scraping.';
  }, [latestRun?.status, liveStageLabel, profile, settings?.default_schedule, settings?.schedule_enabled]);

  const latestFatalError = useMemo(() => {
    if (!latestRun?.error_log?.length) {
      return null;
    }

    const fatalError = latestRun.error_log.find((entry) => entry?.stage === 'fatal');
    if (!fatalError || typeof fatalError !== 'object') {
      return null;
    }

    const rawMessage = fatalError.message;
    return typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage : JSON.stringify(fatalError);
  }, [latestRun]);

  async function onRunNow() {
    if (!profile) {
      return;
    }

    setRunning(true);
    setActionError(null);

    triggerRun('manual', profile.id)
      .then((runResult) => {
        if (runResult?.summary) {
          setSummary(runResult.summary as RunSummary);
        }
      })
      .catch((error) => {
        setActionError(String(error));
      })
      .finally(async () => {
        setRunning(false);
        await refreshRunState();
      });

    await refreshRunState();
  }

  async function onToggleAutomation() {
    if (!profile) {
      return;
    }

    const nextEnabled = !profile.is_active;
    setToggling(true);
    setActionError(null);

    try {
      await toggleProfileIntegration(profile.id, nextEnabled);
      const updatedProfile = { ...profile, is_active: nextEnabled };
      setProfile(updatedProfile);

      if (nextEnabled) {
        await onRunNow();
      } else {
        setSummary(null);
      }
    } catch (error) {
      setActionError(`Unable to update automation: ${String(error)}`);
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
          <button className="btn btn-primary" onClick={() => void onRunNow()} disabled={running || !profile?.is_active}>
            <RefreshCcw size={14} /> {running ? 'Running...' : 'Run now'}
          </button>
          <button className="btn btn-secondary" onClick={load} disabled={loading || refreshingRun}>
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
          <p className="helper-text">{runStatusText}</p>
          {actionError ? <p className="helper-text">{actionError}</p> : null}
        </div>

        {latestRun ? (
          <div className="panel">
            <div className="panel-title-wrap">
              <h2 className="panel-title">Live run status</h2>
              <p className="panel-subtitle">Real-time metrics from the latest run row in scrape_runs.</p>
            </div>
            <div className="summary-grid">
              <div><span>Status</span><strong>{latestRun.status}</strong></div>
              <div><span>Stage</span><strong>{liveStageLabel}</strong></div>
              <div><span>Started</span><strong>{new Date(latestRun.started_at).toLocaleString()}</strong></div>
              <div><span>Completed</span><strong>{latestRun.completed_at ? formatRelativeLabel(latestRun.completed_at) : 'In progress'}</strong></div>
              <div><span>Profiles processed</span><strong>{latestRun.profiles_processed}</strong></div>
              <div><span>Posts found</span><strong>{latestRun.posts_found}</strong></div>
              <div><span>New posts scraped</span><strong>{latestRun.new_posts_scraped}</strong></div>
              <div><span>Comments collected</span><strong>{latestRun.comments_collected}</strong></div>
              <div><span>New unique authors</span><strong>{latestRun.new_unique_authors}</strong></div>
              <div><span>CRM pushes</span><strong>{latestRun.crm_pushes_succeeded} / {latestRun.crm_pushes_failed}</strong></div>
            </div>
            {latestFatalError ? <p className="helper-text">Latest run error: {latestFatalError}</p> : null}
            {settings ? (
              <p className="helper-text">
                {settings.schedule_enabled
                  ? `Scheduler enabled (${settings.default_schedule}).`
                  : 'Scheduler disabled. Only manual runs will execute until a scheduler is configured.'}
              </p>
            ) : null}
          </div>
        ) : null}

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
