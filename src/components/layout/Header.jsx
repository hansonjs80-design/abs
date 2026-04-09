import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import MonthPicker from '../common/MonthPicker';
import ThemeToggle from '../common/ThemeToggle';

export default function Header({ onMenuToggle }) {
  const location = useLocation();
  
  const pageLabels = {
    '/': '직원 근무표',
    '/shockwave': '충격파/도수 스케줄',
    '/settings': '설정 / 관리',
  };

  const pageLabel = pageLabels[location.pathname] || '';

  return (
    <header className="header glass">
      <div className="header-left">
        <button className="menu-btn" onClick={onMenuToggle} aria-label="메뉴">
          <Menu size={22} />
        </button>
        {(location.pathname === '/' || location.pathname.includes('shockwave')) && (
          <>
            <MonthPicker />
            <span className="header-title" style={{ fontSize: '1.1rem', marginLeft: '8px' }}>{pageLabel}</span>
          </>
        )}
        {location.pathname === '/settings' && <div className="header-title" style={{ fontSize: '1.2rem' }}>{pageLabel}</div>}
      </div>
      <div className="header-right">
        <ThemeToggle />
      </div>
    </header>
  );
}
