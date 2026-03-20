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
import { TrackedProfileDetailPage } from './pages/TrackedProfileDetailPage';
import { TrackedProfilesPage } from './pages/TrackedProfilesPage';
import { WorkflowBuilderPage } from './pages/WorkflowBuilderPage';

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/workflow" element={<WorkflowBuilderPage />} />
        <Route path="/tracked-profiles">
          <Route index element={<TrackedProfilesPage />} />
          <Route path=":profileId" element={<TrackedProfileDetailPage />} />
        </Route>
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
  // Avoid synchronous setState inside the effect when Supabase isn't configured.
  const [checkingSession, setCheckingSession] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Check initial session
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthed(Boolean(data.session));
      setCheckingSession(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session));
      setCheckingSession(false);
    });

    // Refresh session when user returns from being inactive
    const handleWindowFocus = async () => {
      const { data } = await supabase.auth.refreshSession();
      setIsAuthed(Boolean(data.session));
    };

    window.addEventListener('focus', handleWindowFocus);

    return () => {
      subscription.subscription.unsubscribe();
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="notice-card">
        Missing Supabase env vars. Set VITE_SUPABASE_URL and one of VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY, VITE_SUPABASE_PUBLISHABLE_KEY, or VITE_SUPABASE_ANON_KEY in .env.
      </div>
    );
  }

  if (checkingSession) {
    return <div className="notice-card">Checking session...</div>;
  }

  return <BrowserRouter>{isAuthed ? <AppRoutes /> : <LoginPage />}</BrowserRouter>;
}

export default App;
