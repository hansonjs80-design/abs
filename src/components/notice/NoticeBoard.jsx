import { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';

const SLOT_COUNT = 6;

export default function NoticeBoard() {
  const { notices, loadNotices, saveNotice } = useSchedule();
  const [editingSlot, setEditingSlot] = useState(null);
  const [editValue, setEditValue] = useState('');

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

  return (
    <div className="notice-board">
      <div className="notice-board-header">
        <MessageSquare size={16} />
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
              <span style={{ width: '100%', textAlign: 'center', color: notice?.content ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {notice?.content || '—'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
