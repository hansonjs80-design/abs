import React, { useState, useEffect } from 'react';
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
const SHOW_LAST_ROWS_STORAGE_KEY = 'staff-schedule-show-last-rows';

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
  try {
    localStorage.setItem(HIDDEN_DEPARTMENTS_STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // Keep the page usable when browser storage is blocked or full.
  }
}

function readStoredShowLastRows() {
  if (typeof localStorage === 'undefined') return true;
  try {
    const stored = localStorage.getItem(SHOW_LAST_ROWS_STORAGE_KEY);
    return stored === null ? true : stored !== 'false';
  } catch {
    return true;
  }
}

function saveStoredShowLastRows(value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SHOW_LAST_ROWS_STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Keep the page usable when browser storage is blocked or full.
  }
}

class StaffSchedulePageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || '' };
  }

  componentDidCatch(error) {
    console.error('StaffSchedulePage failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>직원 근무표 화면을 여는 중 오류가 발생했습니다.</div>
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

export default function StaffSchedulePage() {
  const { shockwaveSettings, saveShockwaveSettings } = useSchedule();
  
  const [hiddenDepartments, setHiddenDepartments] = useState(readStoredHiddenDepartments);
  const [departments, setDepartments] = useState(readStoredStaffDepartments);
  const [showLastRows, setShowLastRows] = useState(readStoredShowLastRows);

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
      if (typeof ms.global_show_last_rows === 'boolean') {
        setShowLastRows(ms.global_show_last_rows);
        saveStoredShowLastRows(ms.global_show_last_rows);
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

  const updateShowLastRows = (nextValue) => {
    setShowLastRows(nextValue);
    saveStoredShowLastRows(nextValue);

    if (saveShockwaveSettings && shockwaveSettings) {
      saveShockwaveSettings({
        ...shockwaveSettings,
        monthly_settlement_settings: {
          ...(shockwaveSettings.monthly_settlement_settings || {}),
          global_departments: departments,
          global_hidden_departments: hiddenDepartments,
          global_show_last_rows: nextValue
        }
      });
    }
  };

  return (
    <StaffSchedulePageErrorBoundary>
      <div className="animate-fade-in">
        <div className="staff-layout">
          <StaffCalendar hiddenDepartments={hiddenDepartments} showLastRows={showLastRows} />
          <div className="staff-side">
            <TodayPanel />
            <NoticeBoard
              departments={departments}
              onDepartmentsChange={updateDepartments}
              hiddenDepartments={hiddenDepartments}
              onHiddenDepartmentsChange={updateHiddenDepartments}
              showLastRows={showLastRows}
              onShowLastRowsChange={updateShowLastRows}
            />
            <div id="staff-settings-portal"></div>
          </div>
        </div>
      </div>
    </StaffSchedulePageErrorBoundary>
  );
}
