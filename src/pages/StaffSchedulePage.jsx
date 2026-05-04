import { useState, useEffect } from 'react';
import StaffCalendar from '../components/calendar/StaffCalendar';
import TodayPanel from '../components/calendar/TodayPanel';
import NoticeBoard from '../components/notice/NoticeBoard';
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
  const [hiddenDepartments, setHiddenDepartments] = useState(readStoredHiddenDepartments);
  const [departments, setDepartments] = useState(readStoredStaffDepartments);

  const updateDepartments = (updater) => {
    setDepartments((prev) => {
      const next = normalizeStaffDepartmentList(typeof updater === 'function' ? updater(prev) : updater);
      saveStoredStaffDepartments(next);
      setHiddenDepartments((hidden) => {
        const nextHidden = hidden.filter((dept) => next.includes(dept));
        saveStoredHiddenDepartments(nextHidden);
        return nextHidden;
      });
      return next;
    });
  };

  const updateHiddenDepartments = (updater) => {
    setHiddenDepartments((prev) => {
      const nextHidden = typeof updater === 'function' ? updater(prev) : updater;
      saveStoredHiddenDepartments(nextHidden);
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
        </div>
      </div>
    </div>
  );
}
