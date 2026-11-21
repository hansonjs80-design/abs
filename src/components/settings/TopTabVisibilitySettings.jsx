import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useToast } from '../common/Toast';
import { isAdminUser } from '../../lib/authPermissions';
import {
  COMBINED_STATS_TREATMENT_OPTIONS,
  HIDEABLE_TOP_TABS,
  buildHiddenTopTabsSettingsPayload,
  normalizeHiddenCombinedStatsTreatments,
  normalizeHiddenTopTabs,
  resolveEffectiveHiddenCombinedStatsTreatments,
  resolveEffectiveHiddenTopTabs,
  writeCachedHiddenCombinedStatsTreatments,
  writeCachedHiddenTopTabs,
} from '../../lib/topTabVisibilityUtils';

export default function TopTabVisibilitySettings() {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user);
  const { addToast } = useToast();
  const { shockwaveSettings, loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  const [hiddenTabs, setHiddenTabs] = useState(() => resolveEffectiveHiddenTopTabs(shockwaveSettings));
  const [hiddenTreatments, setHiddenTreatments] = useState(
    () => resolveEffectiveHiddenCombinedStatsTreatments(shockwaveSettings)
  );
  const [isSaving, setIsSaving] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    loadShockwaveSettings?.();
  }, [loadShockwaveSettings]);

  useEffect(() => {
    const resolvedHidden = resolveEffectiveHiddenTopTabs(shockwaveSettings);
    const resolvedTreatments = resolveEffectiveHiddenCombinedStatsTreatments(shockwaveSettings);
    setHiddenTabs(resolvedHidden);
    setHiddenTreatments(resolvedTreatments);
    writeCachedHiddenTopTabs(resolvedHidden);
    writeCachedHiddenCombinedStatsTreatments(resolvedTreatments);
  }, [shockwaveSettings]);

  const hiddenTreatmentLabels = useMemo(
    () => COMBINED_STATS_TREATMENT_OPTIONS
      .filter((item) => hiddenTreatments.includes(item.key))
      .map((item) => item.label),
    [hiddenTreatments]
  );

  if (!isAdmin) return null;

  const persistVisibilitySettings = (nextState, previousState, successMessage) => {
    const normalizedHiddenTabs = normalizeHiddenTopTabs(nextState.hiddenTabs);
    const normalizedHiddenTreatments = normalizeHiddenCombinedStatsTreatments(nextState.hiddenTreatments);

    setHiddenTabs(normalizedHiddenTabs);
    setHiddenTreatments(normalizedHiddenTreatments);
    writeCachedHiddenTopTabs(normalizedHiddenTabs);
    writeCachedHiddenCombinedStatsTreatments(normalizedHiddenTreatments);
    setIsSaving(true);

    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const latestSettings = (await loadShockwaveSettings?.()) || shockwaveSettings;
        const payload = buildHiddenTopTabsSettingsPayload(latestSettings, normalizedHiddenTabs, {
          hiddenCombinedStatsTreatments: normalizedHiddenTreatments,
        });
        const ok = await saveShockwaveSettings(payload);
        if (!ok) {
          setHiddenTabs(previousState.hiddenTabs);
          setHiddenTreatments(previousState.hiddenTreatments);
          writeCachedHiddenTopTabs(previousState.hiddenTabs);
          writeCachedHiddenCombinedStatsTreatments(previousState.hiddenTreatments);
          addToast('탭 및 통계 항목 표시 설정 저장에 실패했습니다.', 'error');
          return;
        }
        addToast(successMessage, 'success');
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const toggleTabVisible = (tabKey) => {
    const previous = { hiddenTabs, hiddenTreatments };
    const isCurrentlyHidden = hiddenTabs.includes(tabKey);
    const nextHiddenTabs = isCurrentlyHidden
      ? hiddenTabs.filter((key) => key !== tabKey)
      : [...hiddenTabs, tabKey];
    persistVisibilitySettings(
      { hiddenTabs: nextHiddenTabs, hiddenTreatments },
      previous,
      '상단 탭 표시 설정을 저장했습니다.'
    );
  };

  const toggleTreatmentVisible = (treatmentKey) => {
    const previous = { hiddenTabs, hiddenTreatments };
    const isCurrentlyHidden = hiddenTreatments.includes(treatmentKey);
    const nextHiddenTreatments = isCurrentlyHidden
      ? hiddenTreatments.filter((key) => key !== treatmentKey)
      : [...hiddenTreatments, treatmentKey];
    persistVisibilitySettings(
      { hiddenTabs, hiddenTreatments: nextHiddenTreatments },
      previous,
      '전체 통계 항목 표시 설정을 저장했습니다.'
    );
  };

  const resetAllVisible = () => {
    if (hiddenTabs.length === 0 && hiddenTreatments.length === 0) return;
    const previous = { hiddenTabs, hiddenTreatments };
    persistVisibilitySettings(
      { hiddenTabs: [], hiddenTreatments: [] },
      previous,
      '모든 상단 탭과 전체 통계 항목을 표시하도록 저장했습니다.'
    );
  };

  const hasAnyHidden = hiddenTabs.length > 0 || hiddenTreatments.length > 0;

  return (
    <div className="card settings-card top-tab-visibility-card">
      <div className="card-header">
        <div className="settings-card-heading">
          <h2 className="card-title">
            <Eye size={17} /> 상단 탭 및 통계 항목 표시 설정
          </h2>
          <p className="settings-card-description">
            관리자 전용 기능입니다. 체크를 해제한 상단 탭은 화면에서 숨겨지며(기존 동작 유지), 설정 탭은 항상 표시됩니다.
          </p>
        </div>
        {hasAnyHidden && (
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
            const isVisible = !isHidden;
            return (
              <label
                key={tab.key}
                className={`top-tab-visibility-item${isHidden ? ' is-hidden' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={() => toggleTabVisible(tab.key)}
                  disabled={isSaving}
                />
                <span className="top-tab-visibility-label">{tab.label}</span>
                <span className={`top-tab-visibility-badge${isHidden ? ' is-hidden' : ''}`}>
                  {isVisible ? (
                    <>
                      <Eye size={12} /> 표시
                    </>
                  ) : (
                    <>
                      <EyeOff size={12} /> 숨김
                    </>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        <div className="top-tab-combined-option top-tab-combined-option--stack">
          <div className="top-tab-combined-option-text">
            <div className="top-tab-combined-option-title">
              <BarChart3 size={15} />
              <span>전체 통계 항목 표시</span>
            </div>
            <p className="settings-card-description">
              체크를 해제한 항목은 전체 통계 탭(치료사 통계 · 전체 합계 · 전체 결산)의 모든 테이블과 합계에서 제외됩니다.
            </p>
            {hiddenTreatmentLabels.length > 0 && (
              <p className="top-tab-combined-option-status is-excluding">
                전체 통계에서 제외됨: {hiddenTreatmentLabels.join(', ')}
              </p>
            )}
          </div>
          <div className="top-tab-visibility-grid top-tab-combined-treatments-grid">
            {COMBINED_STATS_TREATMENT_OPTIONS.map((item) => {
              const isHidden = hiddenTreatments.includes(item.key);
              const isVisible = !isHidden;
              return (
                <label
                  key={item.key}
                  className={`top-tab-visibility-item${isHidden ? ' is-hidden' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleTreatmentVisible(item.key)}
                    disabled={isSaving}
                  />
                  <span className="top-tab-visibility-label">{item.label}</span>
                  <span className={`top-tab-visibility-badge${isHidden ? ' is-hidden' : ''}`}>
                    {isVisible ? (
                      <>
                        <Eye size={12} /> 포함
                      </>
                    ) : (
                      <>
                        <EyeOff size={12} /> 제외
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
