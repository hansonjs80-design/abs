import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Settings, Trash2 } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminUser } from '../../lib/authPermissions';
import { pasteNoticeClipboard } from '../../lib/noticeClipboardUtils';

const SLOT_COUNT = 6;

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
  const canManageDepartments = isAdminUser(user);
  const [editingSlot, setEditingSlot] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [clipboardSlot, setClipboardSlot] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [isDepartmentSettingsOpen, setIsDepartmentSettingsOpen] = useState(false);
  const [newDepartment, setNewDepartment] = useState('');
  const departmentFilterRef = useRef(null);
  const slotRefs = useRef([]);
  const boardRef = useRef(null);
  const editingMonthRef = useRef(null);
  const selectedBeforeClickRef = useRef(false);
  const noticeClipboardRef = useRef('');
  const pendingCutRef = useRef(null);
  const currentNoticesRef = useRef({ year: currentYear, month: currentMonth, notices });
  const contextMenuRef = useRef(null);

  useEffect(() => {
    currentNoticesRef.current = { year: currentYear, month: currentMonth, notices };
  }, [currentYear, currentMonth, notices]);

  useEffect(() => {
    setSelectedSlot(null);
    setClipboardSlot(null);
    pendingCutRef.current = null;
    noticeClipboardRef.current = '';
    setEditingSlot(null);
    setContextMenu(null);
  }, [currentYear, currentMonth]);

  useEffect(() => {
    if (selectedSlot === null && clipboardSlot === null && !contextMenu) return undefined;
    const clearSelection = () => {
      // Finish any active edit through the existing blur/save path.
      const activeElement = document.activeElement;
      if (boardRef.current?.contains(activeElement)) activeElement.blur();
      setSelectedSlot(null);
      setClipboardSlot(null);
      setContextMenu(null);
      selectedBeforeClickRef.current = false;
      pendingCutRef.current = null;
      noticeClipboardRef.current = '';
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
  }, [selectedSlot, clipboardSlot, contextMenu]);

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

  const startEditing = (index, initialValue) => {
    const existing = notices.find(n => n.slot_index === index);
    setEditValue(initialValue ?? existing?.content ?? '');
    setEditingSlot(index);
    editingMonthRef.current = { year: currentYear, month: currentMonth };
  };

  const handleBlur = async (index) => {
    setEditingSlot(null);
    const existing = notices.find(n => n.slot_index === index);
    if (editValue.trim() !== (existing?.content || '').trim()) {
      const { year, month } = editingMonthRef.current || { year: currentYear, month: currentMonth };
      await saveNotice(index, editValue.trim(), year, month);
    }
  };

  const handleNoticeKeyDown = (event, index) => {
    if (event.target?.tagName === 'INPUT') return;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      startEditing(index);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      if (notices.some(n => n.slot_index === index && n.content)) saveNotice(index, '', currentYear, currentMonth);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(0, Math.min(SLOT_COUNT - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      slotRefs.current[next]?.focus();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      startEditing(index, event.key);
    }
  };

  const copyNotice = (event, index, cut = false) => {
    if (event.target?.tagName === 'INPUT') return;
    event.preventDefault();
    const content = notices.find(n => n.slot_index === index)?.content || '';
    event.clipboardData.setData('text/plain', content);
    noticeClipboardRef.current = content;
    setClipboardSlot(index);
    pendingCutRef.current = cut ? { index, content, year: currentYear, month: currentMonth } : null;
  };

  const pasteNotice = (event, index) => {
    setClipboardSlot(null);
    if (event.target?.tagName === 'INPUT') {
      pendingCutRef.current = null;
      return;
    }
    event.preventDefault();
    applyNoticePaste(event.clipboardData.getData('text/plain'), index);
  };

  const applyNoticePaste = async (text, index) => {
    if (!text) return;
    setClipboardSlot(null);
    const cut = pendingCutRef.current;
    pendingCutRef.current = null;
    await pasteNoticeClipboard({
      text, index, slotCount: SLOT_COUNT, year: currentYear, month: currentMonth, cut, saveNotice,
      isCutSourceUnchanged: (source) => {
        const current = currentNoticesRef.current;
        return current.year === source.year && current.month === source.month
          && current.notices.find(n => n.slot_index === source.index)?.content === source.content;
      },
    });
  };

  const handleContextAction = async (action, index) => {
    const content = notices.find(n => n.slot_index === index)?.content || '';
    setContextMenu(null);
    slotRefs.current[index]?.focus();
    if (action === 'edit') startEditing(index);
    if (action === 'copy' || action === 'cut') {
      noticeClipboardRef.current = content;
      setClipboardSlot(index);
      pendingCutRef.current = action === 'cut' ? { index, content, year: currentYear, month: currentMonth } : null;
      try { await navigator.clipboard?.writeText(content); } catch { /* Local copy remains available. */ }
    }
    if (action === 'paste') {
      let text = noticeClipboardRef.current;
      try { text = await navigator.clipboard?.readText() || text; } catch { /* Use the local copy. */ }
      if (text) applyNoticePaste(text, index);
    }
    if (action === 'delete' && content) saveNotice(index, '', currentYear, currentMonth);
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
      <div ref={boardRef} className="notice-board">
        <div className="notice-board-header">
          <MessageSquare size={21} strokeWidth={2.4} />
          {currentMonth}월 전달 사항
        </div>
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const notice = notices.find(n => n.slot_index === i);
          const isEditing = editingSlot === i;

          return (
            <div
              key={i}
              ref={(node) => { slotRefs.current[i] = node; }}
              className={`notice-item${selectedSlot === i ? ' is-selected' : ''}${clipboardSlot === i ? ' is-clipboard-source' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${i + 1}번 전달 사항${notice?.content ? `: ${notice.content}` : ''}`}
              aria-pressed={selectedSlot === i}
              onFocus={() => setSelectedSlot(i)}
              onPointerDown={() => { selectedBeforeClickRef.current = selectedSlot === i; }}
              onClick={() => {
                if (isEditing) return;
                if (selectedBeforeClickRef.current) startEditing(i);
                else { setSelectedSlot(i); slotRefs.current[i]?.focus(); }
                selectedBeforeClickRef.current = false;
              }}
              onDoubleClick={() => startEditing(i)}
              onContextMenu={(event) => {
                event.preventDefault();
                selectedBeforeClickRef.current = false;
                setSelectedSlot(i);
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
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => handleBlur(i)}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
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
              ['edit', '입력·수정'], ['copy', '복사'], ['cut', '잘라내기'], ['paste', '붙여넣기'], ['delete', '삭제'],
            ].map(([action, label]) => (
              <button key={action} type="button" role="menuitem" onClick={() => handleContextAction(action, contextMenu.index)}>{label}</button>
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
