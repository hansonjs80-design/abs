import { useMemo, useState, useEffect, useRef } from 'react';

import {
  getEffectiveSchedulerTextSettings,
  readLocalSchedulerTextSettings,
  SCHEDULER_TEXT_SETTINGS_EVENT,
  SCHEDULER_TEXT_SETTINGS_KEY,
  syncLoadTextSettings,
  syncSaveTextSettings,
} from '../../lib/schedulerTextSettings';
import { formatScheduleShortcutLabel } from '../../lib/scheduleKeyboardUtils';
import { filterPrescriptionColorMap, normalizePrescriptionColorKey } from '../../lib/schedulerUtils';
import {
  getEffectiveSettlementSettings,
  getEffectiveShinjangSpraySettings,
} from '../../lib/settlementSettings';

export default function useScheduleViewState({
  currentMonth,
  currentYear,
  memos,
  normalizeKeysToMergeMasters,
  selectedKeys,
  settings,
  treatmentCompleteBg,
}) {
  const hasCompletableSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    return Array.from(effectiveKeys).some((key) => String(memos[key]?.content || '').trim());
  }, [selectedKeys, memos, normalizeKeysToMergeMasters]);

  const hasCompletedSelection = useMemo(() => {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    const effectiveKeys = normalizeKeysToMergeMasters(selectedKeys);
    return Array.from(effectiveKeys).some((key) => {
      const memo = memos[key];
      return String(memo?.content || '').trim() && memo?.bg_color === treatmentCompleteBg;
    });
  }, [selectedKeys, memos, normalizeKeysToMergeMasters, treatmentCompleteBg]);

  const treatmentCompleteButtonLabel = hasCompletedSelection ? '방문취소' : '방문완료';

  const isAppleShortcutPlatform = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
  }, []);

  const shortcutLabels = useMemo(() => {
    const mod = isAppleShortcutPlatform ? '⌘' : 'Ctrl';
    const join = (...keys) => isAppleShortcutPlatform ? keys.join('') : keys.join('+');
    return {
      modifier: mod,
      manualPrescriptionModifier: isAppleShortcutPlatform ? '⌥' : 'Alt',
      shinjangPrescriptionModifier: isAppleShortcutPlatform ? '⌘⇧' : 'Ctrl+Shift',
      copy: join(mod, 'C'),
      cut: join(mod, 'X'),
      paste: join(mod, 'V'),
      memo: formatScheduleShortcutLabel('+', mod),
      merge: join(mod, 'G'),
      complete: join(mod, 'S'),
      cancel: join(mod, 'D'),
      today: join(mod, 'T'),
      patientHistory: isAppleShortcutPlatform ? 'Cmd+F' : 'Ctrl+F',
    };
  }, [isAppleShortcutPlatform]);

  const effectivePrescriptionColors = useMemo(() => {
    const shockwaveSettlement = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'shockwave');
    const manualSettlement = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'manual_therapy');
    const shinjangSpraySettlement = getEffectiveShinjangSpraySettings(settings, currentYear, currentMonth);
    const monthlyEntries = settings?.monthly_settlement_settings && typeof settings.monthly_settlement_settings === 'object'
      ? settings.monthly_settlement_settings
      : {};
    const paddedMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const legacyMonthKey = `${currentYear}-${currentMonth}`;
    const buildDirectMonthColors = (type) => {
      const legacyEntry = monthlyEntries[legacyMonthKey]?.[type] || {};
      const paddedEntry = monthlyEntries[paddedMonthKey]?.[type] || {};
      return {
        ...filterPrescriptionColorMap(legacyEntry.prescription_colors, legacyEntry.prescriptions),
        ...filterPrescriptionColorMap(paddedEntry.prescription_colors, paddedEntry.prescriptions),
      };
    };
    const colors = {
      ...(settings?.prescription_colors || {}),
      ...filterPrescriptionColorMap(shockwaveSettlement.prescription_colors, shockwaveSettlement.prescriptions),
      ...filterPrescriptionColorMap(manualSettlement.prescription_colors, manualSettlement.prescriptions),
      ...filterPrescriptionColorMap(shinjangSpraySettlement.prescription_colors, shinjangSpraySettlement.prescriptions),
      ...buildDirectMonthColors('shockwave'),
      ...buildDirectMonthColors('manual_therapy'),
      ...buildDirectMonthColors('shinjang_spray'),
    };
    return Object.entries(colors).reduce((acc, [key, value]) => {
      if (!key || !value) return acc;
      acc[key] = value;
      acc[normalizePrescriptionColorKey(key)] = value;
      return acc;
    }, {});
  }, [settings, currentYear, currentMonth]);

  const initialTextSettingsRef = useRef(null);
  if (initialTextSettingsRef.current === null) {
    initialTextSettingsRef.current = readLocalSchedulerTextSettings();
  }
  const [effectiveSchedulerTextSettings, setEffectiveSchedulerTextSettings] = useState(
    () => initialTextSettingsRef.current.settings
  );

  const [isTextSettingsLoading, setIsTextSettingsLoading] = useState(
    () => !initialTextSettingsRef.current.hasValue
  );

  useEffect(() => {
    setEffectiveSchedulerTextSettings(getEffectiveSchedulerTextSettings(settings, currentYear, currentMonth));
    
    const handleTextSettingsChanged = () => {
      setEffectiveSchedulerTextSettings(getEffectiveSchedulerTextSettings(settings, currentYear, currentMonth));
    };
    
    const handleStorage = (event) => {
      if (event.key === SCHEDULER_TEXT_SETTINGS_KEY) handleTextSettingsChanged();
    };

    window.addEventListener(SCHEDULER_TEXT_SETTINGS_EVENT, handleTextSettingsChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(SCHEDULER_TEXT_SETTINGS_EVENT, handleTextSettingsChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [settings, currentYear, currentMonth]);

  // 로컬 값을 우선 백업하고, 로컬 값이 없을 때만 서버 프로필을 복원합니다.
  useEffect(() => {
    let active = true;
    const localSnapshot = initialTextSettingsRef.current || readLocalSchedulerTextSettings();
    if (localSnapshot.hasValue) {
      syncSaveTextSettings(localSnapshot.settings);
    }
    syncLoadTextSettings({ localSnapshot }).then((loaded) => {
      if (active) {
        if (loaded) {
          setEffectiveSchedulerTextSettings(loaded);
        }
        setIsTextSettingsLoading(false);
      }
    }).catch(() => {
      if (active) setIsTextSettingsLoading(false);
    });
    return () => { active = false; };
  }, []);

  return {
    effectivePrescriptionColors,
    effectiveSchedulerTextSettings,
    hasCompletableSelection,
    hasCompletedSelection,
    isTextSettingsLoading,
    shortcutLabels,
    treatmentCompleteButtonLabel,
  };
}
