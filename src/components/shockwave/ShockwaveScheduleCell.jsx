import { memo, useRef } from 'react';

import {
  CONTEXT_MENU_DISMISS_GRACE_MS,
} from '../../lib/contextMenuDismissUtils';
import { getReservationGroupFromMergeSpan } from '../../lib/scheduleReservationGroupUtils';
import { isTreatmentCancelBg, isTreatmentCompleteBg } from '../../lib/scheduleStatusUtils';
import {
  HORIZONTAL_BORDER_COLOR,
  buildSchedulerCellDisplay,
  getMemoListFromMergeSpan,
} from '../../lib/schedulerUtils';
import { has4060Pattern } from '../../lib/schedulerContentFormat';

const isComposingInputEvent = (event) => Boolean(
  event?.nativeEvent?.isComposing ||
  event?.isComposing ||
  event?.keyCode === 229
);

function saveSchedulerInputValueOnce({
  event,
  input,
  editDraftRef,
  skipNextEditBlurSaveRef,
  onSave,
}) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const targetInput = input || event?.currentTarget || event?.target;
  const value = editDraftRef.current?.value ?? targetInput?.value ?? '';
  skipNextEditBlurSaveRef.current = true;
  targetInput?.blur?.();
  editDraftRef.current = null;
  if (String(value || '').trim()) onSave(value);
}

function saveSchedulerInputAfterComposition({
  event,
  input,
  editDraftRef,
  skipNextEditBlurSaveRef,
  onSave,
}) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const targetInput = input || event?.currentTarget || event?.target;
  let saved = false;
  let fallbackTimer = null;
  const save = () => {
    if (saved) return;
    saved = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    targetInput?.removeEventListener?.('compositionend', save);
    window.requestAnimationFrame(() => {
      const value = targetInput?.value ?? editDraftRef.current?.value ?? '';
      skipNextEditBlurSaveRef.current = true;
      targetInput?.blur?.();
      editDraftRef.current = null;
      if (String(value || '').trim()) onSave(value);
    });
  };

  targetInput?.addEventListener?.('compositionend', save, { once: true });
  fallbackTimer = window.setTimeout(save, 120);
}

const renderSchedulerVisitSuffix = (suffix, className, style) => {
  const text = String(suffix || '');
  if (text === '*' || text === '(*)') {
    return <span className={className} style={style}>*</span>;
  }
  const match = text.match(/^(\()(-|\d+)(\))$/);
  if (!match) {
    return <span className={className} style={style}>{text}</span>;
  }
  const isEmptyVisit = match[2] === '-';
  return (
    <span className={`${className}${isEmptyVisit ? ' sw-cell-visit-suffix--empty' : ''}`} style={style}>
      <span className="sw-cell-visit-paren">(</span>
      <span className={isEmptyVisit ? 'sw-cell-visit-empty-marker' : 'sw-cell-visit-number'}>
        {isEmptyVisit ? null : match[2]}
      </span>
      <span className="sw-cell-visit-paren">)</span>
    </span>
  );
};

