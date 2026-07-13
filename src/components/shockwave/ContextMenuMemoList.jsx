import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';

export default function ContextMenuMemoList({
  memos,
  onDraftChange,
  onAction,
}) {
  const [editingIndex, setEditingIndex] = useState(null);
  const inputRefs = useRef([]);
  const memoList = Array.isArray(memos) ? memos : [];

  useEffect(() => {
    if (editingIndex === null) return;
    if (editingIndex >= memoList.length) {
      setEditingIndex(null);
    }
  }, [editingIndex, memoList.length]);

  useEffect(() => {
    if (editingIndex === null) return undefined;
    const frameId = requestAnimationFrame(() => {
      inputRefs.current[editingIndex]?.focus({ preventScroll: true });
      inputRefs.current[editingIndex]?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [editingIndex]);

  if (memoList.length === 0) return null;

  const canReorderMemos = memoList.length > 1;
  const commitMemoEdit = (index, value) => {
    const nextValue = String(value || '').trim();
    const nextMemos = memoList
      .map((memo, memoIndex) => (memoIndex === index ? nextValue : memo))
      .map((memo) => String(memo || '').trim())
      .filter(Boolean);
    onAction({ type: 'memoUpdate', index, value: nextValue, memos: nextMemos });
    setEditingIndex(null);
  };

  return (
    <div className="context-menu-note-list">
      {memoList.map((item, index) => (
        <div key={`memo-${index}`} className="context-menu-note-item">
          {editingIndex === index ? (
            <input
              ref={(node) => {
                inputRefs.current[index] = node;
              }}
              type="text"
              className="context-menu-input context-menu-input--memo"
              value={item}
              aria-label={`메모 ${index + 1} 수정`}
              title="메모 수정"
              onChange={(event) => {
                event.stopPropagation();
                onDraftChange(index, event.target.value);
              }}
              onBlur={(event) => {
                event.stopPropagation();
                commitMemoEdit(index, event.target.value);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitMemoEdit(index, event.currentTarget.value);
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditingIndex(null);
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="context-menu-list-text" title={item}>{item}</span>
          )}
          <div className="context-menu-note-actions">
            {editingIndex === index ? null : (
              <button
                type="button"
                className="context-menu-note-icon-button"
                aria-label="메모 수정"
                title="수정"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setEditingIndex(index);
                }}
              >
                <Pencil size={13} strokeWidth={2.4} />
              </button>
            )}
            {canReorderMemos ? (
              <div className="context-menu-note-reorder-stack">
                <button
                  type="button"
                  className="context-menu-note-icon-button context-menu-note-order-button"
                  aria-label="메모 위로 이동"
                  title="위로 이동"
                  disabled={index === 0}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onAction({ type: 'memoMove', index, direction: 'up' });
                  }}
                >
                  <ArrowUp size={11} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  className="context-menu-note-icon-button context-menu-note-order-button"
                  aria-label="메모 아래로 이동"
                  title="아래로 이동"
                  disabled={index === memoList.length - 1}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onAction({ type: 'memoMove', index, direction: 'down' });
                  }}
                >
                  <ArrowDown size={11} strokeWidth={2.5} />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="context-menu-note-icon-button context-menu-note-remove"
              aria-label="메모 삭제"
              title="삭제"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAction({ type: 'memoRemove', index });
              }}
            >
              <Trash2 size={14} strokeWidth={2.3} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
