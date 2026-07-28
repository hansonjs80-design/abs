import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';

export default function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const items = getAllowedTabs(user);

  const notifyBeforeNavigate = (path) => {
    if (location.pathname === path) return;
    window.dispatchEvent(new CustomEvent('clinic-before-route-change'));
  };

  return (
    <nav className="bottom-nav" aria-label="모바일 주요 화면 이동">
      <div className="bottom-nav-items">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `bottom-nav-item ${item.tabClass}${isActive ? ' active' : ''}`}
              end={item.path === '/'}
              onClick={() => notifyBeforeNavigate(item.path)}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{item.shortLabel || item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
