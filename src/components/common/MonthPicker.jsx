import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';

export default function MonthPicker({ suffix = '', variant = 'default' }) {
  const { currentYear, currentMonth, navigateMonth, goToMonth } = useSchedule();
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownYear, setDropdownYear] = useState(currentYear);
  const containerRef = useRef(null);
  const isToggling = useRef(false);
  const toggleTimerRef = useRef(null);

  const handleToggle = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isToggling.current) return;
    
    isToggling.current = true;
    setShowDropdown(prev => !prev);
    
    if (toggleTimerRef.current) {
      clearTimeout(toggleTimerRef.current);
    }
    toggleTimerRef.current = setTimeout(() => {
      isToggling.current = false;
      toggleTimerRef.current = null;
    }, 300); // Prevent double-toggling within 300ms
  };

  useEffect(() => {
    if (!showDropdown) return undefined;

    const handleClickOutside = (e) => {
      const target = e.target.nodeType === 3 ? e.target.parentNode : e.target;
      if (containerRef.current && !containerRef.current.contains(target)) {
        if (variant === 'tab' && target.closest && target.closest('.top-tab.active')) return;
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown, variant]);

  useEffect(() => {
    return () => {
      if (toggleTimerRef.current) {
        clearTimeout(toggleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setDropdownYear(currentYear);
  }, [currentYear]);

  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const labelText = useMemo(() => {
    const title = suffix ? ` ${suffix}` : '';
    return `${currentYear}년 ${String(currentMonth).padStart(2, '0')}월${title}`;
  }, [currentYear, currentMonth, suffix]);
  const tabMonthPrefix = useMemo(
    () => `${currentYear}년 ${String(currentMonth).padStart(2, '0')}월`,
    [currentYear, currentMonth]
  );

  return (
    <div 
      className={`month-picker${variant === 'tab' ? ' tab-variant' : ''}${variant === 'tab' && showDropdown ? ' dropdown-open' : ''}`} 
      ref={containerRef} 
      style={{ position: 'relative' }}
    >
      <button className="month-nav-btn" onClick={() => navigateMonth(-1)} aria-label="이전 달">
        <ChevronLeft size={18} />
      </button>

      <button
        type="button"
        className="month-picker-label"
        onClick={handleToggle}
        style={{ background: 'none', border: 'none', font: 'inherit', color: 'inherit', padding: 0, margin: 0, cursor: 'pointer' }}
      >
        {variant === 'tab' ? (
          <>
            <span className="tab-month-prefix">{tabMonthPrefix}</span>
            {suffix && <span className="tab-month-title">{suffix}</span>}
          </>
        ) : labelText}
      </button>

      <button className="month-nav-btn" onClick={() => navigateMonth(1)} aria-label="다음 달">
        <ChevronRight size={18} />
      </button>

      {showDropdown && (
        <div className={`month-dropdown-wrapper ${variant === 'tab' ? 'css-hover-dropdown' : ''}`}>
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
        </div>
      )}
    </div>
  );
}
