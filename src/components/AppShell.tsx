import { Activity, Blocks, GitBranch, LayoutDashboard, LogOut, Network, Settings, Users } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/workflow', label: 'Workflow Builder', icon: Network },
  { to: '/tracked-profiles', label: 'Tracked Profiles', icon: Users },
  { to: '/leads', label: 'Leads Browser', icon: GitBranch },
  { to: '/run-history', label: 'Run History', icon: Activity },
  { to: '/integrations', label: 'Integrations', icon: Blocks },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await supabase.auth.signOut();
      navigate('/');
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to sign out');
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon">
            <Network size={18} />
          </div>
          <span className="logo-text">FlowGen</span>
        </div>

        <nav className="sidebar-nav">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon className="nav-icon" size={18} />
                <span>{link.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="btn logout-btn"
          >
            <LogOut size={18} />
            <span>{isLoggingOut ? 'Signing out...' : 'Sign out'}</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
