import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useToast } from '../common/Toast';
import { isAdminUser } from '../../lib/authPermissions';
import {
  HIDEABLE_TOP_TABS,
  buildHiddenTopTabsSettingsPayload,
  normalizeHiddenTopTabs,
  resolveEffectiveHiddenTopTabs,
  writeCachedHiddenTopTabs,
} from '../../lib/topTabVisibilityUtils';

export default function TopTabVisibilitySettings() {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user);
  const { addToast } = useToast();
  const { shockwaveSettings, loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  const [hiddenTabs, setHiddenTabs] = useState(() => resolveEffectiveHiddenTopTabs(shockwaveSettings));
  const [isSaving, setIsSaving] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    loadShockwaveSettings?.();
  }, [loadShockwaveSettings]);

  useEffect(() => {
    const resolved = resolveEffectiveHiddenTopTabs(shockwaveSettings);
    setHiddenTabs(resolved);
    writeCachedHiddenTopTabs(resolved);
  }, [shockwaveSettings]);

  if (!isAdmin) return null;

  const persistHiddenTabs = (nextHiddenTabs, previousHiddenTabs) => {
    const normalized = normalizeHiddenTopTabs(nextHiddenTabs);
    setHiddenTabs(normalized);
    writeCachedHiddenTopTabs(normalized);
    setIsSaving(true);

    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const latestSettings = (await loadShockwaveSettings?.()) || shockwaveSettings;
        const payload = buildHiddenTopTabsSettingsPayload(latestSettings, normalized);
        const ok = await saveShockwaveSettings(payload);
        if (!ok) {
          setHiddenTabs(previousHiddenTabs);
          writeCachedHiddenTopTabs(previousHiddenTabs);
          addToast('상단 탭 숨김 설정 저장에 실패했습니다.', 'error');
          return;
        }
        addToast('상단 탭 표시 설정을 저장했습니다.', 'success');
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const toggleTabHidden = (tabKey) => {
    const previous = hiddenTabs;
    const isCurrentlyHidden = previous.includes(tabKey);
    const next = isCurrentlyHidden
      ? previous.filter((key) => key !== tabKey)
      : [...previous, tabKey];
    persistHiddenTabs(next, previous);
  };

  const resetAllVisible = () => {
    if (hiddenTabs.length === 0) return;
    persistHiddenTabs([], hiddenTabs);
  };

  return (
    <div className="card settings-card top-tab-visibility-card">
      <div className="card-header">
        <div className="settings-card-heading">
          <h2 className="card-title">
            <EyeOff size={17} /> 상단 탭 숨김 설정
          </h2>
          <p className="settings-card-description">
            관리자 전용 기능입니다. 체크된 탭은 상단 탭 바에서 숨겨지며 기존 기능과 데이터 동작은 그대로 유지됩니다. (설정 탭은 항상 표시)
          </p>
        </div>
        {hiddenTabs.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={resetAllVisible}
            disabled={isSaving}
          >
            <RotateCcw size={14} /> 모두 표시
          </button>
        )}
      </div>
      <div className="card-body">
        <div className="top-tab-visibility-grid">
          {HIDEABLE_TOP_TABS.map((tab) => {
            const isHidden = hiddenTabs.includes(tab.key);
            return (
              <label
                key={tab.key}
                className={`top-tab-visibility-item${isHidden ? ' is-hidden' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isHidden}
                  onChange={() => toggleTabHidden(tab.key)}
                  disabled={isSaving}
                />
                <span className="top-tab-visibility-label">{tab.label}</span>
                <span className={`top-tab-visibility-badge${isHidden ? ' is-hidden' : ''}`}>
                  {isHidden ? (
                    <>
                      <EyeOff size={12} /> 숨김
                    </>
                  ) : (
                    <>
                      <Eye size={12} /> 표시
                    </>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
