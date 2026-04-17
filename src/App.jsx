import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ScheduleProvider } from './contexts/ScheduleContext';
import { ToastProvider } from './components/common/Toast';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import StaffSchedulePage from './pages/StaffSchedulePage';
import ShockwavePage from './pages/ShockwavePage';
import ShockwaveStatsPage from './pages/ShockwaveStatsPage';
import ManualTherapyStatsPage from './pages/ManualTherapyStatsPage';
import SettingsPage from './pages/SettingsPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <ScheduleProvider>
              <Layout />
            </ScheduleProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<StaffSchedulePage />} />
        <Route path="/shockwave" element={<ShockwavePage />} />
        <Route path="/shockwave-stats" element={<ShockwaveStatsPage />} />
        <Route path="/manual-therapy-stats" element={<ManualTherapyStatsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
