import { NavLink, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';

export default function Sidebar({ isOpen, isCollapsed, onClose }) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const handleSignOut = async () => {
    try { await signOut(); } catch (e) { console.error(e); }
  };

  const allowedTabs = getAllowedTabs(user);
  const navItems = [
    { section: '스케줄 관리' },
    ...allowedTabs.filter((item) => item.path !== '/settings'),
    { section: '시스템' },
    ...allowedTabs.filter((item) => item.path === '/settings'),
  ];

  const userInitial = user?.email?.[0]?.toUpperCase() || '?';

  return (
    <>
      <div
        className={`sidebar-overlay${isOpen ? ' visible' : ''}`}
        onClick={onClose}
      />
      <aside className={`sidebar${isOpen ? ' open' : ''}${isCollapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">📅</div>
          <div className="sidebar-brand">
            클리닉 스케줄
            <small>Clinic Schedule Manager</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item, i) => {
            if (item.section) {
              return <div key={i} className="sidebar-section-title">{item.section}</div>;
            }
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                onClick={onClose}
                end={item.path === '/'}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{userInitial}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.user_metadata?.name || '사용자'}</div>
              <div className="sidebar-user-email">{user?.email || ''}</div>
            </div>
            <button className="btn-icon" onClick={handleSignOut} title="로그아웃">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
