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
import { canAccessPath, getFirstAllowedPath } from './lib/authPermissions';

function ProtectedRoute({ children, path }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (path && !canAccessPath(user, path)) {
    return <Navigate to={getFirstAllowedPath(user)} replace />;
  }
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
        <Route path="/" element={<ProtectedRoute path="/"><StaffSchedulePage /></ProtectedRoute>} />
        <Route path="/shockwave" element={<ProtectedRoute path="/shockwave"><ShockwavePage /></ProtectedRoute>} />
        <Route path="/shockwave-stats" element={<ProtectedRoute path="/shockwave-stats"><ShockwaveStatsPage /></ProtectedRoute>} />
        <Route path="/manual-therapy-stats" element={<ProtectedRoute path="/manual-therapy-stats"><ManualTherapyStatsPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute path="/settings"><SettingsPage /></ProtectedRoute>} />
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
