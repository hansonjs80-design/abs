import { useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';

const PRINT_STYLE_ID = 'clinic-print-orientation-style';

function setPrintOrientation(orientation) {
  document.documentElement.dataset.printOrientation = orientation;

  let style = document.getElementById(PRINT_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = `@media print { @page { size: ${orientation}; margin: 6mm; } }`;
}

export default function PrintButton({ isStaffSchedule }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handlePrint = (orientation, calendarOnly = false) => {
    setPrintOrientation(orientation);
    
    if (calendarOnly) {
      document.body.classList.add('calendar-only-print');
    } else {
      document.body.classList.remove('calendar-only-print');
    }
    
    setIsOpen(false);
    
    window.setTimeout(() => {
      window.print();
      // Remove the class after the print dialog opens
      window.setTimeout(() => {
        document.body.classList.remove('calendar-only-print');
      }, 500);
    }, 0);
  };

  return (
    <div className="print-menu-root" ref={rootRef}>
      <button
        className="print-toggle"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="현재 화면 인쇄"
        title="현재 화면 인쇄"
        aria-expanded={isOpen}
      >
        <Printer size={20} />
      </button>
      {isOpen && (
        <div className="print-orientation-menu" role="menu" aria-label="인쇄 방향 선택">
          <button type="button" onClick={() => handlePrint('landscape')} role="menuitem">
            가로
          </button>
          <button type="button" onClick={() => handlePrint('portrait')} role="menuitem">
            세로
          </button>
          {isStaffSchedule && (
            <button type="button" onClick={() => handlePrint('landscape', true)} role="menuitem" style={{ color: 'var(--brand-primary)', fontWeight: 600 }}>
              달력만 인쇄 (가로)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
