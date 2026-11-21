import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useToast } from '../common/Toast';
import { isAdminUser } from '../../lib/authPermissions';
import {
  COMBINED_STATS_TAB_TREATMENT_MAP,
  HIDEABLE_TOP_TABS,
  buildHiddenTopTabsSettingsPayload,
  normalizeHiddenTopTabs,
  resolveEffectiveHiddenTopTabs,
  resolveEffectiveIncludeHiddenTabsInCombinedStats,
  writeCachedHiddenTopTabs,
  writeCachedIncludeHiddenTabsInCombinedStats,
} from '../../lib/topTabVisibilityUtils';

export default function TopTabVisibilitySettings() {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user);
  const { addToast } = useToast();
  const { shockwaveSettings, loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  const [hiddenTabs, setHiddenTabs] = useState(() => resolveEffectiveHiddenTopTabs(shockwaveSettings));
  const [includeHiddenTabsInCombinedStats, setIncludeHiddenTabsInCombinedStats] = useState(
    () => resolveEffectiveIncludeHiddenTabsInCombinedStats(shockwaveSettings)
  );
  const [isSaving, setIsSaving] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    loadShockwaveSettings?.();
  }, [loadShockwaveSettings]);

  useEffect(() => {
    const resolvedHidden = resolveEffectiveHiddenTopTabs(shockwaveSettings);
    const resolvedInclude = resolveEffectiveIncludeHiddenTabsInCombinedStats(shockwaveSettings);
    setHiddenTabs(resolvedHidden);
    setIncludeHiddenTabsInCombinedStats(resolvedInclude);
    writeCachedHiddenTopTabs(resolvedHidden);
    writeCachedIncludeHiddenTabsInCombinedStats(resolvedInclude);
  }, [shockwaveSettings]);

  const hiddenCombinedTabLabels = useMemo(
    () => HIDEABLE_TOP_TABS
      .filter((tab) => COMBINED_STATS_TAB_TREATMENT_MAP[tab.key] && hiddenTabs.includes(tab.key))
      .map((tab) => tab.label),
    [hiddenTabs]
  );

  if (!isAdmin) return null;

  const persistVisibilitySettings = (nextState, previousState, successMessage) => {
    const normalizedHidden = normalizeHiddenTopTabs(nextState.hiddenTabs);
    const normalizedInclude = nextState.includeHiddenTabsInCombinedStats !== false;

    setHiddenTabs(normalizedHidden);
    setIncludeHiddenTabsInCombinedStats(normalizedInclude);
    writeCachedHiddenTopTabs(normalizedHidden);
    writeCachedIncludeHiddenTabsInCombinedStats(normalizedInclude);
    setIsSaving(true);

    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const latestSettings = (await loadShockwaveSettings?.()) || shockwaveSettings;
        const payload = buildHiddenTopTabsSettingsPayload(latestSettings, normalizedHidden, {
          includeHiddenTabsInCombinedStats: normalizedInclude,
        });
        const ok = await saveShockwaveSettings(payload);
        if (!ok) {
          setHiddenTabs(previousState.hiddenTabs);
          setIncludeHiddenTabsInCombinedStats(previousState.includeHiddenTabsInCombinedStats);
          writeCachedHiddenTopTabs(previousState.hiddenTabs);
          writeCachedIncludeHiddenTabsInCombinedStats(previousState.includeHiddenTabsInCombinedStats);
          addToast('상단 탭 숨김 설정 저장에 실패했습니다.', 'error');
          return;
        }
        addToast(successMessage, 'success');
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const toggleTabHidden = (tabKey) => {
    const previous = { hiddenTabs, includeHiddenTabsInCombinedStats };
    const isCurrentlyHidden = hiddenTabs.includes(tabKey);
    const nextHidden = isCurrentlyHidden
      ? hiddenTabs.filter((key) => key !== tabKey)
      : [...hiddenTabs, tabKey];
    persistVisibilitySettings(
      { hiddenTabs: nextHidden, includeHiddenTabsInCombinedStats },
      previous,
      '상단 탭 표시 설정을 저장했습니다.'
    );
  };

  const handleCombinedStatsInclusionChange = (nextInclude) => {
    if (nextInclude === includeHiddenTabsInCombinedStats) return;
    const previous = { hiddenTabs, includeHiddenTabsInCombinedStats };
    persistVisibilitySettings(
      { hiddenTabs, includeHiddenTabsInCombinedStats: nextInclude },
      previous,
      nextInclude
        ? '전체 통계에 숨김 탭 내용을 포함하도록 저장했습니다.'
        : '전체 통계에서 숨김 탭 내용을 제외하도록 저장했습니다.'
    );
  };

  const resetAllVisible = () => {
    if (hiddenTabs.length === 0) return;
    const previous = { hiddenTabs, includeHiddenTabsInCombinedStats };
    persistVisibilitySettings(
      { hiddenTabs: [], includeHiddenTabsInCombinedStats },
      previous,
      '모든 상단 탭을 표시하도록 저장했습니다.'
    );
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

        <div className="top-tab-combined-option">
          <div className="top-tab-combined-option-text">
            <div className="top-tab-combined-option-title">
              <BarChart3 size={15} />
              <span>전체 통계에 숨김 처리된 탭 내용 반영</span>
            </div>
            <p className="settings-card-description">
              충격파 통계·신장분사 통계·도수 통계 탭이 숨김 처리된 경우, 전체 통계(치료사 통계·전체 합계·전체 결산) 집계에 해당 내용을 포함할지 선택합니다.
            </p>
            {hiddenCombinedTabLabels.length > 0 && (
              <p className={`top-tab-combined-option-status${includeHiddenTabsInCombinedStats ? '' : ' is-excluding'}`}>
                {includeHiddenTabsInCombinedStats
                  ? `숨김 탭(${hiddenCombinedTabLabels.join(', ')})도 전체 통계에 포함됩니다.`
                  : `전체 통계에서 제외됨: ${hiddenCombinedTabLabels.join(', ')}`}
              </p>
            )}
          </div>
          <div className="top-tab-combined-option-toggle" role="group" aria-label="전체 통계에 숨김 탭 내용 포함 여부">
            <button
              type="button"
              className={`top-tab-combined-option-btn${includeHiddenTabsInCombinedStats ? ' is-active' : ''}`}
              aria-pressed={includeHiddenTabsInCombinedStats}
              onClick={() => handleCombinedStatsInclusionChange(true)}
              disabled={isSaving}
            >
              포함
            </button>
            <button
              type="button"
              className={`top-tab-combined-option-btn${!includeHiddenTabsInCombinedStats ? ' is-active' : ''}`}
              aria-pressed={!includeHiddenTabsInCombinedStats}
              onClick={() => handleCombinedStatsInclusionChange(false)}
              disabled={isSaving}
            >
              포함하지 않음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
