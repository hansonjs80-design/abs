import { useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import ShockwaveView from '../components/shockwave/ShockwaveView';

export default function ShockwavePage() {
  const {
    currentYear,
    currentMonth,
    therapists,
    loadTherapists,
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
    loadShockwaveSettings();
  }, [loadTherapists, loadShockwaveSettings]);

  useEffect(() => {
    loadStaffMemos(currentYear, currentMonth);
    loadHolidays(currentYear, currentMonth);
  }, [currentYear, currentMonth, loadStaffMemos, loadHolidays]);

  return (
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
  );
}
