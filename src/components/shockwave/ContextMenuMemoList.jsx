import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';

export default function ContextMenuMemoList({
  memos,
  onDraftChange,
  onAction,
}) {
  if (!Array.isArray(memos) || memos.length === 0) return null;

  const canReorderMemos = memos.length > 1;

  return (
    <div className="context-menu-note-list">
      {memos.map((item, index) => (
        <div key={`${index}-${item}`} className="context-menu-note-item">
          <input
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
              onAction({ type: 'memoUpdate', index, value: event.target.value });
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                onAction({ type: 'memoUpdate', index, value: event.currentTarget.value });
                event.currentTarget.blur();
              }
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
          <div className="context-menu-note-actions">
            {canReorderMemos ? (
              <>
                <button
                  type="button"
                  className="context-menu-note-icon-button"
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
                  <ArrowUp size={14} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  className="context-menu-note-icon-button"
                  aria-label="메모 아래로 이동"
                  title="아래로 이동"
                  disabled={index === memos.length - 1}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onAction({ type: 'memoMove', index, direction: 'down' });
                  }}
                >
                  <ArrowDown size={14} strokeWidth={2.4} />
                </button>
              </>
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
