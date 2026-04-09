import { useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import ShockwaveView from '../components/shockwave/ShockwaveView';

export default function ShockwavePage() {
  const { therapists, loadTherapists, shockwaveSettings, loadShockwaveSettings, shockwaveMemos, loadShockwaveMemos, saveShockwaveMemo, holidays } = useSchedule();

  useEffect(() => {
    loadTherapists();
    loadShockwaveSettings();
  }, [loadTherapists, loadShockwaveSettings]);

  return (
    <div className="animate-fade-in">
      <ShockwaveView
        therapists={therapists}
        settings={shockwaveSettings}
        memos={shockwaveMemos}
        onLoadMemos={loadShockwaveMemos}
        onSaveMemo={saveShockwaveMemo}
        holidays={holidays}
      />
    </div>
  );
}
