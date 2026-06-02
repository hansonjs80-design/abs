import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MonthPicker from '../common/MonthPicker';
import PrintButton from '../common/PrintButton';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';

export default function TopTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const items = useMemo(() => getAllowedTabs(user), [user]);
  const [now, setNow] = useState(() => new Date());
  const [optimisticPath, setOptimisticPath] = useState(null);
  const routeTimerRef = useRef(null);
  const measureFrameRef = useRef(null);
  const tabWrapRefs = useRef(new Map());
  const activeContentRefs = useRef(new Map());
  const inactiveContentRefs = useRef(new Map());

  useEffect(() => {
    setOptimisticPath(null);
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (routeTimerRef.current) {
        window.clearTimeout(routeTimerRef.current);
      }
      if (measureFrameRef.current) {
        window.cancelAnimationFrame(measureFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const measureTabContentWidths = useCallback(() => {
    measureFrameRef.current = null;
    items.forEach((item) => {
      const wrap = tabWrapRefs.current.get(item.path);
      if (!wrap) return;

      const activeEl = activeContentRefs.current.get(item.path);
      const inactiveEl = inactiveContentRefs.current.get(item.path);
      if (activeEl) {
        wrap.classList.add('measuring-tab-width');
        wrap.style.setProperty('--tab-active-content-width', `${activeEl.scrollWidth}px`);
        wrap.classList.remove('measuring-tab-width');
      }
      if (inactiveEl) {
        wrap.style.setProperty('--tab-inactive-content-width', `${inactiveEl.scrollWidth}px`);
      }
    });
  }, [items]);

  const scheduleTabContentWidthMeasure = useCallback(() => {
    if (measureFrameRef.current) {
      window.cancelAnimationFrame(measureFrameRef.current);
    }
    measureFrameRef.current = window.requestAnimationFrame(measureTabContentWidths);
  }, [measureTabContentWidths]);

  useLayoutEffect(() => {
    measureTabContentWidths();
  }, [measureTabContentWidths]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(scheduleTabContentWidthMeasure);
    activeContentRefs.current.forEach((el) => observer.observe(el));
    inactiveContentRefs.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      if (measureFrameRef.current) {
        window.cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = null;
      }
    };
  }, [scheduleTabContentWidthMeasure]);

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
    if (routeTimerRef.current) {
      window.clearTimeout(routeTimerRef.current);
    }
    measureTabContentWidths();
    setOptimisticPath(path);
    routeTimerRef.current = window.setTimeout(() => {
      routeTimerRef.current = null;
      navigate(path);
    }, 140);
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
              <span
                key={item.path}
                className="top-tab-with-date"
                ref={(node) => {
                  if (node) tabWrapRefs.current.set(item.path, node);
                  else tabWrapRefs.current.delete(item.path);
                }}
              >
                <div
                  className={`top-tab ${item.tabClass}${isActive ? ' active' : ''}${isActive && item.monthLabel ? ' month-tab' : ''}`}
                  onClick={() => handleTabChange(item.path, isActive)}
                  onMouseDown={(e) => {
                    if (isActive) {
                      e.stopPropagation();
                    }
                  }}
                  onTouchStart={(e) => {
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
                      <div className="tab-content-switcher">
                        <span
                          className="tab-content-inactive"
                          ref={(node) => {
                            if (node) inactiveContentRefs.current.set(item.path, node);
                            else inactiveContentRefs.current.delete(item.path);
                          }}
                        >
                          <span>{item.label}</span>
                        </span>
                        <span
                          className="tab-content-active"
                          ref={(node) => {
                            if (node) activeContentRefs.current.set(item.path, node);
                            else activeContentRefs.current.delete(item.path);
                          }}
                        >
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
