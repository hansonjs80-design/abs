import { NavLink, useLocation } from 'react-router-dom';
import { Calendar, ClipboardList, Settings, Zap } from 'lucide-react';
import MonthPicker from '../common/MonthPicker';
import ThemeToggle from '../common/ThemeToggle';

const items = [
  { path: '/', icon: Calendar, label: '직원 근무표', monthLabel: '직원 근무표', tabClass: 'top-tab--calendar' },
  { path: '/shockwave', icon: Zap, label: '충격파 스케줄러', monthLabel: '충격파 스케줄러', tabClass: 'top-tab--shockwave' },
  { path: '/shockwave-stats', icon: ClipboardList, label: '충격파 통계', monthLabel: '충격파 통계', tabClass: 'top-tab--stats' },
  { path: '/settings', icon: Settings, label: '설정', tabClass: 'top-tab--settings' },
];

export default function TopTabs() {
  const location = useLocation();

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
                  <Icon size={16} />
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
                <Icon size={16} />
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
