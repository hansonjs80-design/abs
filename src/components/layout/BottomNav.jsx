import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllowedTabs } from '../../lib/authPermissions';

export default function BottomNav() {
  const { user } = useAuth();
  const items = getAllowedTabs(user);

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
              <span>{item.shortLabel || item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
