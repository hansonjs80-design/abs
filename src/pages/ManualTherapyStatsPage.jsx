import React, { Suspense, useEffect, useState } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { supabase } from '../lib/supabaseClient';

const ManualTherapyStatsView = React.lazy(() => import('../components/shockwave/ManualTherapyStatsView'));

class ManualTherapyStatsPageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('ManualTherapyStatsPage failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          도수치료 통계 화면을 여는 중 오류가 발생했습니다.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ManualTherapyStatsPage() {
  const {
    currentYear,
    currentMonth,
    therapists,
    loadTherapists,
    shockwaveMemos,
    loadShockwaveMemos,
    shockwaveSettings,
  } = useSchedule();
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    loadTherapists();
  }, [loadTherapists]);

  useEffect(() => {
    loadShockwaveMemos(currentYear, currentMonth);
  }, [currentYear, currentMonth, loadShockwaveMemos]);

  useEffect(() => {
    let cancelled = false;

    const fetchLogs = async () => {
      try {
        const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
        const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
        const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
        const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

        const { data, error } = await supabase
          .from('shockwave_patient_logs')
          .select('*')
          .gte('date', startStr)
          .lt('date', endStr)
          .order('date', { ascending: true })
          .order('created_at', { ascending: true });

        if (error) throw error;
        if (!cancelled) setLogs(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Failed to load manual therapy stats logs:', error);
        if (!cancelled) setLogs([]);
      }
    };

    fetchLogs();
    return () => {
      cancelled = true;
    };
  }, [currentYear, currentMonth]);

  return (
    <div className="animate-fade-in" style={{ height: '100%', overflow: 'auto' }}>
      <ManualTherapyStatsPageErrorBoundary>
        <Suspense fallback={<div style={{ padding: 24 }}>도수치료 통계를 불러오는 중...</div>}>
          <ManualTherapyStatsView
            currentYear={currentYear}
            currentMonth={currentMonth}
            memos={shockwaveMemos}
            therapists={therapists}
            logs={logs}
            prescriptions={shockwaveSettings?.manual_therapy_prescriptions || ['40분', '60분']}
            incentivePercentage={shockwaveSettings?.manual_therapy_incentive_percentage ?? 0}
          />
        </Suspense>
      </ManualTherapyStatsPageErrorBoundary>
    </div>
  );
}
