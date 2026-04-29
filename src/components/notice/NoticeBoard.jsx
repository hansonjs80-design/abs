import { useState, useEffect } from 'react';
import { MessageSquare, Settings, Trash2 } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';

const SLOT_COUNT = 6;

export default function NoticeBoard({
  departments = [],
  onDepartmentsChange,
  hiddenDepartments = [],
  onHiddenDepartmentsChange,
}) {
  const { notices, loadNotices, saveNotice } = useSchedule();
  const [editingSlot, setEditingSlot] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [isDepartmentSettingsOpen, setIsDepartmentSettingsOpen] = useState(false);
  const [newDepartment, setNewDepartment] = useState('');

  useEffect(() => {
    loadNotices();
  }, [loadNotices]);

  const handleClick = (index) => {
    const existing = notices.find(n => n.slot_index === index);
    setEditValue(existing?.content || '');
    setEditingSlot(index);
  };

  const handleBlur = async (index) => {
    setEditingSlot(null);
    const existing = notices.find(n => n.slot_index === index);
    if (editValue.trim() !== (existing?.content || '').trim()) {
      await saveNotice(index, editValue.trim());
    }
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
    <div className="notice-board">
      <div className="notice-board-header">
        <MessageSquare size={21} strokeWidth={2.4} />
        전달 사항
      </div>
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const notice = notices.find(n => n.slot_index === i);
        const isEditing = editingSlot === i;

        return (
          <div key={i} className="notice-item" onClick={() => !isEditing && handleClick(i)}>
            {isEditing ? (
              <input
                className="notice-input"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => handleBlur(i)}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                autoFocus
                placeholder="메모를 입력하세요..."
              />
            ) : (
              <span className="notice-text" style={{ color: notice?.content ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {notice?.content || ''}
              </span>
            )}
          </div>
        );
      })}
      <div className="notice-department-filter" aria-label="근무표 부서 표시 설정">
        <div className="notice-department-filter-head">
          <div className="notice-department-filter-title">부서 표시</div>
          <button
            type="button"
            className="notice-department-settings-btn"
            onClick={() => setIsDepartmentSettingsOpen((open) => !open)}
            aria-label="부서 표시 설정"
            title="부서 표시 설정"
          >
            <Settings size={16} />
          </button>
        </div>
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
        {isDepartmentSettingsOpen && (
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
    </div>
  );
}
