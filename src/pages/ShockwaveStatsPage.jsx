import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';

const ShockwaveStatsView = React.lazy(() => import('../components/shockwave/ShockwaveStatsView'));

class ShockwaveStatsPageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('ShockwaveStatsPage failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          치료 내역 통계 화면을 여는 중 오류가 발생했습니다.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ShockwaveStatsPage() {
  const [schedulerMemosReady, setSchedulerMemosReady] = useState(false);
  const [localMonthlyTherapists, setLocalMonthlyTherapists] = useState([]);
  const scheduleReloadRequestRef = useRef(0);
  const {
    currentYear,
    currentMonth,
    therapists,
    loadTherapists,
    shockwaveMemos,
    loadShockwaveMemos,
    loadMonthlyTherapists,
  } = useSchedule();

  // 연월 변경 시 로컬 치료사 목록을 즉시 초기화하여 이전 달 데이터가 잔류하지 않도록 함
  const currentMonthKey = useMemo(() => `${currentYear}-${currentMonth}`, [currentYear, currentMonth]);

  useEffect(() => {
    setLocalMonthlyTherapists([]);
  }, [currentMonthKey]);

  useEffect(() => {
    loadTherapists();
  }, [loadTherapists]);

  const reloadScheduleData = useCallback(async ({ force = false } = {}) => {
    const requestId = ++scheduleReloadRequestRef.current;
    setSchedulerMemosReady(false);
    const loadedTherapists = await loadTherapists();
    const [loadedMemos, loadedMonthlyTherapists] = await Promise.all([
      loadShockwaveMemos(currentYear, currentMonth, { force }),
      loadMonthlyTherapists(currentYear, currentMonth, 'shockwave'),
    ]);
    if (scheduleReloadRequestRef.current === requestId) {
      setSchedulerMemosReady(true);
      if (Array.isArray(loadedMonthlyTherapists)) {
        setLocalMonthlyTherapists(loadedMonthlyTherapists);
      }
    }
    return { memos: loadedMemos, monthlyTherapists: loadedMonthlyTherapists, therapists: loadedTherapists };
  }, [currentYear, currentMonth, loadShockwaveMemos, loadMonthlyTherapists, loadTherapists]);

  // Use useEffect to ensure memos are loaded if navigating here directly
  useEffect(() => {
    let active = true;
    const requestId = ++scheduleReloadRequestRef.current;
    setSchedulerMemosReady(false);

    (async () => {
      await loadTherapists();
      const [, loadedMonthlyTherapists] = await Promise.all([
        loadShockwaveMemos(currentYear, currentMonth),
        loadMonthlyTherapists(currentYear, currentMonth, 'shockwave'),
      ]);
      if (active && scheduleReloadRequestRef.current === requestId) {
        setSchedulerMemosReady(true);
        if (Array.isArray(loadedMonthlyTherapists)) {
          setLocalMonthlyTherapists(loadedMonthlyTherapists);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [currentYear, currentMonth, loadShockwaveMemos, loadMonthlyTherapists, loadTherapists]);

  // 탭이 다시 보일 때 (visibility change) 자동으로 데이터 갱신
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reloadScheduleData({ force: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reloadScheduleData]);

  // 수동 새로고침 콜백
  const handleReloadMemos = useCallback(async () => {
    await reloadScheduleData({ force: true });
  }, [reloadScheduleData]);

  return (
    <div className="animate-fade-in" style={{ height: '100%', overflow: 'auto' }}>
      <ShockwaveStatsPageErrorBoundary>
        <Suspense fallback={<div style={{ padding: 24 }}>치료 내역 통계를 불러오는 중...</div>}>
          <ShockwaveStatsView 
            currentYear={currentYear}
            currentMonth={currentMonth}
            memos={shockwaveMemos}
            therapists={therapists}
            schedulerMemosReady={schedulerMemosReady}
            onReloadMemos={handleReloadMemos}
            monthlyTherapistsProp={localMonthlyTherapists}
          />
        </Suspense>
      </ShockwaveStatsPageErrorBoundary>
    </div>
  );
}
