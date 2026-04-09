import { Menu } from 'lucide-react';
import MonthPicker from '../common/MonthPicker';
import ThemeToggle from '../common/ThemeToggle';

export default function Header({ onMenuToggle }) {
  return (
    <header className="header glass">
      <div className="header-left">
        <button className="menu-btn" onClick={onMenuToggle} aria-label="메뉴">
          <Menu size={22} />
        </button>
        <MonthPicker />
      </div>
      <div className="header-right">
        <ThemeToggle />
      </div>
    </header>
  );
}
