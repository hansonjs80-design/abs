import React, { Suspense, useEffect } from 'react';
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
  const {
    currentYear,
    currentMonth,
    therapists,
    loadTherapists,
    shockwaveMemos,
    loadShockwaveMemos,
  } = useSchedule();

  useEffect(() => {
    loadTherapists();
  }, [loadTherapists]);

  // Use useEffect to ensure memos are loaded if navigating here directly
  useEffect(() => {
    loadShockwaveMemos(currentYear, currentMonth);
  }, [currentYear, currentMonth, loadShockwaveMemos]);

  return (
    <div className="animate-fade-in" style={{ height: '100%', overflow: 'auto' }}>
      <ShockwaveStatsPageErrorBoundary>
        <Suspense fallback={<div style={{ padding: 24 }}>치료 내역 통계를 불러오는 중...</div>}>
          <ShockwaveStatsView 
            currentYear={currentYear}
            currentMonth={currentMonth}
            memos={shockwaveMemos}
            therapists={therapists}
          />
        </Suspense>
      </ShockwaveStatsPageErrorBoundary>
    </div>
  );
}
