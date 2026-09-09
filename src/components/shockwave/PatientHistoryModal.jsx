import { memo } from 'react';
import PatientHistoryApplyConfirmDialog from './PatientHistoryApplyConfirmDialog';
import PatientHistoryEditableCells from './PatientHistoryEditableCells';
import PatientHistoryFilters from './PatientHistoryFilters';
import {
  getPatientHistoryGroupKey,
  getPatientHistoryPrescriptionColor,
  PATIENT_HISTORY_GROUPS,
  PATIENT_HISTORY_SORT_OPTIONS,
  togglePatientHistoryFilterSelection,
} from './shockwaveViewUtils';
import { parseSchedulerPatientIdentity } from '../../lib/schedulerUtils';
import { normalizeNameForMatch } from '../../lib/memoParser';
import { getPatientHistoryPrescriptionRowColor } from '../../lib/patientHistoryRowColorUtils';
import { PATIENT_HISTORY_TREATMENT_SEQUENCE_PALETTES } from '../../lib/patientHistoryVisitSequenceUtils';

function PatientHistoryModal({
  open,
  patientHistoryModalOverlayRef,
  patientHistoryModalDialogRef,
  patientHistoryModalLayout,
  patientHistoryModalOffset,
  handlePatientHistoryModalDragStart,
  handlePatientHistoryModalDragMove,
  handlePatientHistoryModalDragEnd,
  patientHistorySearchInputRef,
  patientHistoryModalData,
  fetchPatientHistory,
  handleSelectPatientHistoryChart,
  handleSearchPatientHistoryByName,
  closePatientHistoryModal,
  patientHistoryTreatmentTabOptions,
  patientHistoryTreatmentTab,
  setPatientHistoryTreatmentTab,
  patientHistorySortOrder,
  setPatientHistorySortOrder,
  patientHistoryModalBodyRef,
  patientHistoryLogGroups,
  setPatientHistoryBodyFilters,
  setPatientHistoryPrescriptionFilters,
  patientHistoryColumnWidths,
  selectedCell,
  patientHistoryPrescriptionOptions,
  effectivePrescriptionColors,
  updatePatientHistoryModalLog,
  handleUpdatePatientHistoryField,
  handlePatientHistoryDateClick,
  patientHistoryClipboardCell,
  patientHistoryInlineEditor,
  patientHistorySelectedCellIds,
  patientHistoryFillCellIds,
  selectedPatientHistoryCell,
  cancelPatientHistoryInlineCellEdit,
  commitPatientHistoryInlineCellEdit,
  openPatientHistoryCellEditor,
  selectPatientHistoryCell,
  startPatientHistoryCellFill,
  startPatientHistoryCellRangeSelection,
  updatePatientHistoryInlineCellDraft,
  requestApplyPatientHistoryToCell,
  pendingPatientHistoryApplyLog,
  setPendingPatientHistoryApplyLog,
  confirmApplyPatientHistoryToCell,
}) {
  if (!open) return null;

  return (
    <div
      ref={patientHistoryModalOverlayRef}
      data-preserve-schedule-selection="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 999999,
        overscrollBehavior: 'none',
      }}
    >
      <div
        ref={patientHistoryModalDialogRef}
        style={{
          background: 'var(--bg-primary, #fff)',
          maxWidth: patientHistoryModalLayout.maxWidth,
          width: patientHistoryModalLayout.width,
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: `translate3d(${patientHistoryModalOffset.x}px, ${patientHistoryModalOffset.y}px, 0)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="patient-history-modal-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-color, #eee)',
            background: 'var(--bg-secondary, #f8f9fa)',
          }}
          onPointerDown={handlePatientHistoryModalDragStart}
          onPointerMove={handlePatientHistoryModalDragMove}
          onPointerUp={handlePatientHistoryModalDragEnd}
          onPointerCancel={handlePatientHistoryModalDragEnd}
        >
          <div className="patient-history-modal-header-main">
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>환자 스케줄 내역 검색</h3>
            <div
              className="patient-history-search-control"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--bg-primary, #fff)',
                border: '1px solid var(--border-color, #ddd)',
                borderRadius: '6px',
                padding: '2px 8px',
              }}
            >
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #666)' }}>검색:</span>
              <input
                ref={patientHistorySearchInputRef}
                className="patient-history-search-input"
                type="text"
                placeholder="이름/차트번호"
                defaultValue={patientHistoryModalData.searchChart || patientHistoryModalData.searchName}
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  width: '120px',
                  fontSize: '0.9rem',
                  padding: '4px 0',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = e.target.value.trim();
                    if (val) {
                      const parsed = parseSchedulerPatientIdentity(val);
                      const sName = normalizeNameForMatch(parsed.patientName);
                      const sChart = parsed.patientChart ? String(parsed.patientChart).trim() : null;
                      fetchPatientHistory(sName, sChart);
                    }
                  }
                }}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary, #999)' }}>↵ Enter</span>
            </div>
            {(patientHistoryModalData.searchName || (patientHistoryModalData.chartOptions || []).length > 0) && (
              <div className="patient-history-search-target">
                <span className="patient-history-search-target-label">검색 대상:</span>
                {(patientHistoryModalData.chartOptions || []).length > 1 ? (
                  <>
                    <select
                      className="patient-history-search-target-select"
                      aria-label="검색 대상 이름 및 챠트번호 선택"
                      value={patientHistoryModalData.searchChart || ''}
                      disabled={patientHistoryModalData.loading}
                      onChange={handleSelectPatientHistoryChart}
                    >
                      <option value="">동명이인 전체</option>
                      {patientHistoryModalData.chartOptions.map((option) => (
                        <option key={option.chartNumber} value={option.chartNumber}>
                          {option.patientName} ({option.chartNumber})
                        </option>
                      ))}
                    </select>
                    <span className="patient-history-search-target-note">
                      동명이인 {patientHistoryModalData.chartOptions.length}명
                    </span>
                  </>
                ) : (
                  <span className="patient-history-search-target-value">
                    {patientHistoryModalData.searchName ? (
                      <button
                        type="button"
                        aria-label={`${patientHistoryModalData.searchName} 이름만으로 다시 검색`}
                        title="이름만으로 다시 검색"
                        disabled={patientHistoryModalData.loading}
                        onClick={handleSearchPatientHistoryByName}
                      >
                        {patientHistoryModalData.searchName}
                      </button>
                    ) : null}{' '}
                    {patientHistoryModalData.searchChart ? `(${patientHistoryModalData.searchChart})` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={closePatientHistoryModal}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '0 4px',
              color: 'var(--text-secondary, #666)',
            }}
          >
            ✕
          </button>
        </div>

        <div className="patient-history-sticky-controls">
          <div className="patient-history-view-controls">
            <div className="patient-history-treatment-tabs" role="tablist" aria-label="스케줄 내역 치료 구분">
              {patientHistoryTreatmentTabOptions.map((option) => {
                const isActive = patientHistoryTreatmentTab === option.key;
                return (
                  <button
                    key={`patient-history-treatment-${option.key}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`patient-history-treatment-tab patient-history-treatment-tab--${option.key}${isActive ? ' is-active' : ''}`}
                    onClick={() => setPatientHistoryTreatmentTab(option.key)}
                  >
                    <span>{option.label}</span>
                    <span className="patient-history-treatment-count">{option.count}</span>
                  </button>
                );
              })}
            </div>
            <label className="patient-history-sort-control">
              <span>정렬</span>
              <select
                aria-label="스케줄 내역 정렬 기준"
                value={patientHistorySortOrder}
                onChange={(event) => setPatientHistorySortOrder(event.target.value)}
              >
                {PATIENT_HISTORY_SORT_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div ref={patientHistoryModalBodyRef} style={{ padding: '0 18px 14px', maxHeight: '70vh', overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {patientHistoryModalData.loading ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
              내역을 불러오는 중...
            </div>
          ) : patientHistoryModalData.logs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
              해당하는 내역이 없습니다.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: patientHistoryModalLayout.gridTemplateColumns,
                gap: '12px',
                alignItems: 'start',
              }}
            >
              {patientHistoryLogGroups.map((group) => (
                <div
                  key={group.key}
                  style={{
                    border: '1px solid var(--patient-history-border-color, #c5cfdb)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: 'var(--bg-primary, #fff)',
                    '--patient-history-border-color': '#c5cfdb',
                    '--patient-history-group-header-bg': group.key === 'manual'
                      ? '#fed7aa'
                      : group.key === 'shinjang'
                        ? '#a7f3d0'
                        : group.key === 'all'
                          ? '#e2e8f0'
                          : '#bae6fd',
                    '--patient-history-column-header-bg': group.key === 'manual'
                      ? '#fff3e6'
                      : group.key === 'shinjang'
                        ? '#ecfdf5'
                        : group.key === 'all'
                          ? '#f8fafc'
                          : '#e0f2fe',
                  }}
                >
                  <div className="patient-history-group-header">
                    <div className="patient-history-group-title-row">
                      <span>{group.label}</span>
                      <span className="patient-history-group-count">
                        ({group.logs.length}/{group.totalLogs.length})건
                      </span>
                    </div>
                    <PatientHistoryFilters
                      group={group}
                      onBodyFilterToggle={(optionKey) => {
                        setPatientHistoryBodyFilters((prev) => ({
                          ...prev,
                          [group.key]: togglePatientHistoryFilterSelection(
                            prev[group.key],
                            optionKey
                          ),
                        }));
                      }}
                      onPrescriptionFilterToggle={(optionKey) => {
                        setPatientHistoryPrescriptionFilters((prev) => ({
                          ...prev,
                          [group.key]: togglePatientHistoryFilterSelection(
                            prev[group.key],
                            optionKey
                          ),
                        }));
                      }}
                    />
                  </div>
                  <div className="sw-compact-table-wrap">
                    <table
                      className={`sw-summary-table sw-compact-summary-table patient-history-table patient-history-table--${group.key}`}
                      style={{ width: '100%', margin: 0, tableLayout: 'fixed' }}
                    >
                      <colgroup>
                        {patientHistoryColumnWidths.map((width, columnIndex) => (
                          <col key={`patient-history-col-${columnIndex}`} style={{ width }} />
                        ))}
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="patient-history-row-number-cell">번호</th>
                          {group.key === 'all' && (
                            <th className="patient-history-treatment-type-header">치료 구분</th>
                          )}
                          <th style={{ textAlign: 'center' }}>날짜</th>
                          <th style={{ textAlign: 'center' }}>챠트번호</th>
                          <th style={{ textAlign: 'center' }}>처방</th>
                          <th style={{ textAlign: 'center' }}>부위</th>
                          <th style={{ textAlign: 'center' }}>메모</th>
                          <th style={{ textAlign: 'center' }}>회차</th>
                          <th style={{ textAlign: 'center' }}>담당</th>
                          <th style={{ textAlign: 'center' }}>적용</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.logs.map((log, idx) => {
                          const historyRowKey = log._history_row_key || `${group.key}-${log.id || log.date}-${idx}`;
                          const historyTreatmentGroup = getPatientHistoryGroupKey(log);
                          const visitSequenceColor = group.visitSequenceColors?.[idx]
                            || (historyTreatmentGroup === 'shinjang' ? '#bbf7d0' : null);
                          const historyTreatmentLabel = PATIENT_HISTORY_GROUPS.find(
                            (option) => option.key === historyTreatmentGroup
                          )?.label.replace(' 내역', '') || '충격파';
                          const selectedHistoryCellId = selectedCell
                            ? `draft-${selectedCell.w}-${selectedCell.d}-${selectedCell.r}-${selectedCell.c}`
                            : '';
                          const isCurrentHistoryRow = Boolean(log.isCurrentCell || (selectedHistoryCellId && log.id === selectedHistoryCellId));
                          const historyRowFontWeight = isCurrentHistoryRow ? 800 : 400;
                          const currentPrescriptionValue = String(log.prescription || '');
                          const configuredPrescriptionOptions = patientHistoryPrescriptionOptions[historyTreatmentGroup]
                            || patientHistoryPrescriptionOptions.shockwave
                            || [];
                          const prescriptionOptions = Array.from(new Set([
                            currentPrescriptionValue,
                            ...configuredPrescriptionOptions,
                          ].map((value) => String(value || '').trim()).filter(Boolean)));
                          const currentPrescriptionColor = getPatientHistoryPrescriptionColor(
                            currentPrescriptionValue,
                            effectivePrescriptionColors
                          );
                          const effectiveVisitColor = visitSequenceColor
                            || PATIENT_HISTORY_TREATMENT_SEQUENCE_PALETTES[historyTreatmentGroup]?.[0]
                            || '#bfdbfe';
                          const currentCellRowBackground = getPatientHistoryPrescriptionRowColor(
                            log.prescription,
                            effectiveVisitColor,
                            isCurrentHistoryRow
                          );
                          const historyEditFieldStyle = {
                            width: '100%',
                            minWidth: 0,
                            border: 'none',
                            borderRadius: 0,
                            background: 'transparent',
                            color: 'var(--text-primary, #1f2937)',
                            fontSize: 'inherit',
                            fontWeight: 'inherit',
                            padding: '2px 5px',
                            outline: 'none',
                            boxSizing: 'border-box',
                            boxShadow: 'none',
                          };
                          const handleHistoryPrescriptionChange = async (event) => {
                            const nextValue = event.target.value;
                            const originalValue = log._original_prescription ?? '';
                            updatePatientHistoryModalLog(historyRowKey, {
                              prescription: nextValue,
                            });
                            if (nextValue === originalValue) return;

                            const success = await handleUpdatePatientHistoryField(log, 'prescription', nextValue);
                            updatePatientHistoryModalLog(historyRowKey, (item) => (
                              success
                                ? { ...item, prescription: nextValue, _original_prescription: nextValue }
                                : { ...item, prescription: originalValue }
                            ));
                          };
                          return (
                            <tr
                              key={historyRowKey}
                              className={`patient-history-prescription-row${isCurrentHistoryRow ? ' patient-history-current-row' : ''}`}
                              onMouseEnter={(event) => {
                                event.currentTarget.classList.add('patient-history-row--hovered');
                              }}
                              onMouseLeave={(event) => {
                                event.currentTarget.classList.remove('patient-history-row--hovered');
                              }}
                              style={{
                                '--patient-history-prescription-row-bg': currentCellRowBackground,
                                '--patient-history-current-row-bg': currentCellRowBackground,
                                fontWeight: historyRowFontWeight,
                              }}
                              title={log.id === 'draft' ? "현재 선택된 셀의 날짜를 기반으로 한 임시 항목입니다" : undefined}
                            >
                              <td
                                className={`patient-history-row-number-cell patient-history-row-number-cell--${historyTreatmentGroup}`}
                                aria-label={`행 번호 ${idx + 1}`}
                              >
                                {idx + 1}
                              </td>
                              {group.key === 'all' && (
                                <td
                                  className={`patient-history-treatment-type-cell patient-history-treatment-type-cell--${historyTreatmentGroup}`}
                                  title={`${historyTreatmentLabel} 내역`}
                                >
                                  <span className="patient-history-treatment-type-text">{historyTreatmentLabel}</span>
                                </td>
                              )}
                              <td
                                className={`patient-history-date-cell${log.schedule_completed === false ? ' patient-history-date-cell--incomplete' : ''}`}
                                title={`${log.date} 스케줄 주차로 이동하려면 클릭하세요`}
                                onClick={() => handlePatientHistoryDateClick(log)}
                                style={{
                                  textAlign: 'center',
                                  backgroundColor: currentCellRowBackground,
                                  whiteSpace: 'nowrap',
                                  fontWeight: historyRowFontWeight,
                                }}
                              >
                                {log.date}
                                {isCurrentHistoryRow && (
                                  <span style={{ fontSize: '0.82rem', color: '#dc2626', display: 'block', marginTop: '2px', fontWeight: 800 }}>현재 셀</span>
                                )}
                              </td>
                              <td
                                className="patient-history-chart-cell"
                                title={log.chart_number || ''}
                                style={{
                                  textAlign: 'center',
                                  backgroundColor: currentCellRowBackground,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  fontWeight: historyRowFontWeight,
                                }}
                              >
                                {log.chart_number || '-'}
                              </td>
                              <td
                                style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, fontWeight: historyRowFontWeight }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <select
                                  className="patient-history-edit-field patient-history-edit-field--inset patient-history-edit-field--prescription"
                                  aria-label="처방 수정"
                                  value={currentPrescriptionValue}
                                  onChange={handleHistoryPrescriptionChange}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    ...historyEditFieldStyle,
                                    appearance: 'none',
                                    WebkitAppearance: 'none',
                                    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%226%22 height=%224%22 viewBox=%220 0 6 4%22%3E%3Cpath d=%22M1 1l2 2 2-2%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%221%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E")',
                                    backgroundRepeat: 'no-repeat',
                                    backgroundPosition: 'right 3px center',
                                    backgroundSize: '6px 4px',
                                    padding: '2px 11px 2px 5px',
                                    color: currentPrescriptionColor,
                                  }}
                                >
                                  <option value="" style={{ color: 'var(--text-primary, #1f2937)' }}>처방 없음</option>
                                  {prescriptionOptions.map((prescription) => (
                                    <option
                                      key={`${historyRowKey}-prescription-${prescription}`}
                                      value={prescription}
                                      style={{
                                        color: getPatientHistoryPrescriptionColor(
                                          prescription,
                                          effectivePrescriptionColors
                                        ),
                                      }}
                                    >
                                      {prescription}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <PatientHistoryEditableCells
                                log={log}
                                historyRowKey={historyRowKey}
                                currentCellRowBackground={currentCellRowBackground}
                                historyRowFontWeight={historyRowFontWeight}
                                historyEditFieldStyle={historyEditFieldStyle}
                                visitSequenceColor={visitSequenceColor}
                                patientHistoryClipboardCell={patientHistoryClipboardCell}
                                patientHistoryInlineEditor={patientHistoryInlineEditor}
                                patientHistorySelectedCellIds={patientHistorySelectedCellIds}
                                patientHistoryFillCellIds={patientHistoryFillCellIds}
                                selectedPatientHistoryCell={selectedPatientHistoryCell}
                                cancelPatientHistoryInlineCellEdit={cancelPatientHistoryInlineCellEdit}
                                commitPatientHistoryInlineCellEdit={commitPatientHistoryInlineCellEdit}
                                openPatientHistoryCellEditor={openPatientHistoryCellEditor}
                                selectPatientHistoryCell={selectPatientHistoryCell}
                                startPatientHistoryCellFill={startPatientHistoryCellFill}
                                startPatientHistoryCellRangeSelection={startPatientHistoryCellRangeSelection}
                                updatePatientHistoryInlineCellDraft={updatePatientHistoryInlineCellDraft}
                              />
                              <td
                                className="patient-history-therapist-cell"
                                title={log.therapist_name || ''}
                                style={{
                                  textAlign: 'center',
                                  backgroundColor: currentCellRowBackground,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  fontWeight: historyRowFontWeight,
                                }}
                              >
                                <span className="patient-history-therapist-text">{log.therapist_name || '-'}</span>
                              </td>
                              <td
                                style={{ textAlign: 'center', backgroundColor: currentCellRowBackground, fontWeight: historyRowFontWeight }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="patient-history-apply-button"
                                  title="선택한 셀에 적용"
                                  onClick={() => requestApplyPatientHistoryToCell(log)}
                                  style={{
                                    border: '1px solid var(--brand-primary, #4f46e5)',
                                    background: 'var(--brand-primary, #4f46e5)',
                                    color: '#fff',
                                    borderRadius: '6px',
                                    padding: '4px 5px',
                                    fontSize: '0.74rem',
                                    fontWeight: 600,
                                    lineHeight: 1.2,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  적용
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <PatientHistoryApplyConfirmDialog
        open={Boolean(pendingPatientHistoryApplyLog)}
        onCancel={() => setPendingPatientHistoryApplyLog(null)}
        onConfirm={confirmApplyPatientHistoryToCell}
      />
    </div>
  );
}

export default memo(PatientHistoryModal);
