import { useState } from 'react';
import StaffCalendar from '../components/calendar/StaffCalendar';
import TodayPanel from '../components/calendar/TodayPanel';
import NoticeBoard from '../components/notice/NoticeBoard';
import {
  readStoredStaffDepartments,
  saveStoredStaffDepartments,
  normalizeStaffDepartmentList,
} from '../lib/staffDepartmentFilters';

export default function StaffSchedulePage() {
  const [hiddenDepartments, setHiddenDepartments] = useState([]);
  const [departments, setDepartments] = useState(readStoredStaffDepartments);

  const updateDepartments = (updater) => {
    setDepartments((prev) => {
      const next = normalizeStaffDepartmentList(typeof updater === 'function' ? updater(prev) : updater);
      saveStoredStaffDepartments(next);
      setHiddenDepartments((hidden) => hidden.filter((dept) => next.includes(dept)));
      return next;
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
            onHiddenDepartmentsChange={setHiddenDepartments}
          />
        </div>
      </div>
    </div>
  );
}
