import { useCallback, useEffect } from 'react';

import { normalizeNameForMatch } from '../../lib/memoParser';
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
  selectSingleCell,
  setActiveContextSubmenu,
  setContextMenu,
  setContextMenuBodyInput,
  setContextMenuBodyPartOptions,
  setContextMenuMemoDrafts,
  setContextMenuNoteInput,
  setContextMenuReservationInput,
  setContextMenuVisitInput,
  setEditingCell,
  skipNextEditBlurSaveRef,
}) {
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

  const handleCellContextMenu = useCallback((event, w, d, r, c, currentPrescription, slotTime = '') => {
    event.preventDefault();
    event.stopPropagation();
    skipNextEditBlurSaveRef.current = true;
    setEditingCell(null);
    selectSingleCell({ w, d, r, c });
    const key = cellKey(w, d, r, c);
    setActiveContextSubmenu(null);
    setContextMenuBodyPartOptions(buildContextMenuBodyPartOptions(key));
    setContextMenuBodyInput('');
    setContextMenuNoteInput('');
    setContextMenuMemoDrafts(getMemoListFromMergeSpan(memos[key]?.merge_span));
    setContextMenuVisitInput(getSchedulerVisitInputValue(memos[key]?.content || ''));
    const defaultReservationTime = slotTime || getDefaultReservationTime(w, d, r);
    const savedReservationTime = getReservationTimeFromMergeSpan(memos[key]?.merge_span);
    setContextMenuReservationInput(savedReservationTime || defaultReservationTime);
    const viewW = window.innerWidth;
    const isNearRightEdge = event.clientX + 180 + 300 > viewW;

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      weekIdx: w,
      dayIdx: d,
      rowIdx: r,
      colIdx: c,
      currentPrescription,
      memoSnapshot: memos[key] || {},
      defaultReservationTime,
      savedReservationTime,
      isNearRightEdge,
    });
    window.setTimeout(() => {
      skipNextEditBlurSaveRef.current = false;
    }, 0);
  }, [
    buildContextMenuBodyPartOptions,
    cellKey,
    getDefaultReservationTime,
    memos,
    selectSingleCell,
    setActiveContextSubmenu,
    setContextMenu,
    setContextMenuBodyInput,
    setContextMenuBodyPartOptions,
    setContextMenuMemoDrafts,
    setContextMenuNoteInput,
    setContextMenuReservationInput,
    setContextMenuVisitInput,
    setEditingCell,
    skipNextEditBlurSaveRef,
  ]);

  useEffect(() => {
    if (!contextMenu) {
      setActiveContextSubmenu(null);
      setContextMenuBodyPartOptions([]);
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
