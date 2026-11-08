import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  DatabaseBackup,
  Settings2,
  Shield,
  UsersRound,
} from 'lucide-react';
import { isAdminUser, normalizePermissions, normalizeUsername } from '../lib/authPermissions';
import { supabase } from '../lib/supabaseClient';
import { loadActiveLegacyAppUserProfile } from '../lib/legacyAppUserAuth';
import GeneralSettings from '../components/settings/GeneralSettings';
import LoginSettings from '../components/settings/LoginSettings';
import BackupSettings from '../components/settings/BackupSettings';
import SupabaseConnectionSettings from '../components/settings/SupabaseConnectionSettings';

export default function SettingsPage() {
  const { user, signOut, refreshStoredUser } = useAuth();
  const canManageLogin = isAdminUser(user);
  const [settingsSection, setSettingsSection] = useState('general');

  useEffect(() => {
    if (!user?.isLocalDevUser) return;
    let cancelled = false;
    const username = normalizeUsername(user?.username || user?.email);
    if (!username) return;

    loadActiveLegacyAppUserProfile({
      supabaseClient: supabase,
      username,
    })
      .then((profile) => {
        if (cancelled) return;
        if (!profile) {
          signOut();
          return;
        }
        const verifiedRole = profile.role || 'user';
        const verifiedPermissions = normalizePermissions(profile.permissions, profile);
        const verifiedIsAdmin = verifiedRole === 'admin';
        if (user.app_role !== verifiedRole || user.isAdmin !== verifiedIsAdmin) {
          refreshStoredUser?.({
            ...user,
            username: profile.username,
            email: profile.username,
            user_metadata: { ...(user.user_metadata || {}), name: profile.display_name || profile.username },
            app_permissions: verifiedPermissions,
            app_role: verifiedRole,
            isAdmin: verifiedIsAdmin,
          });
        }
      })
      .catch(() => {
        // Keep current session when offline or unreachable.
      });

    return () => {
      cancelled = true;
    };
  }, [user?.username, user?.email, user?.isLocalDevUser]);

  useEffect(() => {
    if (!canManageLogin && (settingsSection === 'login' || settingsSection === 'backup')) {
      setSettingsSection('general');
    }
  }, [canManageLogin, settingsSection]);
  
  return (
    <div className="animate-fade-in settings-page">
      <header className="settings-page-toolbar">
        <div className="settings-page-heading">
          <h1 className="page-title">설정</h1>
          <p className="settings-page-description">앱 환경과 계정, 백업 기능을 관리합니다.</p>
        </div>

        <nav className="settings-page-tabs" aria-label="설정 메뉴">
          <button
            type="button"
            className={`settings-page-tab${settingsSection === 'general' ? ' active' : ''}`}
            onClick={() => setSettingsSection('general')}
            aria-current={settingsSection === 'general' ? 'page' : undefined}
          >
            <Settings2 size={16} />
            환경 설정
          </button>
          {canManageLogin && (
            <button
              type="button"
              className={`settings-page-tab${settingsSection === 'login' ? ' active' : ''}`}
              onClick={() => setSettingsSection('login')}
              aria-current={settingsSection === 'login' ? 'page' : undefined}
            >
              <UsersRound size={16} />
              로그인 관리
            </button>
          )}
          {canManageLogin && (
            <button
              type="button"
              className={`settings-page-tab${settingsSection === 'backup' ? ' active' : ''}`}
              onClick={() => setSettingsSection('backup')}
              aria-current={settingsSection === 'backup' ? 'page' : undefined}
            >
              <DatabaseBackup size={16} /> 백업
            </button>
          )}
        </nav>
      </header>

      <div className="settings-page-content">
        {settingsSection === 'general' && (
          <>
            <GeneralSettings />
            {canManageLogin && <SupabaseConnectionSettings />}

            {/* 계정 */}
            <div className="card settings-card settings-account-card">
              <div className="card-body settings-account-bar">
                <div className="settings-account-info">
                  <span className="settings-account-icon">
                    <Shield size={16} />
                  </span>
                  <div className="settings-account-text">
                    <div className="settings-account-title-row">
                      <span className="settings-account-title">계정</span>
                      <span className="settings-row-label">{user?.email}</span>
                      <span className={`settings-role-pill${canManageLogin ? ' is-admin' : ''}`}>
                        {canManageLogin ? '관리자' : '사용자'}
                      </span>
                    </div>
                    <div className="settings-row-desc">현재 로그인된 계정</div>
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={signOut}>로그아웃</button>
              </div>
            </div>
          </>
        )}

        {settingsSection === 'login' && canManageLogin && <LoginSettings canManageLogin={canManageLogin} />}
        {settingsSection === 'backup' && canManageLogin && <BackupSettings />}
      </div>
    </div>
  );
}
