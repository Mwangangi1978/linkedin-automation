import { useEffect, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { getDashboardStats, triggerRun } from '../lib/api';
import type { ScrapeRun } from '../lib/models';

interface DashboardStats {
  totalProfiles: number;
  totalPosts: number;
  totalAuthors: number;
  totalPending: number;
  lastRun: ScrapeRun | null;
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getDashboardStats();
      setStats(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onRunNow() {
    setRunning(true);
    try {
      await triggerRun('manual');
      await load();
      alert('Pipeline run started successfully.');
    } catch (error) {
      alert(`Failed to trigger run: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  const cards = [
    { label: 'Profiles Tracked', value: stats?.totalProfiles ?? 0 },
    { label: 'Posts Collected', value: stats?.totalPosts ?? 0 },
    { label: 'Unique Authors', value: stats?.totalAuthors ?? 0 },
    { label: 'Pending CRM Push', value: stats?.totalPending ?? 0 },
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Dashboard</h1>
          <span className="status-badge"><span className="dot" /> Pipeline Ready</span>
        </div>
        <div className="topbar-right">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={onRunNow} disabled={running}>
            <Play size={16} /> {running ? 'Running...' : 'Run Now'}
          </button>
        </div>
      </header>

      <section className="page-shell">
        <div className="cards-grid">
          {cards.map((card) => (
            <article key={card.label} className="kpi-card">
              <span className="kpi-label">{card.label}</span>
              <strong className="kpi-value">{card.value}</strong>
            </article>
          ))}
        </div>

        <article className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="panel-title">Last run summary</h2>
              <p className="panel-subtitle">Latest scheduled/manual run from `scrape_runs`.</p>
            </div>
          </div>

          {stats?.lastRun ? (
            <div className="summary-grid">
              <div><span>Status</span><strong>{stats.lastRun.status}</strong></div>
              <div><span>Profiles</span><strong>{stats.lastRun.profiles_processed}</strong></div>
              <div><span>New posts</span><strong>{stats.lastRun.new_posts_scraped}</strong></div>
              <div><span>New authors</span><strong>{stats.lastRun.new_unique_authors}</strong></div>
              <div><span>CRM pushed</span><strong>{stats.lastRun.crm_pushes_succeeded}</strong></div>
              <div><span>CRM failed</span><strong>{stats.lastRun.crm_pushes_failed}</strong></div>
            </div>
          ) : (
            <p className="panel-subtitle">No runs yet. Click Run Now to start your first pipeline execution.</p>
          )}
        </article>
      </section>
    </>
  );
}
