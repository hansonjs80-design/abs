import StaffCalendar from '../components/calendar/StaffCalendar';
import TodayPanel from '../components/calendar/TodayPanel';
import NoticeBoard from '../components/notice/NoticeBoard';

export default function StaffSchedulePage() {
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">직원 근무표</h1>
      </div>
      <div className="staff-layout">
        <StaffCalendar />
        <div className="staff-side">
          <TodayPanel />
          <NoticeBoard />
        </div>
      </div>
    </div>
  );
}
