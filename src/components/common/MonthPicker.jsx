import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';

export default function MonthPicker() {
  const { currentYear, currentMonth, navigateMonth, goToMonth } = useSchedule();
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownYear, setDropdownYear] = useState(currentYear);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setDropdownYear(currentYear);
  }, [currentYear]);

  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;

  return (
    <div className="month-picker" ref={ref} style={{ position: 'relative' }}>
      <button className="month-nav-btn" onClick={() => navigateMonth(-1)} aria-label="이전 달">
        <ChevronLeft size={18} />
      </button>

      <span
        className="month-picker-label"
        onClick={() => setShowDropdown(!showDropdown)}
        role="button"
        tabIndex={0}
      >
        {currentYear}년 {currentMonth}월
      </span>

      <button className="month-nav-btn" onClick={() => navigateMonth(1)} aria-label="다음 달">
        <ChevronRight size={18} />
      </button>

      {showDropdown && (
        <div className="month-dropdown">
          <div className="month-dropdown-year">
            <button className="btn-icon" onClick={() => setDropdownYear(y => y - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span>{dropdownYear}년</span>
            <button className="btn-icon" onClick={() => setDropdownYear(y => y + 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="month-grid">
            {months.map((m, i) => {
              const isActive = dropdownYear === currentYear && i + 1 === currentMonth;
              const isCurrent = dropdownYear === todayYear && i + 1 === todayMonth;
              return (
                <button
                  key={i}
                  className={`month-grid-item${isActive ? ' active' : ''}${isCurrent && !isActive ? ' current' : ''}`}
                  onClick={() => { goToMonth(dropdownYear, i + 1); setShowDropdown(false); }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
