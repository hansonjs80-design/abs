import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MonthPicker from '../common/MonthPicker';
import PrintButton from '../common/PrintButton';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';

export default function TopTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const items = getAllowedTabs(user);
  const [now, setNow] = useState(() => new Date());
  const [optimisticPath, setOptimisticPath] = useState(null);

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

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
            const currentPath = optimisticPath || location.pathname;
            const isActive = item.path === '/'
              ? currentPath === '/'
              : currentPath === item.path;

            return (
              <span key={item.path} className="top-tab-with-date">
                <div
                  className={`top-tab ${item.tabClass}${isActive ? ' active' : ''}${isActive && item.monthLabel ? ' month-tab' : ''}`}
                  onClick={() => {
                    if (!isActive) {
                      notifyBeforeTabChange();
                      // Optimistically update UI immediately to unblock CSS animations
                      setOptimisticPath(item.path);
                      // Defer heavy route change to allow browser to composite the animation
                      setTimeout(() => {
                        navigate(item.path);
                      }, 50);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (isActive) {
                      e.stopPropagation();
                    } else {
                      notifyBeforeTabChange();
                    }
                  }}
                  onTouchStart={(e) => {
                    if (isActive) {
                      e.stopPropagation();
                    } else {
                      notifyBeforeTabChange();
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                  role="tab"
                  aria-selected={isActive}
                >
                  <div className="top-tab-inner">
                    <Icon size={18} />
                    {item.monthLabel ? (
                      <div className="tab-content-switcher">
                        <span className="tab-content-inactive">
                          <span>{item.label}</span>
                        </span>
                        <span className="tab-content-active">
                          <MonthPicker suffix={item.monthLabel} variant="tab" />
                        </span>
                      </div>
                    ) : (
                      <span>{item.label}</span>
                    )}
                  </div>
                </div>
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
