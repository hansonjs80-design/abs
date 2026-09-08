import { memo } from 'react';
import BodyPartKeyboardPanel from './BodyPartKeyboardPanel';
import ContextMenuBodySummary from './ContextMenuBodySummary';
import { ContextMenuLocalInput } from './ContextMenuLocalInput';
import { ContextMenuLocalInputGroup } from './ContextMenuLocalInputGroup';
import ContextMenuMemoList from './ContextMenuMemoList';
import ContextMenuPrescriptionSelect from './ContextMenuPrescriptionSelect';
import {
  getEffectiveSettlementSettings,
  getEffectiveShinjangSpraySettings,
} from '../../lib/settlementSettings';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { selectionHasReservationGroup } from '../../lib/scheduleReservationGroupUtils';
import {
  addBodyPartToMap,
  buildSchedulerMemoSortKey,
  normalizeBodyPartKey,
  normalizeVisitInputValue,
  parseSchedulerPatientIdentity,
  splitBodyParts,
} from '../../lib/schedulerUtils';
import {
  DEFAULT_CONTEXT_PRESCRIPTION_COLORS,
  getContextMenuPrescriptionLayout,
  getPatientHistoryPrescriptionColor,
  saveHiddenBodyPartOptionsByPatient,
} from './shockwaveViewUtils';

