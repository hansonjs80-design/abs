import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Settings, Trash2 } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminUser } from '../../lib/authPermissions';
import { getScheduleShortcutKey, isMetaEvent } from '../../lib/scheduleKeyboardUtils';
import {
  createNoticeClipboard,
  getNoticeSelectionIndices,
  pasteNoticeClipboard,
  getNoticePasteAffectedSlots,
  createNoticeUndoAction,
  applyNoticeUndo,
} from '../../lib/noticeClipboardUtils';
import { getNoticeRowCount, MAX_NOTICE_ROW_COUNT } from '../../lib/noticeRows';
import { useToast } from '../common/Toast';

export default function NoticeBoard({
  departments = [],
  onDepartmentsChange,
  hiddenDepartments = [],
  onHiddenDepartmentsChange,
  showLastRows = true,
  onShowLastRowsChange,
}) {
  const { currentYear, currentMonth, notices, loadNotices, saveNotice } = useSchedule();
  const { user } = useAuth();
  const { addToast } = useToast();
  const canManageDepartments = isAdminUser(user);
  const [editingSlot, setEditingSlot] = useState(null);
  const [selection, setSelection] = useState(null);
  const [clipboardSelection, setClipboardSelection] = useState(null);
  const [isPasting, setIsPasting] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const undoStackRef = useRef([]);
  useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);
  const undoInProgressRef = useRef(false);
  const initialEditContentRef = useRef('');
  const isEditCancelledRef = useRef(false);
  const editHistoryRef = useRef([]);
  const [isDepartmentSettingsOpen, setIsDepartmentSettingsOpen] = useState(false);
  const [newDepartment, setNewDepartment] = useState('');
  const departmentFilterRef = useRef(null);
  const slotRefs = useRef([]);
  const boardRef = useRef(null);
  const editingMonthRef = useRef(null);
  const selectedBeforeClickRef = useRef(false);
  const dragSelectionRef = useRef(null);
  const suppressClickRef = useRef(false);
  const selectionRef = useRef(null);
  const pasteInProgressRef = useRef(false);
  const noticeClipboardRef = useRef(null);
  const pendingCutRef = useRef(null);
  const currentNoticesRef = useRef({ year: currentYear, month: currentMonth, notices });
  const contextMenuRef = useRef(null);
  const selectedIndices = getNoticeSelectionIndices(selection);
  const slotCount = Math.max(
    getNoticeRowCount(notices, editingSlot, editValue),
    ...selectedIndices.map(index => index + 1),
    ...(clipboardSelection?.indices || []).map(index => index + 1),
  );

  const selectRange = useCallback((anchor, focus = anchor) => {
    const next = anchor === null ? null : { anchor, focus };
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const recordUndo = useCallback((action) => {
    setUndoStack(prev => [action, ...prev].slice(0, 50));
  }, []);

  const doUndo = useCallback(async () => {
    if (undoInProgressRef.current || undoStackRef.current.length === 0) return;
    const action = undoStackRef.current[0];
    undoInProgressRef.current = true;
    setUndoStack(prev => prev.slice(1));
    try {
      const success = await applyNoticeUndo(action, (slot, content, year, month) => {
        const current = currentNoticesRef.current;
        if (current.year !== year || current.month !== month) return false;
        return saveNotice(slot, content, year, month);
      });
      if (success) {
        if (action.type === 'edit') {
          selectRange(action.slot);
          slotRefs.current[action.slot]?.focus({ preventScroll: true });
        } else if (action.type === 'bulk') {
          const slots = action.items.map(i => i.slot);
          if (slots.length > 0) {
            const minSlot = Math.min(...slots);
            const maxSlot = Math.max(...slots);
            selectRange(minSlot, maxSlot);
            slotRefs.current[minSlot]?.focus({ preventScroll: true });
          }
        }
        addToast(action.actionLabel ? `${action.actionLabel} 작업이 취소(되돌리기)되었습니다.` : '되돌리기가 완료되었습니다.', 'info');
      } else {
        addToast('되돌리기에 실패했습니다. 다시 확인해 주세요.', 'error');
      }
    } finally {
      undoInProgressRef.current = false;
    }
  }, [saveNotice, selectRange, addToast]);

  useEffect(() => {
    currentNoticesRef.current = { year: currentYear, month: currentMonth, notices };
  }, [currentYear, currentMonth, notices]);

  useEffect(() => {
    selectRange(null);
    setClipboardSelection(null);
    dragSelectionRef.current = null;
    pendingCutRef.current = null;
    noticeClipboardRef.current = null;
    setEditingSlot(null);
    setContextMenu(null);
    setUndoStack([]);
    undoInProgressRef.current = false;
  }, [currentYear, currentMonth, selectRange]);

  useEffect(() => {
    if (selection === null && clipboardSelection === null && !contextMenu) return undefined;
    const clearSelection = () => {
      // Finish any active edit through the existing blur/save path.
      const activeElement = document.activeElement;
      if (boardRef.current?.contains(activeElement)) activeElement.blur();
      selectRange(null);
      setClipboardSelection(null);
      dragSelectionRef.current = null;
      setContextMenu(null);
      selectedBeforeClickRef.current = false;
      pendingCutRef.current = null;
      noticeClipboardRef.current = null;
    };
    const handleOutsidePointerDown = (event) => {
      if (boardRef.current?.contains(event.target) || contextMenuRef.current?.contains(event.target)) return;
      clearSelection();
    };
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [selection, clipboardSelection, contextMenu, selectRange]);

  useEffect(() => {
    const moveSelection = (event) => {
      const drag = dragSelectionRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-notice-index]');
      if (!row || !boardRef.current?.contains(row)) return;
      const focus = Number(row.dataset.noticeIndex);
      if (focus !== drag.start) drag.moved = true;
      selectRange(drag.anchor, focus);
    };
    const finishSelection = () => {
      if (dragSelectionRef.current?.moved) {
        suppressClickRef.current = true;
        selectedBeforeClickRef.current = false;
      }
      dragSelectionRef.current = null;
    };
    document.addEventListener('pointermove', moveSelection);
    document.addEventListener('pointerup', finishSelection);
    document.addEventListener('pointercancel', finishSelection);
    window.addEventListener('blur', finishSelection);
    return () => {
      document.removeEventListener('pointermove', moveSelection);
      document.removeEventListener('pointerup', finishSelection);
      document.removeEventListener('pointercancel', finishSelection);
      window.removeEventListener('blur', finishSelection);
    };
  }, [selectRange]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = (event) => {
      if (!contextMenuRef.current?.contains(event.target)) setContextMenu(null);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [contextMenu]);

  useEffect(() => {
    loadNotices(currentYear, currentMonth);
  }, [currentMonth, currentYear, loadNotices]);

  useEffect(() => {
    if (!canManageDepartments && isDepartmentSettingsOpen) {
      setIsDepartmentSettingsOpen(false);
    }
  }, [canManageDepartments, isDepartmentSettingsOpen]);

  useEffect(() => {
    if (!isDepartmentSettingsOpen) return undefined;

    const handleOutsideClick = (event) => {
      const target = event.target;
      if (departmentFilterRef.current?.contains(target)) return;
      setIsDepartmentSettingsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isDepartmentSettingsOpen]);

  const startEditing = (index, initialValue = null) => {
    if (pasteInProgressRef.current) return;
    selectRange(index);
    const existing = notices.find(n => n.slot_index === index);
    const initial = initialValue ?? existing?.content ?? '';
    initialEditContentRef.current = existing?.content || '';
    editHistoryRef.current = [initial];
    isEditCancelledRef.current = false;
    setEditValue(initial);
    setEditingSlot(index);
    editingMonthRef.current = { year: currentYear, month: currentMonth };
  };

  const handleBlur = async (index) => {
    setEditingSlot(null);
    if (isEditCancelledRef.current) {
      isEditCancelledRef.current = false;
      return;
    }
    const prevContent = initialEditContentRef.current;
    const trimmed = editValue.trim();
    if (trimmed !== (prevContent || '').trim()) {
      const { year, month } = editingMonthRef.current || { year: currentYear, month: currentMonth };
      const success = await saveNotice(index, trimmed, year, month);
      if (success) {
        recordUndo(createNoticeUndoAction({
          type: 'edit',
          year,
          month,
          slot: index,
          prevContent,
          newContent: trimmed,
          actionLabel: '입력',
        }));
      }
    }
  };

  const handleNoticeKeyDown = (event, index) => {
    if (event.target?.tagName === 'INPUT') return;
    if (pasteInProgressRef.current) { event.preventDefault(); return; }
    const activeIndex = selectionRef.current?.focus ?? index;

    if (isMetaEvent(event)) {
      const shortcut = getScheduleShortcutKey(event);
      if (shortcut === 'Z' && !event.shiftKey) {
        event.preventDefault();
        doUndo();
        return;
      }
      if (shortcut === 'C') {
        event.preventDefault();
        const clipboard = prepareClipboard(index, false);
        navigator.clipboard?.writeText(clipboard.text).catch(() => {});
        addToast('전달 사항이 복사되었습니다.', 'info');
        return;
      }
      if (shortcut === 'X') {
        event.preventDefault();
        const clipboard = prepareClipboard(index, true);
        navigator.clipboard?.writeText(clipboard.text).catch(() => {});
        addToast('전달 사항이 잘라내기되었습니다.', 'info');
        return;
      }
      if (shortcut === 'V') {
        event.preventDefault();
        const indices = getActionIndices(index);
        navigator.clipboard?.readText()
          .then((text) => applyNoticePaste(text || noticeClipboardRef.current?.text || '', indices[0]))
          .catch(() => applyNoticePaste(noticeClipboardRef.current?.text || '', indices[0]));
        return;
      }
      if (shortcut === 'A') {
        event.preventDefault();
        selectRange(0, slotCount - 1);
        return;
      }
    }

    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      startEditing(activeIndex);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      deleteNotices(index);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(0, Math.min(slotCount - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      selectRange(event.shiftKey ? (selectionRef.current?.anchor ?? index) : next, next);
      slotRefs.current[next]?.focus();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      startEditing(activeIndex, event.key);
    }
  };

  const getActionIndices = (index) => {
    const indices = getNoticeSelectionIndices(selectionRef.current);
    return indices.includes(index) ? indices : [index];
  };

  const prepareClipboard = (index, cut) => {
    const indices = getActionIndices(index);
    const clipboard = createNoticeClipboard(notices, indices, currentYear, currentMonth);
    noticeClipboardRef.current = clipboard;
    setClipboardSelection({ indices, cut });
    pendingCutRef.current = cut ? clipboard : null;
    return clipboard;
  };

  const deleteNotices = async (index) => {
    if (pasteInProgressRef.current) return;
    const indices = getActionIndices(index).filter(slot => notices.some(n => n.slot_index === slot && n.content));
    if (indices.length === 0) return;
    const items = indices.map(slot => ({
      slot,
      content: notices.find(n => n.slot_index === slot)?.content || '',
    }));
    pendingCutRef.current = null;
    setClipboardSelection(null);
    const results = await Promise.all(indices.map(slot => saveNotice(slot, '', currentYear, currentMonth)));
    if (results.some(result => !result)) {
      addToast('일부 전달 사항을 삭제하지 못했습니다. 다시 확인해 주세요.', 'error');
    } else {
      recordUndo(createNoticeUndoAction({
        type: 'bulk',
        year: currentYear,
        month: currentMonth,
        items,
        actionLabel: '삭제',
      }));
    }
  };

  const copyNotice = (event, index, cut = false) => {
    if (event.target?.tagName === 'INPUT') return;
    event.preventDefault();
    if (pasteInProgressRef.current) return;
    const clipboard = prepareClipboard(index, cut);
    event.clipboardData.setData('text/plain', clipboard.text);
  };

  const pasteNotice = (event, index) => {
    if (event.target?.tagName === 'INPUT') {
      pendingCutRef.current = null;
      setClipboardSelection(null);
      return;
    }
    event.preventDefault();
    applyNoticePaste(event.clipboardData.getData('text/plain'), getActionIndices(index)[0]);
  };

  const applyNoticePaste = async (text, index) => {
    if (pasteInProgressRef.current) return;
    const clipboard = noticeClipboardRef.current;
    if (!text && (!clipboard || clipboard.text !== text)) return;
    const cut = pendingCutRef.current;
    const year = currentYear;
    const month = currentMonth;
    if (currentNoticesRef.current.year !== year || currentNoticesRef.current.month !== month) return;

    const affectedSlots = getNoticePasteAffectedSlots({
      text,
      index,
      slotCount: MAX_NOTICE_ROW_COUNT,
      year,
      month,
      clipboard,
      cut,
    });
    const prePasteItems = affectedSlots.map(slot => ({
      slot,
      content: notices.find(n => n.slot_index === slot)?.content || '',
    }));

    pasteInProgressRef.current = true;
    setIsPasting(true);
    const succeeded = await pasteNoticeClipboard({
      text, index, slotCount: MAX_NOTICE_ROW_COUNT, year, month, clipboard, cut,
      saveNotice: (...args) => {
        const current = currentNoticesRef.current;
        if (current.year !== year || current.month !== month) return false;
        return saveNotice(...args);
      },
      isCutSourceUnchanged: (source) => {
        const current = currentNoticesRef.current;
        return current.year === source.year && current.month === source.month
          && (current.notices.find(n => n.slot_index === source.index)?.content || '') === source.content;
      },
    });
    pasteInProgressRef.current = false;
    setIsPasting(false);
    if (pendingCutRef.current === cut) pendingCutRef.current = null;
    if (cut) {
      setClipboardSelection(null);
    }
    if (!succeeded) {
      addToast('전달 사항을 모두 붙여넣지 못했습니다. 남은 행 수와 저장 상태를 확인해 주세요. 복사한 내용은 유지됩니다.', 'error');
    } else {
      if (prePasteItems.length > 0) {
        recordUndo(createNoticeUndoAction({
          type: 'bulk',
          year,
          month,
          items: prePasteItems,
          actionLabel: '붙여넣기',
        }));
      }
      addToast('전달 사항이 붙여넣기되었습니다.', 'info');
    }
  };

  const handleContextAction = async (action, index) => {
    if (pasteInProgressRef.current) return;
    const indices = getActionIndices(index);
    setContextMenu(null);
    slotRefs.current[index]?.focus();
    if (action === 'undo') doUndo();
    if (action === 'edit') startEditing(index);
    if (action === 'copy' || action === 'cut') {
      const clipboard = prepareClipboard(index, action === 'cut');
      try { await navigator.clipboard?.writeText(clipboard.text); } catch { /* Local copy remains available. */ }
      addToast(action === 'cut' ? '전달 사항이 잘라내기되었습니다.' : '전달 사항이 복사되었습니다.', 'info');
    }
    if (action === 'paste') {
      let text = noticeClipboardRef.current?.text ?? '';
      try { text = await navigator.clipboard?.readText() ?? text; } catch { /* Use the local copy. */ }
      applyNoticePaste(text, indices[0]);
    }
    if (action === 'delete') deleteNotices(index);
  };

  const toggleDepartment = (dept) => {
    if (!onHiddenDepartmentsChange) return;
    onHiddenDepartmentsChange((prev) => (
      prev.includes(dept)
        ? prev.filter((item) => item !== dept)
        : [...prev, dept]
    ));
  };

  const updateDepartmentName = (index, value) => {
    if (!onDepartmentsChange) return;
    onDepartmentsChange((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const addDepartment = () => {
    const nextValue = newDepartment.trim();
    if (!nextValue || !onDepartmentsChange) return;
    onDepartmentsChange((prev) => [...prev, nextValue]);
    setNewDepartment('');
  };

  const removeDepartment = (dept) => {
    if (!onDepartmentsChange) return;
    onDepartmentsChange((prev) => prev.filter((item) => item !== dept));
  };

  return (
    <>
      <div ref={boardRef} className="notice-board" aria-busy={isPasting}>
        <div className="notice-board-header">
          <MessageSquare size={21} strokeWidth={2.4} />
          {currentMonth}월 전달 사항
        </div>
        {Array.from({ length: slotCount }, (_, i) => {
          const notice = notices.find(n => n.slot_index === i);
          const isEditing = editingSlot === i;
          const isSelected = selectedIndices.includes(i);
          const isClipboardSource = clipboardSelection?.indices.includes(i);

          return (
            <div
              key={i}
              ref={(node) => { slotRefs.current[i] = node; }}
              className={`notice-item${isSelected ? ' is-selected' : ''}${isClipboardSource ? ' is-clipboard-source' : ''}${isClipboardSource && clipboardSelection.cut ? ' is-cut-source' : ''}`}
              data-notice-index={i}
              role="button"
              tabIndex={0}
              aria-label={`${i + 1}번 전달 사항${notice?.content ? `: ${notice.content}` : ''}`}
              aria-pressed={isSelected}
              onFocus={() => {
                if (dragSelectionRef.current || getNoticeSelectionIndices(selectionRef.current).includes(i)) return;
                selectRange(i);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || isEditing || pasteInProgressRef.current) return;
                const indices = getNoticeSelectionIndices(selectionRef.current);
                selectedBeforeClickRef.current = indices.length === 1 && indices[0] === i && !event.shiftKey;
                suppressClickRef.current = event.shiftKey;
                const anchor = event.shiftKey ? (selectionRef.current?.anchor ?? i) : i;
                dragSelectionRef.current = { anchor, start: i, pointerId: event.pointerId, moved: false };
                selectRange(anchor, i);
                slotRefs.current[i]?.focus({ preventScroll: true });
                setContextMenu(null);
              }}
              onDragStart={(event) => event.preventDefault()}
              onClick={() => {
                if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                if (isEditing) return;
                if (selectedBeforeClickRef.current) startEditing(i);
                selectedBeforeClickRef.current = false;
              }}
              onDoubleClick={() => {
                if (getNoticeSelectionIndices(selectionRef.current).length <= 1) startEditing(i);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                selectedBeforeClickRef.current = false;
                if (!getNoticeSelectionIndices(selectionRef.current).includes(i)) selectRange(i);
                slotRefs.current[i]?.focus();
                setContextMenu({
                  index: i,
                  x: Math.max(0, Math.min(event.clientX, window.innerWidth - 165)),
                  y: Math.max(0, Math.min(event.clientY, window.innerHeight - 190)),
                });
              }}
              onKeyDown={(event) => handleNoticeKeyDown(event, i)}
              onCopy={(event) => copyNotice(event, i)}
              onCut={(event) => copyNotice(event, i, true)}
              onPaste={(event) => pasteNotice(event, i)}
            >
              {isEditing ? (
                <span className="notice-input-wrap">
                <span className="notice-input-sizer" aria-hidden="true">{editValue || '\u00a0'}</span>
                <input
                  className="notice-input"
                  value={editValue}
                  onChange={e => {
                    const val = e.target.value;
                    setEditValue(val);
                    const hist = editHistoryRef.current;
                    if (!hist || hist[hist.length - 1] !== val) {
                      if (!hist) editHistoryRef.current = [];
                      editHistoryRef.current.push(val);
                    }
                  }}
                  onBlur={() => handleBlur(i)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.target.blur();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      isEditCancelledRef.current = true;
                      setEditValue(initialEditContentRef.current);
                      setEditingSlot(null);
                    } else if (isMetaEvent(e)) {
                      const shortcut = getScheduleShortcutKey(e);
                      if (shortcut === 'Z' && !e.shiftKey) {
                        if (editHistoryRef.current.length > 1) {
                          e.preventDefault();
                          editHistoryRef.current.pop();
                          const prevVal = editHistoryRef.current[editHistoryRef.current.length - 1];
                          setEditValue(prevVal);
                          return;
                        } else if (editValue !== initialEditContentRef.current) {
                          e.preventDefault();
                          setEditValue(initialEditContentRef.current);
                          return;
                        } else if (undoStackRef.current.length > 0) {
                          e.preventDefault();
                          isEditCancelledRef.current = true;
                          setEditingSlot(null);
                          doUndo();
                          return;
                        }
                      }
                    }
                  }}
                  autoFocus
                />
                </span>
              ) : (
                <span className="notice-text" style={{ color: notice?.content ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  {notice?.content || ''}
                </span>
              )}
            </div>
          );
        })}
        {contextMenu && (
          <div ref={contextMenuRef} className="notice-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label="전달 사항 셀 메뉴">
            {[
              ['edit', '입력·수정'],
              ['copy', '복사'],
              ['cut', '잘라내기'],
              ['paste', '붙여넣기'],
              ['delete', '삭제'],
              ...(undoStack.length > 0 ? [['undo', '되돌리기 (Ctrl+Z)']] : []),
            ].map(([action, label]) => (
              <button key={action} type="button" role="menuitem" disabled={isPasting} onClick={() => handleContextAction(action, contextMenu.index)}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div ref={departmentFilterRef} className="notice-department-filter" aria-label="근무표 부서 표시 설정">
        <div className="notice-department-filter-head">
          <div className="notice-department-filter-title">부서 표시</div>
          {canManageDepartments && (
            <button
              type="button"
              className="notice-department-settings-btn"
              onClick={() => setIsDepartmentSettingsOpen((open) => !open)}
              aria-label="부서 표시 설정"
              title="부서 표시 설정"
            >
              <Settings size={16} />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`notice-last-row-toggle${showLastRows ? ' is-active' : ''}`}
          onClick={() => onShowLastRowsChange?.(!showLastRows)}
          aria-pressed={showLastRows}
          title="각 주 마지막행 내용 표시"
        >
          마지막행 {showLastRows ? '표시' : '숨김'}
        </button>
        <div className="notice-department-filter-list">
          {departments.map((dept) => {
            const checked = !hiddenDepartments.includes(dept);
            return (
              <label key={dept} className="notice-department-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDepartment(dept)}
                />
                <span>{dept}</span>
              </label>
            );
          })}
        </div>
        {canManageDepartments && isDepartmentSettingsOpen && (
          <div className="notice-department-settings">
            {departments.map((dept, index) => (
              <div key={`${dept}-${index}`} className="notice-department-edit-row">
                <input
                  className="notice-department-edit-input"
                  value={dept}
                  onChange={(e) => updateDepartmentName(index, e.target.value)}
                  onBlur={(e) => updateDepartmentName(index, e.target.value)}
                />
                <button
                  type="button"
                  className="notice-department-delete-btn"
                  onClick={() => removeDepartment(dept)}
                  aria-label={`${dept} 부서 삭제`}
                  title="삭제"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div className="notice-department-add-row">
              <input
                className="notice-department-edit-input"
                value={newDepartment}
                onChange={(e) => setNewDepartment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addDepartment();
                }}
                placeholder="부서 추가"
              />
              <button
                type="button"
                className="notice-department-add-btn"
                onClick={addDepartment}
              >
                추가
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
