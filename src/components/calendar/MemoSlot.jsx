import { useState, useCallback } from 'react';
import { computeMemoFontColor } from '../../lib/memoParser';

export default function MemoSlot({ memo, dayInfo, slotIndex, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memo?.content || '');

  const handleClick = () => {
    if (dayInfo.isOtherMonth) return;
    setValue(memo?.content || '');
    setEditing(true);
  };

  const handleBlur = () => {
    setEditing(false);
    const newVal = value.trim();
    const oldVal = (memo?.content || '').trim();
    if (newVal !== oldVal) {
      onSave(dayInfo.year, dayInfo.month, dayInfo.day, slotIndex, newVal);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') { setValue(memo?.content || ''); setEditing(false); }
  };

  const content = memo?.content || '';
  const fontColor = computeMemoFontColor(content);

  let colorClass = '';
  if (dayInfo.isOtherMonth) colorClass = 'memo-dim';
  else if (dayInfo.isSundayOrHoliday) colorClass = 'memo-special';
  else if (fontColor === '#3c78d8' || fontColor === '#3b82f6') colorClass = 'memo-night';
  else if (fontColor === '#9900ff' || fontColor === '#8b5cf6') colorClass = 'memo-off';
  else if (fontColor === '#40a417' || fontColor === '#22c55e') colorClass = 'memo-leave';
  else if (fontColor === '#ff6d01' || fontColor === '#f97316') colorClass = 'memo-attend';
  else if (fontColor === '#ff0000') colorClass = 'memo-special';

  if (memo?.is_strikethrough) colorClass += ' memo-strikethrough';

  if (editing) {
    return (
      <div className="memo-slot editing">
        <input
          className="memo-slot-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div
      className={`memo-slot ${colorClass}`}
      onClick={handleClick}
      title={content}
    >
      {content}
    </div>
  );
}
