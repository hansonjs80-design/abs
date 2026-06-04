import { useMemo, useState, useEffect } from 'react';

import { getEffectiveSchedulerTextSettings } from '../../lib/schedulerTextSettings';
import { filterPrescriptionColorMap, normalizePrescriptionColorKey } from '../../lib/schedulerUtils';
import { getEffectiveSettlementSettings } from '../../lib/settlementSettings';

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
      copy: join(mod, 'C'),
      cut: join(mod, 'X'),
      paste: join(mod, 'V'),
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
      ...buildDirectMonthColors('shockwave'),
      ...buildDirectMonthColors('manual_therapy'),
    };
    return Object.entries(colors).reduce((acc, [key, value]) => {
      if (!key || !value) return acc;
      acc[key] = value;
      acc[normalizePrescriptionColorKey(key)] = value;
      return acc;
    }, {});
  }, [settings, currentYear, currentMonth]);

  const [effectiveSchedulerTextSettings, setEffectiveSchedulerTextSettings] = useState(() => 
    getEffectiveSchedulerTextSettings(settings, currentYear, currentMonth)
  );

  useEffect(() => {
    setEffectiveSchedulerTextSettings(getEffectiveSchedulerTextSettings(settings, currentYear, currentMonth));
    
    const handleTextSettingsChanged = () => {
      setEffectiveSchedulerTextSettings(getEffectiveSchedulerTextSettings(settings, currentYear, currentMonth));
    };
    
    window.addEventListener('scheduler-text-settings-changed', handleTextSettingsChanged);
    return () => {
      window.removeEventListener('scheduler-text-settings-changed', handleTextSettingsChanged);
    };
  }, [settings, currentYear, currentMonth]);

  return {
    effectivePrescriptionColors,
    effectiveSchedulerTextSettings,
    hasCompletableSelection,
    hasCompletedSelection,
    shortcutLabels,
    treatmentCompleteButtonLabel,
  };
}
