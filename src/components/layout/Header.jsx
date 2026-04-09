import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import MonthPicker from '../common/MonthPicker';
import ThemeToggle from '../common/ThemeToggle';

export default function Header({ onMenuToggle }) {
  const location = useLocation();
  
  const pageTitles = {
    '/': '직원 근무 스케줄',
    '/shockwave': '충격파 통합 스케줄러',
    '/settings': '설정 / 관리',
  };

  const pageTitle = pageTitles[location.pathname] || '';

  return (
    <header className="header glass">
      <div className="header-left">
        <button className="menu-btn" onClick={onMenuToggle} aria-label="메뉴">
          <Menu size={22} />
        </button>
        {pageTitle && location.pathname !== '/settings' && (
          <div className="header-title" style={{ fontSize: '1.2rem', marginRight: '16px', display: 'flex', alignItems: 'center' }}>
            {pageTitle}
          </div>
        )}
        {(location.pathname === '/' || location.pathname.includes('shockwave')) && <MonthPicker />}
        {location.pathname === '/settings' && <div className="header-title" style={{ fontSize: '1.3rem' }}>{pageTitle}</div>}
      </div>
      <div className="header-right">
        <ThemeToggle />
      </div>
    </header>
  );
}
