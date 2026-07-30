import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MonthPicker from '../common/MonthPicker';
import PrintButton from '../common/PrintButton';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';
import {
  buildTopTabTransition,
  getTopTabMotionClasses,
} from './topTabTransitionUtils';
import { isStatsRoutePath, preloadStatsRoute } from '../../lib/statsRoutePreload';

const TAB_EDGE_TRANSITION_MS = 320;

export default function TopTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const items = useMemo(() => getAllowedTabs(user), [user]);
  const [now, setNow] = useState(() => new Date());
  const [optimisticPath, setOptimisticPath] = useState(null);
  const [tabTransition, setTabTransition] = useState(null);
  const transitionTimerRef = useRef(null);

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const preloadablePaths = items
      .map((item) => item.path)
      .filter(isStatsRoutePath);
    if (preloadablePaths.length === 0) return undefined;

    const preload = () => {
      preloadablePaths.forEach((path) => {
        preloadStatsRoute(path);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(preload, 800);
    return () => window.clearTimeout(timeoutId);
  }, [items]);

  const formatDateTime = (date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const wd = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    const hh = date.getHours();
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}년 ${m}월 ${d}일 (${wd}) ${hh}시 ${min}분`;
  };

  const currentDateTimeLabel = formatDateTime(now);

  const notifyBeforeTabChange = () => {
    window.dispatchEvent(new CustomEvent('clinic-before-route-change'));
  };

  const handleTabChange = (path, isActive) => {
    if (isActive) return;
    notifyBeforeTabChange();
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
    const currentPath = optimisticPath || location.pathname;
    setTabTransition(buildTopTabTransition(items, currentPath, path));
    setOptimisticPath(path);
    navigate(path);
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      setTabTransition(null);
    }, TAB_EDGE_TRANSITION_MS);
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
            const motionClasses = getTopTabMotionClasses(tabTransition, item.path);

            return (
              <span
                key={item.path}
                className={`top-tab-with-date${motionClasses}`}
              >
                <div
                  className={`top-tab ${item.tabClass}${isActive ? ' active' : ''}${isActive && item.monthLabel ? ' month-tab' : ''}`}
                  onClick={() => handleTabChange(item.path, isActive)}
                  onPointerEnter={() => preloadStatsRoute(item.path)}
                  onFocus={() => preloadStatsRoute(item.path)}
                  onMouseDown={(e) => {
                    if (isActive) {
                      e.stopPropagation();
                    }
                  }}
                  onTouchStart={(e) => {
                    preloadStatsRoute(item.path);
                    if (isActive) {
                      e.stopPropagation();
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                  role="tab"
                  aria-selected={isActive}
                >
                  <div className="top-tab-inner">
                    <Icon size={18} />
                    {item.monthLabel ? (
                      <MonthPicker suffix={item.monthLabel} variant="tab" />
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
