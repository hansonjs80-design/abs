import {
  getPatientHistoryBodyPartText,
  getPatientHistoryBodyPartTextareaRows,
  getPatientHistoryListTextAlign,
  getPatientHistoryMemoDisplayText,
  getPatientHistoryMemoTextareaRows,
  parsePatientHistoryBodyPartText,
  parsePatientHistoryMemoText,
} from '../../lib/patientHistoryModalUtils';
import { formatPatientHistoryOverflowTooltipItems } from '../../lib/patientHistoryOverflowTooltipUtils';
import PatientHistoryOverflowField from './PatientHistoryOverflowField';

export default function PatientHistoryEditableCells({
  log,
  historyRowKey,
  currentCellRowBackground,
  historyRowFontWeight,
  historyEditFieldStyle,
  visitSequenceColor,
  patientHistoryClipboardCell,
  patientHistoryFillCellIds,
  patientHistoryInlineEditor,
  patientHistorySelectedCellIds,
  selectedPatientHistoryCell,
  cancelPatientHistoryInlineCellEdit,
  commitPatientHistoryInlineCellEdit,
  openPatientHistoryCellEditor,
  selectPatientHistoryCell,
  startPatientHistoryCellFill,
  startPatientHistoryCellRangeSelection,
  updatePatientHistoryInlineCellDraft,
}) {
  const currentBodyPartValue = String(log.body_part || '');
  const currentBodyPartItems = parsePatientHistoryBodyPartText(currentBodyPartValue);
  const bodyPartTextareaValue = getPatientHistoryBodyPartText(currentBodyPartValue);
  const bodyPartTextareaRows = getPatientHistoryBodyPartTextareaRows(currentBodyPartValue);
  const hasMultipleBodyParts = currentBodyPartItems.length > 1;
  const bodyPartTextAlign = getPatientHistoryListTextAlign(currentBodyPartItems.length);
  const currentMemoValue = String(log.memo || '');
  const currentMemoItems = parsePatientHistoryMemoText(currentMemoValue);
  const memoTextareaValue = getPatientHistoryMemoDisplayText(currentMemoValue);
  const canEditHistoryMemo = Boolean(
    log.isCurrentCell
    || String(log.id || '').startsWith('draft-')
    || log.type === 'schedule'
    || log.schedule_id
  );
  const bodyPartHistoryCell = {
    id: `${historyRowKey}:body_part`,
    rowKey: historyRowKey,
    field: 'body_part',
    canEdit: true,
  };
  const memoHistoryCell = {
    id: `${historyRowKey}:memo`,
    rowKey: historyRowKey,
    field: 'memo',
    canEdit: canEditHistoryMemo,
  };
  const visitHistoryCell = {
    id: `${historyRowKey}:visit_count`,
    rowKey: historyRowKey,
    field: 'visit_count',
    canEdit: true,
  };
  const isMemoInlineEditing = patientHistoryInlineEditor?.cell?.id === memoHistoryCell.id;
  const activeMemoTextareaValue = isMemoInlineEditing
    ? patientHistoryInlineEditor.value
    : memoTextareaValue;
  const activeMemoTextareaRows = getPatientHistoryMemoTextareaRows(activeMemoTextareaValue);
  const activeMemoItems = parsePatientHistoryMemoText(activeMemoTextareaValue);
  const hasMultipleMemos = activeMemoItems.length > 1;
  const activeMemoTextAlign = getPatientHistoryListTextAlign(activeMemoItems.length);
  const isVisitInlineEditing = patientHistoryInlineEditor?.cell?.id === visitHistoryCell.id;
  const activeVisitCountValue = isVisitInlineEditing
    ? patientHistoryInlineEditor.value
    : String(log.visit_count || '');
  const sharedCellStyle = {
    backgroundColor: currentCellRowBackground,
    fontWeight: historyRowFontWeight,
  };

  return (
    <>
      <td
        className={`patient-history-data-cell patient-history-data-cell--selectable${patientHistorySelectedCellIds.includes(bodyPartHistoryCell.id) ? ' is-selected' : ''}${patientHistoryFillCellIds.includes(bodyPartHistoryCell.id) ? ' is-fill-preview' : ''}${patientHistoryClipboardCell?.id === bodyPartHistoryCell.id ? ` is-clipboard-source is-clipboard-${patientHistoryClipboardCell.mode}` : ''}`}
        data-patient-history-cell-id={bodyPartHistoryCell.id}
        data-patient-history-row-key={bodyPartHistoryCell.rowKey}
        data-patient-history-field={bodyPartHistoryCell.field}
        data-patient-history-can-edit="true"
        tabIndex={0}
        aria-selected={patientHistorySelectedCellIds.includes(bodyPartHistoryCell.id)}
        title="한 번 클릭: 셀 선택 · 끌기: 범위 선택 · Enter/두 번 클릭: 부위 편집"
        style={{ ...sharedCellStyle, textAlign: bodyPartTextAlign }}
        onPointerDown={(event) => startPatientHistoryCellRangeSelection(event, bodyPartHistoryCell)}
        onClick={(event) => selectPatientHistoryCell(event, bodyPartHistoryCell)}
        onDoubleClick={(event) => openPatientHistoryCellEditor(event, bodyPartHistoryCell)}
      >
        <PatientHistoryOverflowField
          value={formatPatientHistoryOverflowTooltipItems(currentBodyPartItems, { showBullets: true })}
        >
          <textarea
            className="patient-history-edit-field patient-history-edit-field--inset patient-history-edit-field--detail"
            rows={bodyPartTextareaRows}
            value={bodyPartTextareaValue}
            placeholder="부위"
            aria-label="부위 셀"
            readOnly
            tabIndex={-1}
            style={{
              ...historyEditFieldStyle,
              display: 'block',
              height: bodyPartTextareaRows === 1 ? '19px' : undefined,
              minHeight: bodyPartTextareaRows === 1 ? '19px' : undefined,
              margin: '0 auto',
              lineHeight: bodyPartTextareaRows > 1 ? 1.3 : '15px',
              paddingLeft: hasMultipleBodyParts ? '7px' : '5px',
              overflowWrap: 'normal',
              overflowX: 'hidden',
              resize: 'none',
              textAlign: bodyPartTextAlign,
              whiteSpace: 'pre',
              wordBreak: 'normal',
            }}
          />
          {selectedPatientHistoryCell?.id === bodyPartHistoryCell.id
            && !patientHistoryClipboardCell && (
            <button
              type="button"
              className="patient-history-fill-handle"
              aria-label="부위 내용 복사 채우기 핸들"
              title="끌어서 같은 부위 내용을 복사"
              tabIndex={-1}
              onPointerDown={(event) => startPatientHistoryCellFill(event, bodyPartHistoryCell)}
            />
          )}
        </PatientHistoryOverflowField>
      </td>
      <td
        className={`patient-history-data-cell patient-history-data-cell--selectable${patientHistorySelectedCellIds.includes(memoHistoryCell.id) ? ' is-selected' : ''}${patientHistoryFillCellIds.includes(memoHistoryCell.id) ? ' is-fill-preview' : ''}${patientHistoryClipboardCell?.id === memoHistoryCell.id ? ` is-clipboard-source is-clipboard-${patientHistoryClipboardCell.mode}` : ''}${canEditHistoryMemo ? '' : ' is-readonly'}`}
        data-patient-history-cell-id={memoHistoryCell.id}
        data-patient-history-row-key={memoHistoryCell.rowKey}
        data-patient-history-field={memoHistoryCell.field}
        data-patient-history-can-edit={String(canEditHistoryMemo)}
        tabIndex={0}
        aria-selected={patientHistorySelectedCellIds.includes(memoHistoryCell.id)}
        title={canEditHistoryMemo
          ? '한 번 클릭: 셀 선택 · 끌기: 범위 선택 · 바로 입력/Enter/두 번 클릭: 메모 편집'
          : '한 번 클릭: 셀 선택 및 복사 · 연결된 스케줄이 없어 수정할 수 없음'}
        style={{ ...sharedCellStyle, textAlign: activeMemoTextAlign }}
        onPointerDown={(event) => {
          if (isMemoInlineEditing && event.target.closest('textarea')) {
            event.stopPropagation();
            return;
          }
          startPatientHistoryCellRangeSelection(event, memoHistoryCell);
        }}
        onClick={(event) => selectPatientHistoryCell(event, memoHistoryCell)}
        onDoubleClick={(event) => openPatientHistoryCellEditor(event, memoHistoryCell)}
      >
        <PatientHistoryOverflowField
          disabled={isMemoInlineEditing}
          value={formatPatientHistoryOverflowTooltipItems(currentMemoItems, { showBullets: true })}
        >
          <textarea
            className={`patient-history-edit-field patient-history-edit-field--inset patient-history-edit-field--detail${isMemoInlineEditing ? ' patient-history-edit-field--inline-editing' : ''}`}
            rows={activeMemoTextareaRows}
            value={activeMemoTextareaValue}
            placeholder={canEditHistoryMemo ? '메모' : '-'}
            aria-label={isMemoInlineEditing ? '메모 수정' : '메모 셀'}
            readOnly={!isMemoInlineEditing}
            tabIndex={isMemoInlineEditing ? 0 : -1}
            style={{
              ...historyEditFieldStyle,
              display: 'block',
              boxSizing: 'border-box',
              height: activeMemoTextareaRows === 1 ? '19px' : undefined,
              minHeight: activeMemoTextareaRows === 1 ? '19px' : undefined,
              margin: '0 auto',
              lineHeight: activeMemoTextareaRows > 1 ? 1.3 : '15px',
              overflowWrap: 'normal',
              overflowX: 'hidden',
              paddingLeft: hasMultipleMemos ? '7px' : '5px',
              resize: 'none',
              textAlign: activeMemoTextAlign,
              whiteSpace: 'pre',
              wordBreak: 'normal',
              opacity: canEditHistoryMemo ? 1 : 0.65,
            }}
            onChange={(event) => updatePatientHistoryInlineCellDraft(memoHistoryCell, event.target.value)}
            onBlur={(event) => commitPatientHistoryInlineCellEdit(memoHistoryCell, event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelPatientHistoryInlineCellEdit(memoHistoryCell);
                event.currentTarget.blur();
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          {selectedPatientHistoryCell?.id === memoHistoryCell.id
            && canEditHistoryMemo
            && !isMemoInlineEditing
            && !patientHistoryClipboardCell && (
            <button
              type="button"
              className="patient-history-fill-handle"
              aria-label="메모 내용 복사 채우기 핸들"
              title="끌어서 같은 메모 내용을 복사"
              tabIndex={-1}
              onPointerDown={(event) => startPatientHistoryCellFill(event, memoHistoryCell)}
            />
          )}
        </PatientHistoryOverflowField>
      </td>
      <td
        className={`patient-history-data-cell patient-history-data-cell--selectable${patientHistorySelectedCellIds.includes(visitHistoryCell.id) ? ' is-selected' : ''}${patientHistoryFillCellIds.includes(visitHistoryCell.id) ? ' is-fill-preview' : ''}${patientHistoryClipboardCell?.id === visitHistoryCell.id ? ` is-clipboard-source is-clipboard-${patientHistoryClipboardCell.mode}` : ''}`}
        data-patient-history-cell-id={visitHistoryCell.id}
        data-patient-history-row-key={visitHistoryCell.rowKey}
        data-patient-history-field={visitHistoryCell.field}
        data-patient-history-can-edit="true"
        tabIndex={0}
        aria-selected={patientHistorySelectedCellIds.includes(visitHistoryCell.id)}
        title="한 번 클릭: 셀 선택 · 끌기: 범위 선택 · 바로 입력/Enter/두 번 클릭: 회차 편집"
        style={{ ...sharedCellStyle, textAlign: 'center' }}
        onPointerDown={(event) => {
          if (isVisitInlineEditing && event.target.closest('input')) {
            event.stopPropagation();
            return;
          }
          startPatientHistoryCellRangeSelection(event, visitHistoryCell);
        }}
        onClick={(event) => selectPatientHistoryCell(event, visitHistoryCell)}
        onDoubleClick={(event) => openPatientHistoryCellEditor(event, visitHistoryCell)}
      >
        <PatientHistoryOverflowField disabled value={activeVisitCountValue}>
          <input
            className={`patient-history-edit-field patient-history-edit-field--inset patient-history-edit-field--detail patient-history-visit-count-field${visitSequenceColor ? ' has-visit-sequence' : ''}${isVisitInlineEditing ? ' patient-history-edit-field--inline-editing' : ''}`}
            type="text"
            inputMode="text"
            value={activeVisitCountValue}
            placeholder="-"
            aria-label={isVisitInlineEditing ? '회차 수정' : '회차 셀'}
            readOnly={!isVisitInlineEditing}
            tabIndex={isVisitInlineEditing ? 0 : -1}
            style={{
              width: '100%',
              minWidth: 0,
              textAlign: 'center',
              border: 'none',
              borderRadius: 0,
              background: 'transparent',
              padding: '1px 2px',
              outline: 'none',
              boxSizing: 'border-box',
              boxShadow: 'none',
              font: 'inherit',
              fontWeight: 'inherit',
              '--patient-history-visit-sequence-bg': visitSequenceColor,
            }}
            onChange={(event) => updatePatientHistoryInlineCellDraft(visitHistoryCell, event.target.value)}
            onBlur={(event) => commitPatientHistoryInlineCellEdit(visitHistoryCell, event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelPatientHistoryInlineCellEdit(visitHistoryCell);
                event.currentTarget.blur();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          {selectedPatientHistoryCell?.id === visitHistoryCell.id
            && !isVisitInlineEditing
            && !patientHistoryClipboardCell && (
            <button
              type="button"
              className="patient-history-fill-handle"
              aria-label="회차 연속 입력 핸들"
              title="끌어서 회차를 1씩 증가"
              tabIndex={-1}
              onPointerDown={(event) => startPatientHistoryCellFill(event, visitHistoryCell)}
            />
          )}
        </PatientHistoryOverflowField>
      </td>
    </>
  );
}
