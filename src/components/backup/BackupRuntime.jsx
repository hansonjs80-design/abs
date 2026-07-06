import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import {
  appendBackupChangeEvent,
  BACKUP_LAST_AUTO_SNAPSHOT_KEY,
  BACKUP_REALTIME_TABLES,
  BACKUP_SETTINGS_EVENT,
  createFullBackupSnapshot,
  readBackupSettings,
  saveBackupSnapshot,
} from '../../lib/supabaseBackupUtils';

function getLastSnapshotAt() {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(BACKUP_LAST_AUTO_SNAPSHOT_KEY);
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function setLastSnapshotAt(value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BACKUP_LAST_AUTO_SNAPSHOT_KEY, value);
}

export default function BackupRuntime() {
  const { user } = useAuth();
  const settingsRef = useRef(readBackupSettings());
  const snapshotRunningRef = useRef(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  useEffect(() => {
    const reloadSettings = () => {
      settingsRef.current = readBackupSettings();
      setSettingsVersion((value) => value + 1);
    };
    window.addEventListener(BACKUP_SETTINGS_EVENT, reloadSettings);
    window.addEventListener('storage', reloadSettings);
    return () => {
      window.removeEventListener(BACKUP_SETTINGS_EVENT, reloadSettings);
      window.removeEventListener('storage', reloadSettings);
    };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    let timeoutId = null;

    const scheduleNext = () => {
      const settings = settingsRef.current;
      if (!settings.autoSnapshotEnabled || cancelled) return;
      const intervalMs = Math.max(1, settings.snapshotIntervalMinutes) * 60 * 1000;
      const lastAt = getLastSnapshotAt();
      const delay = lastAt > 0 ? Math.max(1000, intervalMs - (Date.now() - lastAt)) : 1000;
      timeoutId = window.setTimeout(runSnapshotIfDue, delay);
    };

    const runSnapshotIfDue = async () => {
      const settings = settingsRef.current;
      if (cancelled || !settings.autoSnapshotEnabled) return;
      const intervalMs = Math.max(1, settings.snapshotIntervalMinutes) * 60 * 1000;
      const lastAt = getLastSnapshotAt();
      if (lastAt > 0 && Date.now() - lastAt < intervalMs - 500) {
        scheduleNext();
        return;
      }
      if (snapshotRunningRef.current) {
        scheduleNext();
        return;
      }
      snapshotRunningRef.current = true;
      try {
        const snapshot = await createFullBackupSnapshot(supabase, { reason: 'auto' });
        await saveBackupSnapshot(snapshot, { maxSnapshots: settings.maxSnapshots });
        setLastSnapshotAt(snapshot.created_at);
      } catch (error) {
        console.error('Automatic Supabase backup failed:', error);
      } finally {
        snapshotRunningRef.current = false;
        scheduleNext();
      }
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [user, settingsVersion]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!user || !settings.realtimeEnabled || typeof supabase.channel !== 'function') return undefined;

    const channels = BACKUP_REALTIME_TABLES.map((tableName) => (
      supabase
        .channel(`local-backup-${tableName}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tableName },
          (payload) => {
            appendBackupChangeEvent({
              table: tableName,
              eventType: payload.eventType,
              old: payload.old || null,
              new: payload.new || null,
              commit_timestamp: payload.commit_timestamp || null,
            }).catch((error) => {
              console.error('Failed to save backup change event:', error);
            });
          }
        )
        .subscribe()
    ));

    return () => {
      channels.forEach((channel) => {
        try {
          supabase.removeChannel?.(channel);
        } catch (error) {
          console.error('Failed to remove backup realtime channel:', error);
        }
      });
    };
  }, [user, settingsVersion]);

  return null;
}
