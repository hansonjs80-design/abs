import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ScheduleProvider } from './contexts/ScheduleContext';
import { PresenceProvider } from './contexts/PresenceContext';
import { ToastProvider } from './components/common/Toast';
import Layout from './components/layout/Layout';
import { canAccessPath, getFirstAllowedPath } from './lib/authPermissions';

const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const StaffSchedulePage = React.lazy(() => import('./pages/StaffSchedulePage'));
const ShockwavePage = React.lazy(() => import('./pages/ShockwavePage'));
const ShockwaveStatsPage = React.lazy(() => import('./pages/ShockwaveStatsPage'));
const ManualTherapyStatsPage = React.lazy(() => import('./pages/ManualTherapyStatsPage'));
const PhysicalTherapyStatsPage = React.lazy(() => import('./pages/PhysicalTherapyStatsPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));

function PageFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, background: 'var(--bg-primary)' }}>
      <div className="spinner" />
    </div>
  );
}

function LazyPage({ children }) {
  return (
    <Suspense fallback={<PageFallback />}>
      {children}
    </Suspense>
  );
}

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
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LazyPage><LoginPage /></LazyPage>} />
      <Route
        element={
          <ProtectedRoute>
            <ScheduleProvider>
              <PresenceProvider>
                <Layout />
              </PresenceProvider>
            </ScheduleProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<ProtectedRoute path="/"><LazyPage><StaffSchedulePage /></LazyPage></ProtectedRoute>} />
        <Route path="/shockwave" element={<ProtectedRoute path="/shockwave"><LazyPage><ShockwavePage /></LazyPage></ProtectedRoute>} />
        <Route path="/shockwave-stats" element={<ProtectedRoute path="/shockwave-stats"><LazyPage><ShockwaveStatsPage /></LazyPage></ProtectedRoute>} />
        <Route path="/manual-therapy-stats" element={<ProtectedRoute path="/manual-therapy-stats"><LazyPage><ManualTherapyStatsPage /></LazyPage></ProtectedRoute>} />
        <Route path="/pt-stats" element={<ProtectedRoute path="/pt-stats"><LazyPage><PhysicalTherapyStatsPage /></LazyPage></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute path="/settings"><LazyPage><SettingsPage /></LazyPage></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || '' };
  }

  componentDidCatch(error) {
    console.error('App global routing failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary, #fff)', color: 'var(--text-primary, #000)' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 12 }}>화면을 불러오는 중 오류가 발생했습니다.</div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #666)', marginBottom: 24 }}>일시적인 문제일 수 있습니다. 화면을 새로고침해주세요.</div>
          {this.state.errorMessage && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary, #999)', marginBottom: 24, padding: '0 20px', textAlign: 'center', wordBreak: 'break-all' }}>
              {this.state.errorMessage}
            </div>
          )}
          <button 
            type="button" 
            onClick={() => window.location.reload()}
            style={{ padding: '8px 16px', background: 'var(--brand-primary, #2563eb)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem', fontWeight: 600 }}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <GlobalErrorBoundary>
              <AppRoutes />
            </GlobalErrorBoundary>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
