import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import MonthPicker from '../common/MonthPicker';
import PrintButton from '../common/PrintButton';
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

  const formatDateTime = (date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const wd = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    const hh = date.getHours();
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}년 ${m}월 ${d}일(${wd}) ${hh}시 ${min}분`;
  };

  const currentDateTimeLabel = formatDateTime(now);

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
                <span key={item.path} className="top-tab-with-date">
                  <div 
                    className={`top-tab active month-tab ${item.tabClass}`}
                    onClick={(e) => {
                      if (e.target.closest('.month-picker-label') || e.target.closest('.month-nav-btn') || e.target.closest('.month-dropdown')) return;
                      const label = e.currentTarget.querySelector('.month-picker-label');
                      if (label) label.click();
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <Icon size={18} />
                    <MonthPicker suffix={item.monthLabel} variant="tab" />
                  </div>
                </span>
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
              </span>
            );
          })}
        </div>
      </nav>
      <div className="top-tabs-actions">
        <span className="top-tabs-current-date" aria-label={`현재 날짜와 시간 ${currentDateTimeLabel}`}>
          {currentDateTimeLabel}
        </span>
        <PrintButton isStaffSchedule={location.pathname === '/'} />
      </div>
    </div>
  );
}
