export function IntegrationsPage() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Integrations</h1>
          <span className="status-badge"><span className="dot" /> Connected</span>
        </div>
      </header>

      <section className="page-shell">
        <div className="panel">
          <h2 className="panel-title">Apify + CRM</h2>
          <p className="panel-subtitle">Configure API credentials and schedules in Settings. This page is reserved for future per-integration diagnostics.</p>
        </div>
      </section>
    </>
  );
}
