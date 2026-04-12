import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import TopTabs from './TopTabs';

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () => {
    if (window.innerWidth <= 768) setMobileOpen(!mobileOpen);
  };

  return (
    <div className="app-layout">
      <Sidebar 
        isOpen={mobileOpen} 
        isCollapsed={false}
        onClose={() => setMobileOpen(false)} 
      />
      <div className="app-main">
        <Header onMenuToggle={toggleSidebar} />
        <TopTabs />
        <main className="app-content">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
