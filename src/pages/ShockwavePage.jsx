import { useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import ShockwaveView from '../components/shockwave/ShockwaveView';

export default function ShockwavePage() {
  const { therapists, loadTherapists, shockwaveMemos, loadShockwaveMemos, saveShockwaveMemo, holidays } = useSchedule();

  useEffect(() => {
    loadTherapists();
  }, [loadTherapists]);

  return (
    <div className="animate-fade-in">
      <ShockwaveView
        therapists={therapists}
        memos={shockwaveMemos}
        onLoadMemos={loadShockwaveMemos}
        onSaveMemo={saveShockwaveMemo}
        holidays={holidays}
      />
    </div>
  );
}
