import { useState, useEffect } from 'react';
import StaffCalendar from '../components/calendar/StaffCalendar';
import TodayPanel from '../components/calendar/TodayPanel';
import NoticeBoard from '../components/notice/NoticeBoard';
import { useSchedule } from '../contexts/ScheduleContext';
import {
  readStoredStaffDepartments,
  saveStoredStaffDepartments,
  normalizeStaffDepartmentList,
} from '../lib/staffDepartmentFilters';

const HIDDEN_DEPARTMENTS_STORAGE_KEY = 'staff-schedule-hidden-departments';

function readStoredHiddenDepartments() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_DEPARTMENTS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredHiddenDepartments(hidden) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(HIDDEN_DEPARTMENTS_STORAGE_KEY, JSON.stringify(hidden));
}

export default function StaffSchedulePage() {
  const { shockwaveSettings, saveShockwaveSettings } = useSchedule();
  
  const [hiddenDepartments, setHiddenDepartments] = useState(readStoredHiddenDepartments);
  const [departments, setDepartments] = useState(readStoredStaffDepartments);

  useEffect(() => {
    if (shockwaveSettings?.monthly_settlement_settings) {
      const ms = shockwaveSettings.monthly_settlement_settings;
      if (ms.global_departments) {
        const normalized = normalizeStaffDepartmentList(ms.global_departments);
        setDepartments(normalized);
        saveStoredStaffDepartments(normalized);
      }
      if (ms.global_hidden_departments) {
        setHiddenDepartments(ms.global_hidden_departments);
        saveStoredHiddenDepartments(ms.global_hidden_departments);
      }
    }
  }, [shockwaveSettings]);

  const updateDepartments = (updater) => {
    setDepartments((prev) => {
      const next = normalizeStaffDepartmentList(typeof updater === 'function' ? updater(prev) : updater);
      saveStoredStaffDepartments(next);
      setHiddenDepartments((hidden) => {
        const nextHidden = hidden.filter((dept) => next.includes(dept));
        saveStoredHiddenDepartments(nextHidden);
        
        if (saveShockwaveSettings && shockwaveSettings) {
          saveShockwaveSettings({
            ...shockwaveSettings,
            monthly_settlement_settings: {
              ...(shockwaveSettings.monthly_settlement_settings || {}),
              global_departments: next,
              global_hidden_departments: nextHidden
            }
          });
        }
        
        return nextHidden;
      });
      return next;
    });
  };

  const updateHiddenDepartments = (updater) => {
    setHiddenDepartments((prev) => {
      const nextHidden = typeof updater === 'function' ? updater(prev) : updater;
      saveStoredHiddenDepartments(nextHidden);
      
      if (saveShockwaveSettings && shockwaveSettings) {
        saveShockwaveSettings({
          ...shockwaveSettings,
          monthly_settlement_settings: {
            ...(shockwaveSettings.monthly_settlement_settings || {}),
            global_departments: departments,
            global_hidden_departments: nextHidden
          }
        });
      }
      
      return nextHidden;
    });
  };

  return (
    <div className="animate-fade-in">
      <div className="staff-layout">
        <StaffCalendar hiddenDepartments={hiddenDepartments} />
        <div className="staff-side">
          <TodayPanel />
          <NoticeBoard
            departments={departments}
            onDepartmentsChange={updateDepartments}
            hiddenDepartments={hiddenDepartments}
            onHiddenDepartmentsChange={updateHiddenDepartments}
          />
          <div id="staff-settings-portal"></div>
        </div>
      </div>
    </div>
  );
}
