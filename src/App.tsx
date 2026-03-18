import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { DashboardPage } from './pages/DashboardPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { LeadsPage } from './pages/LeadsPage';
import { LoginPage } from './pages/LoginPage';
import { RunHistoryPage } from './pages/RunHistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { TrackedProfilesPage } from './pages/TrackedProfilesPage';
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage';

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/workflow" element={<WorkflowBuilderPage />} />
        <Route path="/tracked-profiles" element={<TrackedProfilesPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/run-history" element={<RunHistoryPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setCheckingSession(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setIsAuthed(Boolean(data.session));
      setCheckingSession(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session));
      setCheckingSession(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="notice-card">
        Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to use the dashboard.
      </div>
    );
  }

  if (checkingSession) {
    return <div className="notice-card">Checking session...</div>;
  }

  return <BrowserRouter>{isAuthed ? <AppRoutes /> : <LoginPage />}</BrowserRouter>;
}

export default App;
