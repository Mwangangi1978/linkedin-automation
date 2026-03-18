import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { listAuthors, retryFailedCrmPushes } from '../lib/api';
import type { ScrapedAuthor } from '../lib/models';
import { truncate } from '../lib/utils';

export function LeadsPage() {
  const [authors, setAuthors] = useState<ScrapedAuthor[]>([]);
  const [crmStatus, setCrmStatus] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setAuthors(await listAuthors({ crmStatus: crmStatus || undefined }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [crmStatus]);

  async function onRetryFailed() {
    await retryFailedCrmPushes();
    await load();
  }

  const uniqueLeaders = useMemo(() => Array.from(new Set(authors.map((row) => row.source_leader_profile_url).filter(Boolean))), [authors]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Leads Browser</h1>
          <span className="status-badge"><span className="dot" /> Live</span>
        </div>
        <div className="topbar-right">
          <button className="btn btn-secondary" onClick={load}><RefreshCcw size={14} /> Refresh</button>
          <button className="btn btn-primary" onClick={onRetryFailed}>Retry failed CRM</button>
        </div>
      </header>

      <section className="page-shell">
        <div className="panel">
          <div className="table-controls">
            <label>
              CRM Status
              <select value={crmStatus} onChange={(e) => setCrmStatus(e.target.value)}>
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="pushed">Pushed</option>
                <option value="failed">Failed</option>
                <option value="skipped">Skipped</option>
              </select>
            </label>
            <span className="muted-copy">Leaders in current set: {uniqueLeaders.length}</span>
          </div>

          <div className="table-wrap leads-table">
            <div className="table-head leads-head">
              <div>Name</div><div>LinkedIn URL</div><div>Comment</div><div>Source Leader</div><div>Status</div>
            </div>
            {loading ? <div className="profile-row"><div className="profile-cell">Loading...</div></div> : authors.map((author) => (
              <div key={author.id} className="profile-row leads-row">
                <div className="profile-cell">{author.full_name || `${author.first_name ?? ''} ${author.last_name ?? ''}`.trim() || '-'}</div>
                <div className="profile-cell url-text">{truncate(author.linkedin_profile_url, 48)}</div>
                <div className="profile-cell">{truncate(author.comment_text, 70)}</div>
                <div className="profile-cell url-text">{truncate(author.source_leader_profile_url, 36)}</div>
                <div className="profile-cell"><span className={`pill-status ${author.crm_push_status === 'pushed' ? 'active' : 'paused'}`}>{author.crm_push_status}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
