import { NavLink } from 'react-router-dom';
import { Calendar, Zap, ZapOff, Settings } from 'lucide-react';

export default function BottomNav() {
  const items = [
    { path: '/', icon: Calendar, label: '근무표' },
    { path: '/shockwave', icon: Zap, label: '충격파 스케줄' },
    { path: '/settings', icon: Settings, label: '설정' },
  ];

  return (
    <nav className="bottom-nav glass">
      <div className="bottom-nav-items">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
              end={item.path === '/'}
            >
              <Icon size={22} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
