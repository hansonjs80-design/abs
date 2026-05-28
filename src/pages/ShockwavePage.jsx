import React, { useEffect, useState } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import ShockwaveView from '../components/shockwave/ShockwaveView';

class ShockwavePageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || '' };
  }

  componentDidCatch(error) {
    console.error('ShockwavePage failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>충격파 스케줄러 화면을 여는 중 오류가 발생했습니다.</div>
          {this.state.errorMessage ? (
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #666)' }}>{this.state.errorMessage}</div>
          ) : null}
          <button 
            type="button" 
            onClick={() => window.location.reload()}
            style={{ marginTop: 12, padding: '6px 12px', background: 'var(--brand-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ShockwavePage() {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const {
    currentYear,
    currentMonth,
    therapists,
    loadTherapists,
    loadManualTherapists,
    shockwaveSettings,
    loadShockwaveSettings,
    shockwaveMemos,
    loadShockwaveMemos,
    loadMonthlyTherapists,
    monthlyTherapistLoadKeys,
    saveShockwaveMemo,
    holidays,
    loadHolidays,
    staffMemos,
    loadStaffMemos
  } = useSchedule();

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    Promise.allSettled([
      loadTherapists(),
      loadManualTherapists(),
      loadShockwaveSettings(),
    ]).then((results) => {
      if (cancelled) return;
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected) {
        console.error('Shockwave tab base loaders failed:', rejected.reason);
        setLoadError('기본 설정 일부를 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadTherapists, loadManualTherapists, loadShockwaveSettings, loadAttempt]);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    Promise.allSettled([
      loadStaffMemos(currentYear, currentMonth, { includeAdjacentMonths: true }),
      loadHolidays(currentYear, currentMonth),
      loadMonthlyTherapists(currentYear, currentMonth, 'shockwave'),
      loadMonthlyTherapists(currentYear, currentMonth, 'manual_therapy'),
    ]).then((results) => {
      if (cancelled) return;
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected) {
        console.error('Shockwave tab month loaders failed:', rejected.reason);
        setLoadError('스케줄 데이터를 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentYear, currentMonth, loadStaffMemos, loadHolidays, loadMonthlyTherapists, loadAttempt]);

  const monthKey = `${currentYear}-${currentMonth}`;
  const monthlyTherapistsReady = monthlyTherapistLoadKeys?.shockwave === monthKey;

  return (
    <ShockwavePageErrorBoundary>
      <div className="animate-fade-in">
        {monthlyTherapistsReady ? (
          <ShockwaveView
            therapists={therapists}
            settings={shockwaveSettings}
            memos={shockwaveMemos}
            onLoadMemos={loadShockwaveMemos}
            onSaveMemo={saveShockwaveMemo}
            holidays={holidays}
            staffMemos={staffMemos}
          />
        ) : loadError ? (
          <div style={{ padding: 24 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>스케줄을 불러오지 못했습니다.</div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #666)', marginBottom: 12 }}>{loadError}</div>
            <button
              type="button"
              onClick={() => setLoadAttempt((count) => count + 1)}
              style={{ padding: '6px 12px', background: 'var(--brand-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              다시 불러오기
            </button>
          </div>
        ) : (
          <div style={{ padding: 24 }}>치료사 설정을 불러오는 중...</div>
        )}
      </div>
    </ShockwavePageErrorBoundary>
  );
}
