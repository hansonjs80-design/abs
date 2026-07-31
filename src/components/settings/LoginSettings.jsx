import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../common/Toast';
import {
  Save,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import {
  ADMIN_USERNAME,
  APP_TABS,
  createDefaultPermissions,
  normalizeUsername,
} from '../../lib/authPermissions';
import { useAuth } from '../../contexts/AuthContext';

export default function LoginSettings({ canManageLogin }) {
  const { user, refreshStoredUser } = useAuth();
  const { addToast } = useToast();
  const [appUsers, setAppUsers] = useState([]);
  const [newAppUser, setNewAppUser] = useState({
    username: '',
    password: '',
    display_name: '',
    role: 'user',
    permissions: createDefaultPermissions(),
    is_active: true,
  });

  const loadAppUsers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, username, display_name, role, permissions, is_active, created_at, updated_at')
        .order('role', { ascending: true })
        .order('username', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      setAppUsers(rows.map((row) => ({
        ...row,
        password: '',
        permissions: {
          ...createDefaultPermissions(),
          ...(row.permissions || {}),
        },
      })));
    } catch (err) {
      console.error('Failed to load app users:', err);
      addToast('로그인 사용자 목록을 불러오지 못했습니다. SQL 테이블을 먼저 생성해주세요.', 'error');
    }
  }, [addToast]);

  useEffect(() => {
    if (canManageLogin) loadAppUsers();
  }, [canManageLogin, loadAppUsers]);

  const addAppUser = async () => {
    const username = normalizeUsername(newAppUser.username);
    const password = String(newAppUser.password || '').trim();
    if (!username || !password) {
      addToast('아이디와 비밀번호를 입력해주세요.', 'error');
      return;
    }
    if (appUsers.some((item) => item.username === username)) {
      addToast('이미 존재하는 아이디입니다.', 'error');
      return;
    }
    try {
      const row = {
        username,
        password,
        display_name: newAppUser.display_name.trim() || username,
        role: username === ADMIN_USERNAME ? 'admin' : newAppUser.role,
        permissions: username === ADMIN_USERNAME ? createDefaultPermissions() : newAppUser.permissions,
        is_active: true,
      };
      const { error } = await supabase.from('app_users').insert(row);
      if (error) throw error;
      setNewAppUser({
        username: '',
        password: '',
        display_name: '',
        role: 'user',
        permissions: createDefaultPermissions(),
        is_active: true,
      });
      addToast('사용자가 추가되었습니다.', 'success');
      loadAppUsers();
    } catch (err) {
      addToast('사용자 추가 실패: ' + (err.message || err), 'error');
    }
  };

  const updateAppUserLocal = (id, field, value) => {
    setAppUsers((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      return { ...row, [field]: value };
    }));
  };

  const toggleAppUserPermission = (id, key) => {
    setAppUsers((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      return {
        ...row,
        permissions: {
          ...createDefaultPermissions(),
          ...(row.permissions || {}),
          [key]: row.username === ADMIN_USERNAME ? true : !(row.permissions?.[key] !== false),
        },
      };
    }));
  };

  const saveAppUser = async (row) => {
    const username = normalizeUsername(row.username);
    const password = String(row.password || '').trim();
    if (!username) {
      addToast('아이디는 비워둘 수 없습니다.', 'error');
      return;
    }
    const isAdminRow = username === ADMIN_USERNAME || row.role === 'admin';
    const payload = {
      username,
      display_name: String(row.display_name || '').trim() || username,
      role: isAdminRow ? 'admin' : 'user',
      permissions: isAdminRow ? createDefaultPermissions() : {
        ...createDefaultPermissions(),
        ...(row.permissions || {}),
      },
      is_active: Boolean(row.is_active),
      updated_at: new Date().toISOString(),
    };
    if (password) payload.password = password;

    try {
      const { error } = await supabase.from('app_users').update(payload).eq('id', row.id);
      if (error) throw error;
      addToast('사용자 설정이 저장되었습니다.', 'success');
      if (normalizeUsername(user?.email) === username && refreshStoredUser) {
        refreshStoredUser({
          ...user,
          username,
          email: username,
          user_metadata: { ...(user.user_metadata || {}), name: payload.display_name },
          app_permissions: payload.permissions,
          app_role: payload.role,
          isAdmin: payload.role === 'admin',
        });
      }
      loadAppUsers();
    } catch (err) {
      addToast('사용자 저장 실패: ' + (err.message || err), 'error');
    }
  };

  const deactivateAppUser = async (row) => {
    if (normalizeUsername(row.username) === ADMIN_USERNAME || row.role === 'admin') {
      addToast('관리자 계정은 비활성화할 수 없습니다.', 'error');
      return;
    }
    try {
      const { error } = await supabase
        .from('app_users')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      addToast('사용자가 비활성화되었습니다.', 'success');
      loadAppUsers();
    } catch (err) {
      addToast('사용자 비활성화 실패: ' + (err.message || err), 'error');
    }
  };

  if (!canManageLogin) return null;

  return (
    <div className="card settings-card login-settings-card">
      <div className="card-header">
        <div>
          <span className="card-title"><Users size={18} /> 로그인 관리</span>
          <p className="settings-card-description">사용자 계정과 화면별 접근 권한을 관리합니다.</p>
        </div>
        <span className="settings-count-badge">{appUsers.length}명</span>
      </div>
      <div className="card-body login-settings-body">
        <form
          className="login-create-panel"
          onSubmit={(event) => {
            event.preventDefault();
            addAppUser();
          }}
        >
          <div className="settings-subtitle">새 사용자 추가</div>
          <div className="login-create-grid">
            <label className="settings-control">
              <span>아이디</span>
              <input
                className="form-input"
                placeholder="로그인 아이디"
                value={newAppUser.username}
                onChange={(e) => setNewAppUser((prev) => ({ ...prev, username: e.target.value }))}
              />
            </label>
            <label className="settings-control">
              <span>비밀번호</span>
              <input
                className="form-input"
                type="password"
                placeholder="초기 비밀번호"
                value={newAppUser.password}
                onChange={(e) => setNewAppUser((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <label className="settings-control">
              <span>표시 이름</span>
              <input
                className="form-input"
                placeholder="화면에 표시할 이름"
                value={newAppUser.display_name}
                onChange={(e) => setNewAppUser((prev) => ({ ...prev, display_name: e.target.value }))}
              />
            </label>
            <label className="settings-control">
              <span>역할</span>
              <select
                className="form-input"
                value={newAppUser.role}
                onChange={(e) => setNewAppUser((prev) => ({
                  ...prev,
                  role: e.target.value,
                  permissions: e.target.value === 'admin' ? createDefaultPermissions() : prev.permissions,
                }))}
              >
                <option value="user">사용자</option>
                <option value="admin">관리자</option>
              </select>
            </label>
            <button className="btn btn-primary btn-sm login-add-button" type="submit">
              <UserPlus size={15} />
              사용자 추가
            </button>
          </div>
        </form>

        <div className="login-users-header">
          <span className="settings-subtitle">등록된 사용자</span>
          <span>비밀번호는 변경할 때만 입력합니다.</span>
        </div>

        <div className="login-users-table-wrap">
          <table className="login-users-table">
            <thead>
              <tr>
                <th>아이디</th>
                <th>새 비밀번호</th>
                <th>표시 이름</th>
                <th>역할</th>
                <th>탭 권한</th>
                <th>사용</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {appUsers.map((row) => {
                const adminRow = row.username === ADMIN_USERNAME || row.role === 'admin';
                const permissions = {
                  ...createDefaultPermissions(),
                  ...(row.permissions || {}),
                };
                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        className="form-input"
                        value={row.username}
                        disabled={adminRow}
                        onChange={(e) => updateAppUserLocal(row.id, 'username', normalizeUsername(e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        className="form-input"
                        type="password"
                        value={row.password || ''}
                        placeholder="변경할 때만 입력"
                        autoComplete="new-password"
                        onChange={(e) => updateAppUserLocal(row.id, 'password', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-input"
                        value={row.display_name || ''}
                        onChange={(e) => updateAppUserLocal(row.id, 'display_name', e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="form-input"
                        value={adminRow ? 'admin' : row.role || 'user'}
                        disabled={row.username === ADMIN_USERNAME}
                        onChange={(e) => updateAppUserLocal(row.id, 'role', e.target.value)}
                      >
                        <option value="user">사용자</option>
                        <option value="admin">관리자</option>
                      </select>
                    </td>
                    <td>
                      <div className="login-permissions">
                        {APP_TABS.map((tab) => (
                          <label
                            key={`${row.id}-${tab.key}`}
                            className={`login-permission-chip${permissions[tab.key] !== false ? ' active' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={adminRow || permissions[tab.key] !== false}
                              disabled={adminRow}
                              onChange={() => toggleAppUserPermission(row.id, tab.key)}
                            />
                            {tab.label}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <label className="login-active-toggle">
                        <input
                          type="checkbox"
                          checked={row.is_active !== false}
                          disabled={adminRow}
                          onChange={(e) => updateAppUserLocal(row.id, 'is_active', e.target.checked)}
                        />
                        <span>{row.is_active !== false ? '사용' : '중지'}</span>
                      </label>
                    </td>
                    <td>
                      <div className="login-row-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => saveAppUser(row)}>
                          <Save size={14} />
                          저장
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={adminRow || row.is_active === false}
                          onClick={() => deactivateAppUser(row)}
                        >
                          <UserX size={14} />
                          중지
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {appUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="login-users-empty">등록된 사용자가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="settings-help-text login-settings-help">
          관리자 계정은 모든 탭 권한을 가지며 사용을 중지할 수 없습니다.
        </p>
      </div>
    </div>
  );
}
