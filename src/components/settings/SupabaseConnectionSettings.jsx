import { useState } from 'react';
import {
  Database,
  Eye,
  EyeOff,
  RotateCcw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { useToast } from '../common/Toast';
import {
  clearSupabaseConnectionSettings,
  loadSupabaseConnectionSettings,
  saveSupabaseConnectionSettings,
  validateSupabaseConnection,
} from '../../lib/supabaseConnectionSettings';
import './SupabaseConnectionSettings.css';

export default function SupabaseConnectionSettings() {
  const { addToast } = useToast();
  const [initialState] = useState(() => loadSupabaseConnectionSettings());
  const [connection, setConnection] = useState(initialState.connection);
  const [errors, setErrors] = useState({});
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const isUsingDeviceOverride = initialState.source === 'device';
  const hasBrokenOverride = initialState.hasStoredOverride && !initialState.storedOverrideValid;
  const hasBuildDefaults = Boolean(initialState.defaults.url && initialState.defaults.anonKey);

  const updateField = (field, value) => {
    setConnection((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: '' }));
  };

  const reloadApp = () => {
    window.setTimeout(() => window.location.reload(), 180);
  };

  const handleSave = () => {
    const validation = validateSupabaseConnection(connection);
    if (!validation.valid) {
      setErrors(validation.errors);
      addToast('Supabase 연결 정보를 확인해 주세요.', 'error');
      return;
    }

    const confirmed = window.confirm(
      '이 기기에서 사용할 Supabase 서버를 변경하고 앱을 새로고침할까요?\n\n기존 서버의 데이터는 삭제하거나 수정하지 않습니다.',
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      saveSupabaseConnectionSettings(validation.value);
      addToast('Supabase 연결 설정을 이 기기에 저장했습니다. 새 연결로 다시 시작합니다.', 'success');
      reloadApp();
    } catch (error) {
      setBusy(false);
      setErrors(error?.validationErrors || {});
      addToast(error?.message || 'Supabase 연결 설정을 저장하지 못했습니다.', 'error');
    }
  };

  const handleRestoreDefaults = () => {
    if (!hasBuildDefaults) {
      addToast('앱에 포함된 기본 Supabase 연결값이 없습니다.', 'error');
      return;
    }

    const confirmed = window.confirm(
      '이 기기에 저장된 Supabase 연결 설정을 지우고 기본 서버로 복원할까요?',
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      clearSupabaseConnectionSettings();
      addToast('기본 Supabase 서버로 복원했습니다. 앱을 다시 시작합니다.', 'success');
      reloadApp();
    } catch (error) {
      setBusy(false);
      addToast(error?.message || '기본 연결 설정을 복원하지 못했습니다.', 'error');
    }
  };

  return (
    <div className="card supabase-connection-card">
      <div className="card-header supabase-connection-header">
        <span className="card-title">
          <Database size={18} />
          Supabase 서버 연결
        </span>
        <span className={`supabase-connection-badge ${isUsingDeviceOverride ? 'is-device' : ''}`}>
          {isUsingDeviceOverride ? '이 기기 사용자 설정' : '앱 기본 설정'}
        </span>
      </div>

      <div className="card-body">
        <div className="supabase-connection-notice">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>공개용 anon/publishable key만 입력하세요.</strong>
            <span>service_role 또는 secret key는 보안을 위해 저장할 수 없습니다. 변경값은 이 브라우저에만 보관됩니다.</span>
          </div>
        </div>

        {hasBrokenOverride && (
          <div className="supabase-connection-warning">
            저장된 연결값이 올바르지 않아 현재는 앱 기본 설정을 사용하고 있습니다.
          </div>
        )}

        <div className="supabase-connection-fields">
          <label className="supabase-connection-field">
            <span>Supabase 프로젝트 URL</span>
            <input
              className={`form-input ${errors.url ? 'is-error' : ''}`}
              type="url"
              value={connection.url}
              onChange={(event) => updateField('url', event.target.value)}
              placeholder="https://프로젝트주소.supabase.co"
              autoComplete="off"
              spellCheck={false}
            />
            {errors.url && <small className="supabase-connection-error">{errors.url}</small>}
          </label>

          <label className="supabase-connection-field">
            <span>공개용 anon/publishable key</span>
            <div className="supabase-key-input">
              <input
                className={`form-input ${errors.anonKey ? 'is-error' : ''}`}
                type={showKey ? 'text' : 'password'}
                value={connection.anonKey}
                onChange={(event) => updateField('anonKey', event.target.value)}
                placeholder="Supabase 공개용 key"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="supabase-key-toggle"
                onClick={() => setShowKey((previous) => !previous)}
                aria-label={showKey ? 'Supabase key 숨기기' : 'Supabase key 보기'}
                title={showKey ? '키 숨기기' : '키 보기'}
              >
                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.anonKey && <small className="supabase-connection-error">{errors.anonKey}</small>}
          </label>
        </div>

        <div className="supabase-connection-footer">
          <p>
            저장하면 앱이 새로고침되며 새 서버로 연결됩니다. 기존 서버의 데이터에는 아무 작업도 하지 않습니다.
          </p>
          <div className="supabase-connection-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRestoreDefaults}
              disabled={busy || !hasBuildDefaults}
            >
              <RotateCcw size={16} />
              기본 서버 복원
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={busy}
            >
              <Save size={16} />
              저장 후 새로고침
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
