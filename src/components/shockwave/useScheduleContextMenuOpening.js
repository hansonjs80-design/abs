import { useCallback, useEffect, useRef } from 'react';

import { normalizeNameForMatch } from '../../lib/memoParser';
import { supabase } from '../../lib/supabaseClient';
import {
  addBodyPartToMap,
  getBodyPartOptionsFromMergeSpan,
  getMemoListFromMergeSpan,
  getReservationTimeFromMergeSpan,
  getSchedulerVisitInputValue,
  parseSchedulerPatientIdentity,
  splitBodyParts,
} from '../../lib/schedulerUtils';

export default function useScheduleContextMenuOpening({
  cellKey,
  contextMenu,
  getDefaultReservationTime,
  memos,
  normalizeCellToMergeMaster,
  pendingDisplayValues,
  selectSingleCell,
  selectedKeys,
  setActiveContextSubmenu,
  setContextMenu,
  setContextMenuBodyInput,
  setContextMenuBodyPartOptions,
  setContextMenuHiddenBodyPartKeys,
  setContextMenuMemoDrafts,
  setContextMenuNoteInput,
  setContextMenuReservationInput,
  setContextMenuVisitInput,
  setEditingCell,
  skipNextEditBlurSaveRef,
}) {
  const bodyPartOptionsRequestRef = useRef(0);

  const buildContextMenuBodyPartOptions = useCallback((targetKey) => {
    const currentMemo = memos[targetKey] || {};
    const { patientChart, patientName } = parseSchedulerPatientIdentity(currentMemo?.content || '');
    const normalizedPatientName = normalizeNameForMatch(patientName);
    const bodyPartsMap = new Map();

    getBodyPartOptionsFromMergeSpan(currentMemo.merge_span).forEach((part) => addBodyPartToMap(bodyPartsMap, part));

    Object.entries(memos || {}).forEach(([, memo]) => {
      if (!memo?.content) return;
      const { patientChart: memoChart, patientName: memoName } = parseSchedulerPatientIdentity(memo.content);
      const matchesChart = patientChart && memoChart && String(patientChart).trim() === String(memoChart).trim();
      const matchesName = normalizedPatientName && normalizeNameForMatch(memoName) === normalizedPatientName;
      if (patientChart ? !matchesChart : !matchesName) return;
      splitBodyParts(memo.body_part || '').forEach((part) => addBodyPartToMap(bodyPartsMap, part));
    });

    splitBodyParts(currentMemo.body_part || '').forEach((part) => addBodyPartToMap(bodyPartsMap, part));

    return Array.from(bodyPartsMap.values()).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [memos]);

  const fetchHistoricalBodyPartOptions = useCallback(async ({ patientChart, patientName }) => {
    const chart = String(patientChart || '').trim();
    const name = String(patientName || '').trim();
    if (!chart && !name) return [];

    const shockwaveQuery = supabase
      .from('shockwave_patient_logs')
      .select('patient_name, chart_number, body_part')
      .not('body_part', 'is', null)
      .limit(300);
    const manualQuery = supabase
      .from('manual_therapy_patient_logs')
      .select('patient_name, chart_number, body_part')
      .not('body_part', 'is', null)
      .limit(300);
    const scheduleQuery = supabase
      .from('shockwave_schedules')
      .select('content, body_part')
      .not('body_part', 'is', null)
      .limit(300);

    if (chart) {
      shockwaveQuery.eq('chart_number', chart);
      manualQuery.eq('chart_number', chart);
      scheduleQuery.ilike('content', `%${chart}%`);
    } else {
      shockwaveQuery.ilike('patient_name', `%${name}%`);
      manualQuery.ilike('patient_name', `%${name}%`);
      scheduleQuery.ilike('content', `%${name}%`);
    }

    const [shockwaveRes, manualRes, scheduleRes] = await Promise.all([
      shockwaveQuery,
      manualQuery,
      scheduleQuery,
    ]);

    const optionsMap = new Map();
    const normalizedName = normalizeNameForMatch(name);
    const isMatchingLogRow = (row) => {
      if (chart) return String(row.chart_number || '').trim() === chart;
      return normalizedName && normalizeNameForMatch(row.patient_name) === normalizedName;
    };
    const isMatchingScheduleRow = (row) => {
      const parsed = parseSchedulerPatientIdentity(row.content || '');
      if (chart) return String(parsed.patientChart || '').trim() === chart;
      return normalizedName && normalizeNameForMatch(parsed.patientName) === normalizedName;
    };

    [
      ...(shockwaveRes.data || []).filter(isMatchingLogRow),
      ...(manualRes.data || []).filter(isMatchingLogRow),
      ...(scheduleRes.data || []).filter(isMatchingScheduleRow),
    ].forEach((row) => {
      splitBodyParts(row.body_part || '').forEach((part) => addBodyPartToMap(optionsMap, part));
    });

    return Array.from(optionsMap.values());
  }, []);

  const handleCellContextMenu = useCallback((event, w, d, r, c, currentPrescription, slotTime = '') => {
    event.preventDefault();
    event.stopPropagation();
    const targetCell = normalizeCellToMergeMaster
      ? normalizeCellToMergeMaster({ w, d, r, c })
      : { w, d, r, c };
    skipNextEditBlurSaveRef.current = true;
    setEditingCell(null);
    const key = cellKey(targetCell.w, targetCell.d, targetCell.r, targetCell.c);
    const shouldKeepRangeSelection = selectedKeys?.size > 1 && selectedKeys.has(key);
    if (!shouldKeepRangeSelection) {
      selectSingleCell(targetCell);
    }
    const currentMemo = {
      ...(memos[key] || {}),
      ...(Object.prototype.hasOwnProperty.call(pendingDisplayValues || {}, key)
        ? { content: String(pendingDisplayValues[key] ?? '') }
        : {}),
    };
    const { patientChart, patientName } = parseSchedulerPatientIdentity(currentMemo?.content || '');
    setActiveContextSubmenu(null);
    setContextMenuBodyPartOptions(buildContextMenuBodyPartOptions(key));
    setContextMenuHiddenBodyPartKeys?.(new Set());
    setContextMenuBodyInput('');
    setContextMenuNoteInput('');
    setContextMenuMemoDrafts(getMemoListFromMergeSpan(currentMemo?.merge_span));
    setContextMenuVisitInput(getSchedulerVisitInputValue(currentMemo?.content || ''));
    const defaultReservationTime = slotTime || getDefaultReservationTime(targetCell.w, targetCell.d, targetCell.r);
    const savedReservationTime = getReservationTimeFromMergeSpan(currentMemo?.merge_span);
    setContextMenuReservationInput(savedReservationTime || defaultReservationTime);
    const viewW = window.innerWidth;
    const isNearRightEdge = event.clientX + 180 + 300 > viewW;

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      weekIdx: targetCell.w,
      dayIdx: targetCell.d,
      rowIdx: targetCell.r,
      colIdx: targetCell.c,
      currentPrescription: currentMemo?.prescription || currentPrescription || '',
      memoSnapshot: currentMemo,
      defaultReservationTime,
      savedReservationTime,
      isNearRightEdge,
    });

    const requestId = bodyPartOptionsRequestRef.current + 1;
    bodyPartOptionsRequestRef.current = requestId;
    fetchHistoricalBodyPartOptions({ patientChart, patientName })
      .then((parts) => {
        if (bodyPartOptionsRequestRef.current !== requestId || parts.length === 0) return;
        setContextMenuBodyPartOptions((prev) => {
          const optionsMap = new Map();
          (prev || []).forEach((part) => addBodyPartToMap(optionsMap, part));
          parts.forEach((part) => addBodyPartToMap(optionsMap, part));
          return Array.from(optionsMap.values()).sort((a, b) => a.localeCompare(b, 'ko'));
        });
      })
      .catch((error) => {
        console.error('Failed to load historical body part options', error);
      });

    window.setTimeout(() => {
      skipNextEditBlurSaveRef.current = false;
    }, 0);
  }, [
    buildContextMenuBodyPartOptions,
    cellKey,
    fetchHistoricalBodyPartOptions,
    getDefaultReservationTime,
    memos,
    normalizeCellToMergeMaster,
    pendingDisplayValues,
    selectSingleCell,
    selectedKeys,
    setActiveContextSubmenu,
    setContextMenu,
    setContextMenuBodyInput,
    setContextMenuBodyPartOptions,
    setContextMenuHiddenBodyPartKeys,
    setContextMenuMemoDrafts,
    setContextMenuNoteInput,
    setContextMenuReservationInput,
    setContextMenuVisitInput,
    setEditingCell,
    skipNextEditBlurSaveRef,
  ]);

  useEffect(() => {
    if (!contextMenu) {
      bodyPartOptionsRequestRef.current += 1;
      setActiveContextSubmenu(null);
      setContextMenuBodyPartOptions([]);
      setContextMenuHiddenBodyPartKeys?.(new Set());
      setContextMenuBodyInput('');
      setContextMenuNoteInput('');
      setContextMenuMemoDrafts([]);
      setContextMenuVisitInput('');
      setContextMenuReservationInput('');
    }
  }, [
    contextMenu,
    setActiveContextSubmenu,
    setContextMenuBodyInput,
    setContextMenuBodyPartOptions,
    setContextMenuHiddenBodyPartKeys,
    setContextMenuMemoDrafts,
    setContextMenuNoteInput,
    setContextMenuReservationInput,
    setContextMenuVisitInput,
  ]);

  useEffect(() => {
    if (!contextMenu) return;
    setContextMenuReservationInput(
      contextMenu.savedReservationTime || contextMenu.defaultReservationTime || getDefaultReservationTime(
        contextMenu.weekIdx,
        contextMenu.dayIdx,
        contextMenu.rowIdx
      )
    );
  }, [
    contextMenu,
    contextMenu?.weekIdx,
    contextMenu?.dayIdx,
    contextMenu?.rowIdx,
    contextMenu?.defaultReservationTime,
    contextMenu?.savedReservationTime,
    getDefaultReservationTime,
    setContextMenuReservationInput,
  ]);

  return { handleCellContextMenu };
}
