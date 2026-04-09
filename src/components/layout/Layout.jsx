import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  const toggleSidebar = () => {
    if (window.innerWidth <= 768) {
      setMobileOpen(!mobileOpen);
    } else {
      setDesktopCollapsed(!desktopCollapsed);
    }
  };

  return (
    <div className={`app-layout ${desktopCollapsed ? 'desktop-collapsed' : ''}`}>
      <Sidebar 
        isOpen={mobileOpen} 
        isCollapsed={desktopCollapsed}
        onClose={() => setMobileOpen(false)} 
      />
      <div className="app-main">
        <Header onMenuToggle={toggleSidebar} />
        <main className="app-content">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
