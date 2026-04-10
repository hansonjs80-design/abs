import { useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import ShockwaveStatsView from '../components/shockwave/ShockwaveStatsView';

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
      <ShockwaveStatsView 
        currentYear={currentYear}
        currentMonth={currentMonth}
        memos={shockwaveMemos}
        therapists={therapists}
      />
    </div>
  );
}
