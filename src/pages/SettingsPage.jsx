import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  DatabaseBackup,
  Settings2,
  Shield,
  UsersRound,
} from 'lucide-react';
import { isAdminUser } from '../lib/authPermissions';
import GeneralSettings from '../components/settings/GeneralSettings';
import LoginSettings from '../components/settings/LoginSettings';
import BackupSettings from '../components/settings/BackupSettings';
import SupabaseConnectionSettings from '../components/settings/SupabaseConnectionSettings';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const canManageLogin = isAdminUser(user);
  const [settingsSection, setSettingsSection] = useState('general');
  
  return (
    <div className="animate-fade-in settings-page">
      <div className="page-header settings-page-header">
        <div>
          <h1 className="page-title">설정</h1>
          <p className="settings-page-description">앱 환경과 계정, 백업 기능을 관리합니다.</p>
        </div>
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
        <button
          type="button"
          className={`settings-page-tab${settingsSection === 'backup' ? ' active' : ''}`}
          onClick={() => setSettingsSection('backup')}
          aria-current={settingsSection === 'backup' ? 'page' : undefined}
        >
          <DatabaseBackup size={16} /> 백업
        </button>
      </nav>

      <div className="settings-page-content">
        {settingsSection === 'general' && (
          <>
            {canManageLogin && <SupabaseConnectionSettings />}
            <GeneralSettings />

            {/* 계정 */}
            <div className="card">
              <div className="card-header">
                <span className="card-title"><Shield size={18} /> 계정</span>
              </div>
              <div className="card-body">
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">{user?.email}</div>
                    <div className="settings-row-desc">현재 로그인된 계정</div>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={signOut}>로그아웃</button>
                </div>
              </div>
            </div>
          </>
        )}

        {settingsSection === 'login' && <LoginSettings canManageLogin={canManageLogin} />}
        {settingsSection === 'backup' && <BackupSettings />}
      </div>
    </div>
  );
}
