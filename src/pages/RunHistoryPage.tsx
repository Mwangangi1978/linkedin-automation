import { useEffect, useState } from 'react';
import { listRuns } from '../lib/api';
import type { ScrapeRun } from '../lib/models';

export function RunHistoryPage() {
  const [runs, setRuns] = useState<ScrapeRun[]>([]);

  useEffect(() => {
    listRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Run History</h1>
          <span className="status-badge"><span className="dot" /> Audited</span>
        </div>
      </header>

      <section className="page-shell">
        <div className="panel">
          <div className="table-wrap">
            <div className="table-head run-head">
              <div>Run ID</div><div>Status</div><div>Started</div><div>Profiles</div><div>New Posts</div><div>New Authors</div><div>CRM +/-</div>
            </div>
            {runs.map((run) => (
              <div className="profile-row run-row" key={run.id}>
                <div className="profile-cell url-text">{run.id.slice(0, 8)}...</div>
                <div className="profile-cell"><span className={`pill-status ${run.status === 'completed' ? 'active' : 'paused'}`}>{run.status}</span></div>
                <div className="profile-cell">{new Date(run.started_at).toLocaleString()}</div>
                <div className="profile-cell">{run.profiles_processed}</div>
                <div className="profile-cell">{run.new_posts_scraped}</div>
                <div className="profile-cell">{run.new_unique_authors}</div>
                <div className="profile-cell">{run.crm_pushes_succeeded} / {run.crm_pushes_failed}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