function ShockwaveContextMenu({
  contextMenu,
  contextMenuRef,
  contextSubmenuOpenLeft,
  bodySubmenuMaxWidth,
  contextSubmenuMaxWidth,
  contextSubmenuOffsetX,
  contextSubmenuOffsetY,
  selectedKeys,
  renderMemos,
  renderPendingMergeSpans,
  selectionInfo,
  settings,
  currentYear,
  currentMonth,
  weeks,
  prescriptionScheduleSettings,
  effectivePrescriptionColors,
  contextMenuBodyPartOptions,
  setContextMenuBodyPartOptions,
  contextMenuHiddenBodyPartKeys,
  setContextMenuHiddenBodyPartKeys,
  hiddenBodyPartOptionsByPatient,
  setHiddenBodyPartOptionsByPatient,
  contextMenuMemoDrafts,
  setContextMenuMemoDrafts,
  contextMenuMemoFocusSignal,
  contextMenuVisitInput,
  setContextMenuVisitInput,
  treatmentCompleteButtonLabel,
  hasCompletableSelection,
  shortcutLabels,
  activeContextSubmenu,
  setActiveContextSubmenu,
  handleContextAction,
  handleOpenPatientHistoryFromShortcut,
  setContextMenu,
  stepContextMenuVisitInput,
  imeOpenRef,
}) {
  if (!contextMenu) return null;

  const contextKey = `${contextMenu.weekIdx}-${contextMenu.dayIdx}-${contextMenu.rowIdx}-${contextMenu.colIdx}`;
  const firstKey = contextKey || (selectedKeys ? Array.from(selectedKeys)[0] : null);
  const baseMemo = firstKey ? (renderMemos[firstKey] || {}) : {};
  const currentMemo = (firstKey && contextMenu?.memoSnapshot)
    ? { ...baseMemo, ...contextMenu.memoSnapshot }
    : baseMemo;
  const currentPrescription = currentMemo?.prescription || '';
  const effectiveManualSettings = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'manual_therapy');
  const effectiveShockwaveSettings = getEffectiveSettlementSettings(settings, currentYear, currentMonth, 'shockwave');
  const effectiveShinjangSettings = getEffectiveShinjangSpraySettings(settings, currentYear, currentMonth);
  const hiddenPrescriptions = prescriptionScheduleSettings?.hiddenPrescriptions || [];
  const shinjangPrescriptions = Array.isArray(effectiveShinjangSettings?.prescriptions)
    ? effectiveShinjangSettings.prescriptions.filter((pres) => pres && !hiddenPrescriptions.includes(pres))
    : [];
  const shockwavePrescriptions = Array.isArray(effectiveShockwaveSettings?.prescriptions)
    ? effectiveShockwaveSettings.prescriptions.filter((pres) => pres && !shinjangPrescriptions.includes(pres) && !String(pres).includes('신장분사') && !hiddenPrescriptions.includes(pres))
    : [];
  const manualTherapyPrescriptions = Array.isArray(effectiveManualSettings?.prescriptions)
    ? effectiveManualSettings.prescriptions.filter((pres) => pres && !shockwavePrescriptions.includes(pres) && !shinjangPrescriptions.includes(pres) && !String(pres).includes('신장분사') && !hiddenPrescriptions.includes(pres))
    : [];
  const allDoseTags = {
    ...(effectiveShockwaveSettings?.dose_tags || {}),
    ...(effectiveManualSettings?.dose_tags || {}),
    ...(effectiveShinjangSettings?.dose_tags || {}),
  };
  const manualDoseTags = {
    ...(settings?.manual_therapy_dose_tags || {}),
    ...(effectiveManualSettings?.dose_tags || {}),
  };
  const contextMenuPrescriptionColors = {
    ...DEFAULT_CONTEXT_PRESCRIPTION_COLORS,
    ...(effectivePrescriptionColors || {}),
  };
  const currentPrescriptionClass = shockwavePrescriptions.includes(currentPrescription)
    ? ' is-shockwave'
    : manualTherapyPrescriptions.includes(currentPrescription)
      ? ' is-manual'
      : shinjangPrescriptions.includes(currentPrescription)
        ? ' is-shinjang'
        : '';
  const currentPrescriptionColor = getPatientHistoryPrescriptionColor(
    currentPrescription,
    contextMenuPrescriptionColors
  );
  const currentBodyPart = currentMemo?.body_part || '';
  const currentParts = splitBodyParts(currentBodyPart);
  const hasMultipleCurrentParts = currentParts.length > 1;
  const contextMenuBodyItemClassName = [
    'context-menu-item has-submenu context-menu-meta-item context-menu-body-item',
    hasMultipleCurrentParts ? 'context-menu-body-item--stacked' : '',
    activeContextSubmenu === 'body' ? 'is-submenu-open' : '',
  ].filter(Boolean).join(' ');
  const { patientChart, patientName } = parseSchedulerPatientIdentity(currentMemo?.content || '');
  const bodyPartPatientKey = patientChart
    ? `chart:${String(patientChart).trim()}`
    : `name:${normalizeNameForMatch(patientName)}`;
  const hiddenBodyPartKeys = new Set([
    ...(hiddenBodyPartOptionsByPatient[bodyPartPatientKey] || []),
    ...contextMenuHiddenBodyPartKeys,
  ]);
  const currentBodyPartKeys = new Set(currentParts.map((part) => normalizeBodyPartKey(part)));
  const currentKeyParts = firstKey ? firstKey.split('-').map(Number) : null;
  const currentSortKey = currentKeyParts
    ? buildSchedulerMemoSortKey(firstKey, weeks)
    : '';
  let previousPrescription = null;

  const patientBodyPartsMap = new Map();
  Object.entries(renderMemos || {}).forEach(([memoKey, m]) => {
    const effectiveMemo = (selectedKeys && selectedKeys.has(memoKey)) ? currentMemo : m;
    if (!effectiveMemo?.content) return;
    const { patientChart: mChart, patientName: mName } = parseSchedulerPatientIdentity(effectiveMemo.content);
    const isMatch = patientChart
      ? Boolean(mChart && String(patientChart).trim() === String(mChart).trim())
      : Boolean(patientName && mName && patientName === mName);
    if (isMatch) {
      if (effectiveMemo.body_part) {
        splitBodyParts(effectiveMemo.body_part).forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
      }
      if (!effectiveMemo.prescription || memoKey === firstKey) return;
      const memoSortKey = buildSchedulerMemoSortKey(memoKey, weeks);
      if (memoSortKey < currentSortKey && (!previousPrescription || memoSortKey > previousPrescription.sortKey)) {
        previousPrescription = { value: effectiveMemo.prescription, sortKey: memoSortKey };
      }
    }
  });
  currentParts.forEach((part) => addBodyPartToMap(patientBodyPartsMap, part));
  const availablePartsMap = new Map();
  contextMenuBodyPartOptions.forEach((part) => addBodyPartToMap(availablePartsMap, part));
  Array.from(patientBodyPartsMap.values()).forEach((part) => addBodyPartToMap(availablePartsMap, part));
  const availableParts = Array.from(availablePartsMap.values())
    .filter((part) => {
      const partKey = normalizeBodyPartKey(part);
      return currentBodyPartKeys.has(partKey) || !hiddenBodyPartKeys.has(partKey);
    })
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const previousPrescriptionValue = previousPrescription?.value || '';
  const previousPrescriptionColor = previousPrescriptionValue
    ? getPatientHistoryPrescriptionColor(
      previousPrescriptionValue,
      contextMenuPrescriptionColors
    )
    : null;
  const contextMenuPrescriptionLayout = getContextMenuPrescriptionLayout(
    shinjangPrescriptions
  );
  const selectedHasSameReservationGroup = selectionHasReservationGroup({
    keys: selectedKeys,
    memos: renderMemos,
    pendingMergeSpans: renderPendingMergeSpans,
  });
  const sameReservationLabel = selectedHasSameReservationGroup ? '동시간 예약 취소' : '동시간 예약';

  return (
    <div
      ref={contextMenuRef}
      className={`shockwave-context-menu schedule-context-menu${contextMenu.patientHistoryCell ? ' patient-history-context-menu' : ''} ${(
        contextSubmenuOpenLeft !== null
          ? contextSubmenuOpenLeft
          : contextMenu.isNearRightEdge
      ) ? 'submenu-pop-left' : ''} ${(contextMenu.isStandaloneSubmenu || contextMenu.isStandaloneBodyPart) ? 'standalone-mode' : ''}`}
      style={{
        top: contextMenu.y,
        left: contextMenu.x,
        '--context-body-submenu-max-width': bodySubmenuMaxWidth !== null
          ? `${bodySubmenuMaxWidth}px`
          : undefined,
        '--context-submenu-max-width': contextSubmenuMaxWidth !== null
          ? `${contextSubmenuMaxWidth}px`
          : undefined,
        '--context-submenu-offset-x': `${contextSubmenuOffsetX}px`,
        '--context-submenu-offset-y': `${contextSubmenuOffsetY}px`,
        '--patient-history-editor-width': contextMenu.patientHistoryEditorWidth
          ? `${contextMenu.patientHistoryEditorWidth}px`
          : undefined,
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="context-menu-item"
        data-shortcut-tooltip={`복사 ${shortcutLabels.copy}`}
        onClick={() => handleContextAction('copy')}
      >
        <span className="context-menu-label">복사</span>
        <span className="context-menu-shortcut">{shortcutLabels.copy}</span>
      </button>
      <button
        type="button"
        className="context-menu-item"
        data-shortcut-tooltip={`잘라내기 ${shortcutLabels.cut}`}
        onClick={() => handleContextAction('cut')}
      >
        <span className="context-menu-label">잘라내기</span>
        <span className="context-menu-shortcut">{shortcutLabels.cut}</span>
      </button>
      <button
        type="button"
        className="context-menu-item"
        data-shortcut-tooltip={`붙여넣기 ${shortcutLabels.paste}`}
        onClick={() => handleContextAction('paste')}
      >
        <span className="context-menu-label">붙여넣기</span>
        <span className="context-menu-shortcut">{shortcutLabels.paste}</span>
      </button>
      <div className="context-menu-divider" />
      {!selectionInfo?.isMergedMaster ? (
        <button
          type="button"
          className="context-menu-item"
          data-shortcut-tooltip={`셀 병합 ${shortcutLabels.merge}`}
          onClick={() => handleContextAction('merge')}
          disabled={!selectionInfo?.selectionMultiple}
        >
          <span className="context-menu-label">셀 병합</span>
          <span className="context-menu-shortcut">{shortcutLabels.merge}</span>
        </button>
      ) : (
        <button
          type="button"
          className="context-menu-item"
          data-shortcut-tooltip={`병합 해제 ${shortcutLabels.merge}`}
          onClick={() => handleContextAction('unmerge')}
        >
          <span className="context-menu-label">병합 해제</span>
          <span className="context-menu-shortcut">{shortcutLabels.merge}</span>
        </button>
      )}
      <div className="context-menu-divider" />
      <button
        type="button"
        className="context-menu-item"
        data-shortcut-tooltip={`${sameReservationLabel} Ctrl+Q`}
        onClick={() => handleContextAction('same-reservation-group-toggle')}
        disabled={!selectedHasSameReservationGroup && (!selectedKeys || selectedKeys.size < 2)}
      >
        <span className="context-menu-label">{sameReservationLabel}</span>
        <span className="context-menu-shortcut">Ctrl+Q</span>
      </button>
      <div className="context-menu-divider" />
      <button
        type="button"
        className="context-menu-item context-menu-item-complete"
        data-shortcut-tooltip={`${treatmentCompleteButtonLabel} ${shortcutLabels.complete}`}
        onClick={() => handleContextAction('complete-toggle')}
        disabled={!hasCompletableSelection}
      >
        <span className="context-menu-label">{treatmentCompleteButtonLabel}</span>
        <span className="context-menu-shortcut">{shortcutLabels.complete}</span>
      </button>
      <button
        type="button"
        className="context-menu-item context-menu-item-clear-complete"
        data-shortcut-tooltip={`예약 취소 ${shortcutLabels.cancel}`}
        onClick={() => handleContextAction('cancel-toggle')}
        disabled={!hasCompletableSelection}
      >
        <span className="context-menu-label">예약 취소</span>
        <span className="context-menu-shortcut">{shortcutLabels.cancel}</span>
      </button>
      <div
        className="context-menu-item context-menu-history-search-item"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setContextMenu(null);
          handleOpenPatientHistoryFromShortcut();
        }}
      >
        <div className="context-menu-label" style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>
          🔍 환자 내역 검색 ({shortcutLabels.patientHistory})
        </div>
      </div>
      <div className="context-menu-divider" />

      <div className="context-menu-meta-section">
        <div
          className={`context-menu-item has-submenu context-menu-meta-item context-menu-prescription-item${activeContextSubmenu === 'prescription' ? ' is-submenu-open' : ''}`}
          onMouseEnter={() => setActiveContextSubmenu('prescription')}
          onFocusCapture={() => setActiveContextSubmenu('prescription')}
        >
          <span className="context-menu-meta-value-row">
            <span className="context-menu-meta-label">처방 :</span>
            <span
              className={`context-menu-prescription-value${currentPrescriptionClass}`}
              style={{ '--context-prescription-color': currentPrescriptionColor }}
            >
              {currentPrescription || '없음'}
            </span>
          </span>
          <div
            className="context-menu-submenu context-menu-submenu--prescription"
            style={{
              '--context-prescription-preferred-width': `${contextMenuPrescriptionLayout.preferredWidth}px`,
              '--context-shinjang-prescription-column-ratio': `${contextMenuPrescriptionLayout.shinjangColumnRatio}fr`,
            }}
          >
            <div className="context-menu-editor-panel">
              <div className="context-menu-inline-column">
                <div className="context-menu-prescription-row context-menu-prescription-row--triple">
                  <div className="context-menu-prescription-select-group context-menu-prescription-select-group--shockwave">
                    <label className="context-menu-prescription-select-label">
                      충격파
                      {previousPrescriptionValue && shockwavePrescriptions.includes(previousPrescriptionValue) ? (
                        <span
                          className="context-menu-current-prescription"
                          style={{
                            marginLeft: '6px',
                            '--context-prescription-color': previousPrescriptionColor,
                          }}
                        >
                          {previousPrescriptionValue}
                        </span>
                      ) : null}
                    </label>
                    <ContextMenuPrescriptionSelect
                      ariaLabel="충격파 처방 선택"
                      value={shockwavePrescriptions.includes(currentPrescription) ? currentPrescription : ''}
                      options={shockwavePrescriptions}
                      prescriptionColors={contextMenuPrescriptionColors}
                      shortcuts={effectiveShockwaveSettings?.shortcuts || {}}
                      shortcutModifier={shortcutLabels.modifier}
                      onChange={(nextPrescription) => {
                        const prescription = nextPrescription || null;
                        const hasDoseTag = prescription && Object.prototype.hasOwnProperty.call(allDoseTags, prescription);
                        const autoDoseTag = prescription?.match(/(\d{2,3})/)?.[1] || '';
                        handleContextAction({
                          type: 'prescription',
                          value: prescription,
                          doseTag: hasDoseTag ? allDoseTags[prescription] : autoDoseTag,
                        });
                      }}
                    />
                  </div>
                  <div className="context-menu-prescription-select-group context-menu-prescription-select-group--shinjang">
                    <label className="context-menu-prescription-select-label">
                      신장분사
                      {previousPrescriptionValue && shinjangPrescriptions.includes(previousPrescriptionValue) ? (
                        <span
                          className="context-menu-current-prescription"
                          style={{
                            marginLeft: '6px',
                            '--context-prescription-color': previousPrescriptionColor,
                          }}
                        >
                          {previousPrescriptionValue}
                        </span>
                      ) : null}
                    </label>
                    <ContextMenuPrescriptionSelect
                      ariaLabel="신장분사 처방 선택"
                      value={shinjangPrescriptions.includes(currentPrescription) ? currentPrescription : ''}
                      options={shinjangPrescriptions}
                      prescriptionColors={contextMenuPrescriptionColors}
                      shortcuts={effectiveShinjangSettings?.shortcuts || {}}
                      shortcutModifier={shortcutLabels.shinjangPrescriptionModifier}
                      emphasizeWholeNumberShinjangOptions
                      align="end"
                      onChange={(nextPrescription) => {
                        const prescription = nextPrescription || null;
                        const hasDoseTag = prescription && Object.prototype.hasOwnProperty.call(allDoseTags, prescription);
                        const autoDoseTag = prescription?.match(/(\d{2,3})/)?.[1] || '';
                        handleContextAction({
                          type: 'prescription',
                          value: prescription,
                          doseTag: hasDoseTag ? allDoseTags[prescription] : autoDoseTag,
                        });
                      }}
                    />
                  </div>
                  <div className="context-menu-prescription-select-group context-menu-prescription-select-group--manual">
                    <label className="context-menu-prescription-select-label">
                      도수치료
                      {previousPrescriptionValue && manualTherapyPrescriptions.includes(previousPrescriptionValue) ? (
                        <span
                          className="context-menu-current-prescription"
                          style={{
                            marginLeft: '6px',
                            '--context-prescription-color': previousPrescriptionColor,
                          }}
                        >
                          {previousPrescriptionValue}
                        </span>
                      ) : null}
                    </label>
                    <ContextMenuPrescriptionSelect
                      ariaLabel="도수치료 처방 선택"
                      value={manualTherapyPrescriptions.includes(currentPrescription) ? currentPrescription : ''}
                      options={manualTherapyPrescriptions}
                      prescriptionColors={contextMenuPrescriptionColors}
                      shortcuts={effectiveManualSettings?.shortcuts || {}}
                      shortcutModifier={shortcutLabels.manualPrescriptionModifier}
                      align="end"
                      onChange={(nextPrescription) => {
                        const prescription = nextPrescription || null;
                        const hasDoseTag = prescription && Object.prototype.hasOwnProperty.call(manualDoseTags, prescription);
                        const autoDoseTag = prescription?.match(/(\d{2,3})/)?.[1] || '';
                        handleContextAction({
                          type: 'prescription',
                          value: prescription,
                          doseTag: hasDoseTag ? manualDoseTags[prescription] : autoDoseTag,
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className={contextMenuBodyItemClassName}
          onMouseEnter={() => setActiveContextSubmenu('body')}
          onFocusCapture={() => setActiveContextSubmenu('body')}
        >
          <ContextMenuBodySummary parts={currentParts} />
          <div className="context-menu-submenu context-menu-submenu--body">
            <div className="context-menu-editor-panel">
              <div className="context-menu-inline-column">
                <div className="context-menu-body-dropdown">
                  <BodyPartKeyboardPanel
                    availableParts={availableParts}
                    currentParts={currentParts}
                    autoFocus={true}
                    imeOpenRef={imeOpenRef}
                    onAdd={(value) => {
                      const partKey = normalizeBodyPartKey(value);
                      setContextMenuHiddenBodyPartKeys((prev) => {
                        const next = new Set(prev);
                        next.delete(partKey);
                        return next;
                      });
                      setHiddenBodyPartOptionsByPatient((prev) => {
                        const nextKeys = (prev[bodyPartPatientKey] || []).filter((key) => key !== partKey);
                        if (nextKeys.length === (prev[bodyPartPatientKey] || []).length) return prev;
                        const next = { ...prev };
                        if (nextKeys.length > 0) {
                          next[bodyPartPatientKey] = nextKeys;
                        } else {
                          delete next[bodyPartPatientKey];
                        }
                        saveHiddenBodyPartOptionsByPatient(next);
                        return next;
                      });
                      handleContextAction({ type: 'bodyPartAdd', value });
                    }}
                    onEdit={(index, value, parts) => {
                      const previousPart = currentParts[index];
                      const previousKey = normalizeBodyPartKey(previousPart);
                      const nextKey = normalizeBodyPartKey(value);
                      setContextMenuHiddenBodyPartKeys((prev) => {
                        const next = new Set(prev);
                        if (previousKey && previousKey !== nextKey) next.add(previousKey);
                        if (nextKey) next.delete(nextKey);
                        return next;
                      });
                      handleContextAction({ type: 'bodyPartEdit', index, value, parts });
                    }}
                    onMove={(index, direction) => handleContextAction({ type: 'bodyPartMove', index, direction })}
                    onRemove={(index) => handleContextAction({ type: 'bodyPartRemove', index })}
                    onToggle={(value) => handleContextAction({ type: 'bodyPartToggle', value })}
                    onSetPreset={(presetId, isSelected, directions) => handleContextAction({
                      type: 'bodyPartPreset',
                      presetId,
                      isSelected,
                      directions,
                    })}
                    onDelete={(value) => {
                      const partKey = normalizeBodyPartKey(value);
                      setContextMenuHiddenBodyPartKeys((prev) => {
                        const next = new Set(prev);
                        next.add(partKey);
                        return next;
                      });
                      setHiddenBodyPartOptionsByPatient((prev) => {
                        const current = prev[bodyPartPatientKey] || [];
                        if (current.includes(partKey)) return prev;
                        const next = { ...prev, [bodyPartPatientKey]: [...current, partKey] };
                        saveHiddenBodyPartOptionsByPatient(next);
                        return next;
                      });
                      setContextMenuBodyPartOptions((prev) => (
                        prev.filter((item) => normalizeBodyPartKey(item) !== partKey)
                      ));
                      handleContextAction({ type: 'bodyPartDeleteValue', value });
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="context-menu-item context-menu-item-inline-edit context-menu-meta-item context-menu-visit-item"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: 'default' }}
        >
          <label className="context-menu-visit-editor" style={{ width: '100%', margin: 0, padding: 0 }}>
            <span style={{ flexShrink: 0, width: '40px' }}>회차 :</span>
            <span className="context-menu-visit-control" style={{ flexGrow: 1 }}>
              <span className="context-menu-visit-stepper">
                <button
                  type="button"
                  className="context-menu-visit-step context-menu-step-left"
                  aria-label="회차 감소"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    stepContextMenuVisitInput(-1);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <span className="context-menu-step-symbol context-menu-step-symbol--minus" />
                </button>
                <ContextMenuLocalInput
                  inputMode="numeric"
                  pattern="[0-9*-]*"
                  className={`context-menu-visit-input context-menu-display-value context-menu-visit-display context-menu-visit-display--len-${Math.min(String(contextMenuVisitInput || '').length || 1, 3)}`}
                  value={contextMenuVisitInput}
                  onChange={(val) => {
                    const nextValue = val.replace(/[^\d*-]/g, '');
                    setContextMenuVisitInput(nextValue);
                  }}
                  onBlur={(e, val) => {
                    e.stopPropagation();
                    const normalized = normalizeVisitInputValue(val);
                    setContextMenuVisitInput(normalized);
                    handleContextAction({ type: 'visitCount', value: normalized });
                  }}
                  onKeyDown={(e, val) => {
                    e.stopPropagation();
                    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const normalized = normalizeVisitInputValue(val);
                      setContextMenuVisitInput(normalized);
                      handleContextAction({ type: 'visitCount', value: normalized });
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      stepContextMenuVisitInput(1);
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      stepContextMenuVisitInput(-1);
                    }
                  }}
                />
                <button
                  type="button"
                  className="context-menu-visit-step context-menu-step-right"
                  aria-label="회차 증가"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    stepContextMenuVisitInput(1);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <span className="context-menu-step-symbol context-menu-step-symbol--plus" />
                </button>
              </span>
            </span>
          </label>
        </div>

        <div
          className={`context-menu-item has-submenu context-menu-meta-item context-menu-memo-item${activeContextSubmenu === 'memo' ? ' is-submenu-open' : ''}`}
          onMouseEnter={() => setActiveContextSubmenu('memo')}
          onFocusCapture={() => setActiveContextSubmenu('memo')}
        >
          <span className={`context-menu-memo-summary${contextMenuMemoDrafts.length > 1 ? ' context-menu-memo-summary--stacked' : ''}`}>
            <span className="context-menu-memo-summary-label">메모 :</span>
            {contextMenuMemoDrafts.length === 0 ? (
              <span className="context-menu-memo-summary-text">없음</span>
            ) : contextMenuMemoDrafts.length === 1 ? (
              <span className="context-menu-memo-summary-text">{contextMenuMemoDrafts[0]}</span>
            ) : (
              <span className="context-menu-memo-summary-list">
                {contextMenuMemoDrafts.map((memo, index) => (
                  <span key={`${memo}-${index}`} className="context-menu-memo-summary-row">
                    <span className="context-menu-memo-summary-marker">•</span>
                    <span className="context-menu-memo-summary-text">{memo}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
          <div className="context-menu-submenu context-menu-submenu--memo">
            <div className="context-menu-editor-panel">
              <div className="context-menu-inline-column">
                <div className="context-menu-inline-label">
                  <span>
                    메모 목록
                    <span className="context-menu-note-status">
                      ({contextMenuMemoDrafts.length > 0 ? `${contextMenuMemoDrafts.length}개` : '없음'})
                    </span>
                  </span>
                  <span className="context-menu-shortcut">{shortcutLabels.memo}</span>
                </div>
                <div className="context-menu-inline-memo-box">
                  <ContextMenuMemoList
                    memos={contextMenuMemoDrafts}
                    onDraftChange={(index, value) => {
                      setContextMenuMemoDrafts((prev) => prev.map((memo, memoIndex) => memoIndex === index ? value : memo));
                    }}
                    onAction={handleContextAction}
                  />
                  <ContextMenuLocalInputGroup
                    placeholder="새 메모 추가"
                    buttonLabel="추가"
                    focusSignal={contextMenuMemoFocusSignal}
                    onSubmit={(val) => {
                      handleContextAction({ type: 'memoAdd', value: val });
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ShockwaveContextMenu);