const MemoizedCell = memo(({
  cellKey, weekIdx, dayIdx, rowIdx, colIdx, dayInfo, slotInfo, showTimeCol, gridRowStart, isLastRenderedRow, colCount,
  cellData, pendingContent, pendingMergeSpan, mergeSpan, editingCell, imePreviewCell, selectedKeys, selectedCell, clipboardSource,
  workState, staffBlockRule, effectivePrescriptionColors,
  reservationGroupEdge,
  cellBorderBottomColor,
  visitLineBreakPrescriptions,
  editValue, setEditValue,
  handleCellMouseDown, handleCellMouseEnter, setHoverCell, handleCellDoubleClick, handleCellContextMenu,
  editInputRef, handleCellSave, handleEditKeyDown, imeOpenRef, setImePreviewCell, editDraftRef, scheduleEditDraftAutosave, promoteFocusedInputToEditor, skipNextEditBlurSaveRef
}) => {
  const resizerRef = useRef(null);
  const content = pendingContent || '';
  const effectiveMergeSpan = pendingMergeSpan || mergeSpan;
  const cellMemoList = getMemoListFromMergeSpan(effectiveMergeSpan);
  const hasCellMemo = cellMemoList.length > 0;
  const reservationGroup = getReservationGroupFromMergeSpan(effectiveMergeSpan);
  const cellPrescription = cellData?.prescription || effectiveMergeSpan?.meta?.prescription || '';
  const displayData = buildSchedulerCellDisplay(content, effectiveMergeSpan);
  const hasDisplayText = displayData.hasDisplayText && content.trim() && content.trim() !== '\u200B';
  const isCurrentMonthCell = dayInfo.isCurrentMonth !== false;

  const isEditing = editingCell === cellKey;
  const isImePreview = imePreviewCell === cellKey;
  const isSelected = selectedKeys.has(cellKey);
  const isPrimary = selectedCell && selectedCell.w === weekIdx && selectedCell.d === dayIdx && selectedCell.r === rowIdx && selectedCell.c === colIdx;
  const gridColumnStart = showTimeCol ? colIdx + 2 : colIdx + 1;

  let visualRowSpan = 1;
  if (effectiveMergeSpan.rowSpan > 1) {
    visualRowSpan = effectiveMergeSpan.rowSpan;
  }

  let cls = 'sw-cell';
  if (colIdx + effectiveMergeSpan.colSpan - 1 === colCount - 1) cls += ' last-col';
  if (dayInfo.isHoliday) cls += ' holiday-bg';
  else if (!isCurrentMonthCell) cls += ' other-month-bg disabled-cell';

  if (slotInfo.disabled && !displayData.hasDisplayText) cls += ' disabled';

  if (isTreatmentCompleteBg(cellData?.bg_color)) cls += ' preserve';
  if (isTreatmentCancelBg(cellData?.bg_color)) cls += ' cancelled';
  if (has4060Pattern(content)) cls += ' color-4060';
  if (hasCellMemo) cls += ' has-memo';
  if (reservationGroup?.mode === 'same') cls += ' same-reservation-group';
  if (isSelected) cls += ' selected';
  if (isPrimary) cls += ' primary-selected';

  if (clipboardSource?.keys?.has(cellKey)) {
    cls += ` ants-active ${clipboardSource.mode === 'cut' ? 'ants-red' : 'ants-blue'}`;
  }

  const hasDisabledSlotBackground = isCurrentMonthCell && slotInfo.disabled && !displayData.hasDisplayText;
  const hasTreatmentCompleteBackground = isTreatmentCompleteBg(cellData?.bg_color);
  const hasTreatmentCancelBackground = isTreatmentCancelBg(cellData?.bg_color);
  const hasStaffOffBackground = isCurrentMonthCell && !isSelected && !hasDisplayText && !cellData?.bg_color && workState === 'off';
  const hasStaffBlockedBackground = isCurrentMonthCell && !hasDisplayText && Boolean(staffBlockRule?.bg_color);
  const hasOtherMonthStaffBackground = !isCurrentMonthCell && !hasDisplayText && !cellData?.bg_color && (
    workState === 'off' ||
    Boolean(staffBlockRule?.bg_color)
  );

  if (hasStaffOffBackground) {
    cls += ' staff-off';
  } else if (hasStaffBlockedBackground) {
    cls += ' staff-blocked';
  } else if (hasOtherMonthStaffBackground) {
    cls += ' other-month-muted-block';
  }

  let fillBackgroundColor = null;
  if (isCurrentMonthCell && cellData?.bg_color) {
    fillBackgroundColor = cellData.bg_color;
  } else if (isCurrentMonthCell && !hasDisplayText && staffBlockRule?.bg_color) {
    fillBackgroundColor = staffBlockRule.bg_color;
  }
  const hasFilledScheduleBackground = Boolean(
    fillBackgroundColor ||
    dayInfo.isHoliday ||
    !isCurrentMonthCell ||
    hasDisabledSlotBackground ||
    hasTreatmentCompleteBackground ||
    hasTreatmentCancelBackground ||
    hasStaffOffBackground ||
    hasStaffBlockedBackground ||
    hasOtherMonthStaffBackground
  );

  let inlineStyle = {
    gridColumn: `${gridColumnStart}${effectiveMergeSpan.colSpan > 1 ? ` / span ${effectiveMergeSpan.colSpan}` : ''}`,
    gridRow: `${gridRowStart}${visualRowSpan > 1 ? ` / span ${visualRowSpan}` : ''}`,
    borderBottom: isLastRenderedRow
      ? 'none'
      : `1px solid ${hasFilledScheduleBackground ? HORIZONTAL_BORDER_COLOR : (cellBorderBottomColor || HORIZONTAL_BORDER_COLOR)}`,
  };

  if (colIdx + effectiveMergeSpan.colSpan - 1 === colCount - 1) {
    inlineStyle.borderRight = 'none';
  }

  if (fillBackgroundColor) {
    inlineStyle.backgroundColor = fillBackgroundColor;
    inlineStyle['--sw-cell-fill-color'] = fillBackgroundColor;
    cls += ' has-fill-bg';
  }

  if (isCurrentMonthCell && staffBlockRule?.font_color) inlineStyle.color = staffBlockRule.font_color;

  if (reservationGroup?.mode === 'same') {
    const groupBorder = '2px solid #2563eb';
    if (reservationGroupEdge?.top) {
      inlineStyle.borderTop = groupBorder;
    }
    if (reservationGroupEdge?.bottom) {
      inlineStyle.borderBottom = groupBorder;
    }
    if (reservationGroupEdge?.left) {
      inlineStyle.borderLeft = groupBorder;
    }
    if (reservationGroupEdge?.right) {
      inlineStyle.borderRight = groupBorder;
    }
  }

  const prescriptionColor = cellPrescription ? effectivePrescriptionColors[cellPrescription] : undefined;
  const shouldBreakVisitLine = Boolean(cellPrescription && visitLineBreakPrescriptions?.includes(cellPrescription));
  const hasMeaningfulContent = hasDisplayText;
  const noPrescription = hasMeaningfulContent && !cellPrescription;
  const noBodyPart = hasMeaningfulContent && !String(cellData?.body_part || '').trim();
  const visitSuffixClassName = [
    'sw-cell-visit-suffix',
    displayData.visitSuffix === '*' ? 'sw-cell-new-patient-marker' : '',
  ].filter(Boolean).join(' ');

  let baseTextColor = undefined;
  let visitSuffixColor = undefined;

  if (noPrescription) {
    baseTextColor = '#b8860b'; visitSuffixColor = '#b8860b';
    cls += ' no-prescription'; inlineStyle.color = '#b8860b';
  } else if (noBodyPart) {
    baseTextColor = prescriptionColor || undefined; visitSuffixColor = '#b8860b';
    if (prescriptionColor) {
      cls += ' has-prescription-color'; inlineStyle.color = prescriptionColor; inlineStyle['--prescription-color'] = prescriptionColor;
    }
  } else if (prescriptionColor) {
    baseTextColor = prescriptionColor; visitSuffixColor = prescriptionColor;
    cls += ' has-prescription-color'; inlineStyle.color = prescriptionColor; inlineStyle['--prescription-color'] = prescriptionColor;
  }

  if (visualRowSpan > 1 || effectiveMergeSpan.colSpan > 1) {
    inlineStyle.display = 'flex'; inlineStyle.alignItems = 'center'; inlineStyle.justifyContent = 'center';
    cls += ' merged-master';
  }

  const showInput = isPrimary || isEditing;
  const renderDisplay = (pointerEvents) => (
    <div className="sw-cell-display" style={pointerEvents ? { pointerEvents } : undefined}>
      {displayData.hasDisplayText ? (
        <span className="sw-cell-main">
          <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.baseText}</span>
          {displayData.noteSuffix ? (
            <>
              {visualRowSpan > 1 ? <br /> : null}
              <span style={baseTextColor ? { color: baseTextColor } : undefined}>{displayData.noteSuffix}</span>
            </>
          ) : null}
          {displayData.visitSuffix ? (
            <>
              {shouldBreakVisitLine && !displayData.noteSuffix ? <br /> : null}
              {renderSchedulerVisitSuffix(displayData.visitSuffix, visitSuffixClassName, visitSuffixColor ? { color: visitSuffixColor } : undefined)}
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );

  if (showInput) {
    return (
      <div id={`cell-${cellKey}`} className={`sw-cell ${isEditing ? 'editing' : ''} ${cls}`} style={inlineStyle}
        onMouseDown={(e) => { handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e); }}
        onMouseEnter={() => {
          handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
          setHoverCell({ weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, isMergedView: false });
        }}
        onMouseLeave={() => setHoverCell(null)}
        onDoubleClick={(e) => { handleCellDoubleClick(e, weekIdx, dayIdx, rowIdx, colIdx, content); }}
        onContextMenu={(e) => {
          handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
        }}
      >
        {!isEditing && !isImePreview && renderDisplay('none')}
        <div
          ref={resizerRef}
          className={`sw-cell-input-wrapper ${(!isEditing && !isImePreview) ? 'hidden' : ''} ${visualRowSpan === 1 ? 'is-single-row' : ''}`}
          data-value={isEditing ? editValue : ''}
        >
          <input
            ref={(isEditing || isPrimary) ? editInputRef : null}
            className="sw-cell-input"
            data-hidden-input={!isEditing && !isImePreview ? 'true' : undefined}
            defaultValue={isEditing ? editValue : ''}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.button === 2) {
                skipNextEditBlurSaveRef.current = true;
                window.setTimeout(() => {
                  skipNextEditBlurSaveRef.current = false;
                }, CONTEXT_MENU_DISMISS_GRACE_MS);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => {
              const nextValue = e.currentTarget.value;
              if (resizerRef.current) resizerRef.current.dataset.value = nextValue;
              editDraftRef.current = { key: cellKey, value: nextValue, dirty: true };
              if (isEditing) setEditValue(nextValue);
              scheduleEditDraftAutosave(cellKey, nextValue);
              if (imeOpenRef.current || e.nativeEvent?.isComposing) return;
              if (!isEditing && e.currentTarget.value) promoteFocusedInputToEditor(cellKey, e.currentTarget.value);
            }}
            onBlur={(e) => {
              setImePreviewCell((prev) => (prev === cellKey ? null : prev));
              if (skipNextEditBlurSaveRef.current) { skipNextEditBlurSaveRef.current = false; return; }
              const blurValue = e.target.value;
              if (isEditing || (blurValue && blurValue.trim())) {
                handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, blurValue);
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (isComposingInputEvent(e)) {
                  saveSchedulerInputAfterComposition({
                    event: e,
                    input: e.currentTarget,
                    editDraftRef,
                    skipNextEditBlurSaveRef,
                    onSave: (value) => handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, value),
                  });
                } else {
                  saveSchedulerInputValueOnce({
                    event: e,
                    input: e.currentTarget,
                    editDraftRef,
                    skipNextEditBlurSaveRef,
                    onSave: (value) => handleCellSave(weekIdx, dayIdx, rowIdx, colIdx, value),
                  });
                }
                return;
              }
              if (e.key === 'Escape') {
                skipNextEditBlurSaveRef.current = true;
                e.target.value = '';
                e.target.blur();
                return;
              }
              if (isEditing) handleEditKeyDown(e, weekIdx, dayIdx, rowIdx, colIdx);
            }}
            onCompositionStart={() => {
              imeOpenRef.current = true;
              setImePreviewCell(cellKey);
              const val = editInputRef.current?.value || '';
              editDraftRef.current = { key: cellKey, value: val, dirty: true };
              if (resizerRef.current) resizerRef.current.dataset.value = val;
            }}
            onCompositionEnd={(e) => {
              imeOpenRef.current = false;
              setImePreviewCell((prev) => (prev === cellKey ? null : prev));
              const finalValue = e.currentTarget.value;
              editDraftRef.current = { key: cellKey, value: finalValue, dirty: true };
              if (isEditing) setEditValue(finalValue);
              if (resizerRef.current) resizerRef.current.dataset.value = finalValue;
              scheduleEditDraftAutosave(cellKey, finalValue);
              if (!isEditing && finalValue) promoteFocusedInputToEditor(cellKey, finalValue);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      id={`cell-${cellKey}`}
      className={cls}
      style={inlineStyle}
      onMouseDown={(e) => { handleCellMouseDown(weekIdx, dayIdx, rowIdx, colIdx, e); }}
      onMouseEnter={() => {
        handleCellMouseEnter(weekIdx, dayIdx, rowIdx, colIdx);
        setHoverCell({ weekIdx, dayIdx, rowIdx, colIdx, staffBlockRule, slotInfo, isMergedView: true });
      }}
      onMouseLeave={() => setHoverCell(null)}
      onDoubleClick={(e) => { handleCellDoubleClick(e, weekIdx, dayIdx, rowIdx, colIdx, content); }}
      onContextMenu={(e) => {
        handleCellContextMenu(e, weekIdx, dayIdx, rowIdx, colIdx, cellPrescription, slotInfo.time || slotInfo.label);
      }}
    >
      {renderDisplay()}
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.pendingContent !== nextProps.pendingContent) return false;
  if (prevProps.pendingMergeSpan !== nextProps.pendingMergeSpan) return false;
  if (prevProps.cellData !== nextProps.cellData) return false;

  if (prevProps.mergeSpan.rowSpan !== nextProps.mergeSpan.rowSpan) return false;
  if (prevProps.mergeSpan.colSpan !== nextProps.mergeSpan.colSpan) return false;
  if (prevProps.mergeSpan.mergedInto !== nextProps.mergeSpan.mergedInto) return false;
  const prevMemoListKey = getMemoListFromMergeSpan(prevProps.pendingMergeSpan || prevProps.mergeSpan).join('\u001f');
  const nextMemoListKey = getMemoListFromMergeSpan(nextProps.pendingMergeSpan || nextProps.mergeSpan).join('\u001f');
  if (prevMemoListKey !== nextMemoListKey) return false;
  const prevReservationGroupKey = JSON.stringify(getReservationGroupFromMergeSpan(prevProps.pendingMergeSpan || prevProps.mergeSpan) || null);
  const nextReservationGroupKey = JSON.stringify(getReservationGroupFromMergeSpan(nextProps.pendingMergeSpan || nextProps.mergeSpan) || null);
  if (prevReservationGroupKey !== nextReservationGroupKey) return false;

  const wasSelected = prevProps.selectedKeys?.has(prevProps.cellKey);
  const isSelected = nextProps.selectedKeys?.has(nextProps.cellKey);
  if (wasSelected !== isSelected) return false;

  const wasPrimary = prevProps.selectedCell && prevProps.selectedCell.w === prevProps.weekIdx && prevProps.selectedCell.d === prevProps.dayIdx && prevProps.selectedCell.r === prevProps.rowIdx && prevProps.selectedCell.c === prevProps.colIdx;
  const isPrimary = nextProps.selectedCell && nextProps.selectedCell.w === nextProps.weekIdx && nextProps.selectedCell.d === nextProps.dayIdx && nextProps.selectedCell.r === nextProps.rowIdx && nextProps.selectedCell.c === nextProps.colIdx;
  if (wasPrimary !== isPrimary) return false;

  const wasEditing = prevProps.editingCell === prevProps.cellKey;
  const isEditing = nextProps.editingCell === nextProps.cellKey;
  if (wasEditing !== isEditing) return false;

  if (isEditing && prevProps.editValue !== nextProps.editValue) return false;

  const wasImePreview = prevProps.imePreviewCell === prevProps.cellKey;
  const isImePreview = nextProps.imePreviewCell === nextProps.cellKey;
  if (wasImePreview !== isImePreview) return false;

  const wasAnts = prevProps.clipboardSource?.keys?.has(prevProps.cellKey);
  const isAnts = nextProps.clipboardSource?.keys?.has(nextProps.cellKey);
  if (wasAnts !== isAnts) return false;
  if (isAnts && prevProps.clipboardSource?.mode !== nextProps.clipboardSource?.mode) return false;

  if (prevProps.workState !== nextProps.workState) return false;
  if (prevProps.staffBlockRule?.bg_color !== nextProps.staffBlockRule?.bg_color) return false;
  if (prevProps.staffBlockRule?.font_color !== nextProps.staffBlockRule?.font_color) return false;
  if (prevProps.staffBlockRule?.keyword !== nextProps.staffBlockRule?.keyword) return false;
  if (prevProps.cellBorderBottomColor !== nextProps.cellBorderBottomColor) return false;
  if (prevProps.visitLineBreakPrescriptions !== nextProps.visitLineBreakPrescriptions) return false;
  if (JSON.stringify(prevProps.reservationGroupEdge || null) !== JSON.stringify(nextProps.reservationGroupEdge || null)) return false;

  if (prevProps.slotInfo?.disabled !== nextProps.slotInfo?.disabled) return false;
  if (prevProps.slotInfo?.isLunch !== nextProps.slotInfo?.isLunch) return false;
  if (prevProps.slotInfo?.time !== nextProps.slotInfo?.time) return false;

  if (prevProps.isLastRenderedRow !== nextProps.isLastRenderedRow) return false;
  if (prevProps.colCount !== nextProps.colCount) return false;
  if (prevProps.showTimeCol !== nextProps.showTimeCol) return false;
  if (prevProps.gridRowStart !== nextProps.gridRowStart) return false;

  if (prevProps.dayInfo?.isHoliday !== nextProps.dayInfo?.isHoliday) return false;
  if (prevProps.dayInfo?.isCurrentMonth !== nextProps.dayInfo?.isCurrentMonth) return false;

  return true;
});

export default MemoizedCell;
