import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import MonthPicker from '../common/MonthPicker';
import PrintButton from '../common/PrintButton';
import ThemeToggle from '../common/ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';

export default function TopTabs() {
  const location = useLocation();
  const { user } = useAuth();
  const items = getAllowedTabs(user);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentDateTimeLabel = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);

  const notifyBeforeTabChange = () => {
    window.dispatchEvent(new CustomEvent('clinic-before-route-change'));
  };

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
              <span key={item.path} className="top-tab-with-date">
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive: linkActive }) => `top-tab ${item.tabClass}${linkActive ? ' active' : ''}`}
                  onMouseDown={notifyBeforeTabChange}
                  onTouchStart={notifyBeforeTabChange}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
                {item.key === 'settings' && (
                  <span className="top-tabs-current-date" aria-label={`현재 날짜와 시간 ${currentDateTimeLabel}`}>
                    {currentDateTimeLabel}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </nav>
      <div className="top-tabs-actions">
        <PrintButton />
        <ThemeToggle />
      </div>
    </div>
  );
}
