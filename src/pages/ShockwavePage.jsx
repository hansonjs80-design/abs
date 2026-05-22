import React, { useEffect } from 'react';
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
    saveShockwaveMemo,
    holidays,
    loadHolidays,
    staffMemos,
    loadStaffMemos
  } = useSchedule();

  useEffect(() => {
    loadTherapists();
    loadManualTherapists();
    loadShockwaveSettings();
  }, [loadTherapists, loadManualTherapists, loadShockwaveSettings]);

  useEffect(() => {
    loadStaffMemos(currentYear, currentMonth, { includeAdjacentMonths: true });
    loadHolidays(currentYear, currentMonth);
  }, [currentYear, currentMonth, loadStaffMemos, loadHolidays]);

  return (
    <ShockwavePageErrorBoundary>
      <div className="animate-fade-in">
        <ShockwaveView
          therapists={therapists}
          settings={shockwaveSettings}
          memos={shockwaveMemos}
          onLoadMemos={loadShockwaveMemos}
          onSaveMemo={saveShockwaveMemo}
          holidays={holidays}
          staffMemos={staffMemos}
        />
      </div>
    </ShockwavePageErrorBoundary>
  );
}
