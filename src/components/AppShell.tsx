import { Activity, Blocks, GitBranch, LayoutDashboard, Network, Settings, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

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
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
