import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Shield } from 'lucide-react';
import { isAdminUser } from '../lib/authPermissions';
import GeneralSettings from '../components/settings/GeneralSettings';
import LoginSettings from '../components/settings/LoginSettings';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const canManageLogin = isAdminUser(user);
  const [settingsSection, setSettingsSection] = useState('general');
  
  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">설정</h1>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-sm ${settingsSection === 'general' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSettingsSection('general')}
        >
          환경 설정
        </button>
        {canManageLogin && (
          <button
            type="button"
            className={`btn btn-sm ${settingsSection === 'login' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSettingsSection('login')}
          >
            로그인 관리
          </button>
        )}
      </div>

      {settingsSection === 'general' && (
        <>
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
    </div>
  );
}
