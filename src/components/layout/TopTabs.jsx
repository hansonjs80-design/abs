import { NavLink, useLocation } from 'react-router-dom';
import MonthPicker from '../common/MonthPicker';
import ThemeToggle from '../common/ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';

export default function TopTabs() {
  const location = useLocation();
  const { user } = useAuth();
  const items = getAllowedTabs(user);

  return (
    <div className="top-tabs-shell">
      <nav className="top-tabs" aria-label="주요 화면 이동">
        <div className="top-tabs-track">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname === item.path;

            if (isActive && item.monthLabel) {
              return (
                <div key={item.path} className={`top-tab active month-tab ${item.tabClass}`}>
                  <Icon size={18} />
                  <MonthPicker suffix={item.monthLabel} variant="tab" />
                </div>
              );
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive: linkActive }) => `top-tab ${item.tabClass}${linkActive ? ' active' : ''}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
      <div className="top-tabs-actions">
        <ThemeToggle />
      </div>
    </div>
  );
}
