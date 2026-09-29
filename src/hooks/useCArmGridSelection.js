import { useEffect, useRef, useState } from 'react';
import { cArmCellSelected, cArmSelectionBounds } from '../lib/cArmSelection';

export default function useCArmGridSelection({ rowCount, columnCount, disabled, onClear, onUndo, onRedo }) {
  const rootRef = useRef(null);
  const selectionRef = useRef(null);
  const dragRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const update = (next) => { selectionRef.current = next; setSelection(next); };
  const bounds = cArmSelectionBounds(selection);
  const focus = (cell) => {
    const input = rootRef.current?.querySelector(`[data-c-arm-row="${cell.row}"][data-c-arm-col="${cell.col}"] input`);
    input?.focus({ preventScroll: true });
    input?.select();
    input?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  useEffect(() => {
    const move = (event) => {
      if (dragRef.current !== event.pointerId) return;
      const cell = window.document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-c-arm-row]');
      if (!cell || !rootRef.current?.contains(cell)) return;
      const end = { row: Number(cell.dataset.cArmRow), col: Number(cell.dataset.cArmCol) };
      const current = selectionRef.current;
      if (!current || (current.end.row === end.row && current.end.col === end.col)) return;
      const next = { ...current, end };
      selectionRef.current = next;
      setSelection(next);
    };
    const stop = () => { dragRef.current = null; };
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        dragRef.current = null;
        selectionRef.current = null;
        setSelection(null);
      }
    };
    window.document.addEventListener('pointermove', move);
    window.document.addEventListener('pointerup', stop);
    window.document.addEventListener('pointercancel', stop);
    window.document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', stop);
    return () => {
      window.document.removeEventListener('pointermove', move);
      window.document.removeEventListener('pointerup', stop);
      window.document.removeEventListener('pointercancel', stop);
      window.document.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', stop);
    };
  }, []);

  useEffect(() => {
    const current = selectionRef.current;
    if (current && (current.anchor.col >= columnCount || current.end.col >= columnCount)) {
      selectionRef.current = null;
      setSelection(null);
    }
  }, [columnCount]);

  const getCellProps = (row, col) => {
    const selected = cArmCellSelected(bounds, row, col);
    const active = selection?.anchor.row === row && selection?.anchor.col === col;
    return {
      'data-c-arm-row': row,
      'data-c-arm-col': col,
      'data-selected': selected ? 'true' : undefined,
      className: [selected && 'c-arm-cell-selected', active && 'c-arm-cell-active', selected && row === bounds.top && 'c-arm-range-top', selected && row === bounds.bottom && 'c-arm-range-bottom', selected && col === bounds.left && 'c-arm-range-left', selected && col === bounds.right && 'c-arm-range-right'].filter(Boolean).join(' '),
      onPointerDown: (event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        const cell = { row, col };
        const anchor = event.shiftKey && selectionRef.current ? selectionRef.current.anchor : cell;
        update({ anchor, end: cell });
        dragRef.current = event.pointerId;
        focus(anchor);
      },
    };
  };
  const onFocus = (row, col) => {
    if (!cArmCellSelected(cArmSelectionBounds(selectionRef.current), row, col)) update({ anchor: { row, col }, end: { row, col } });
  };
  const onKeyDown = (event) => {
    if (disabled || event.isComposing) return;
    const current = selectionRef.current;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo(); return; }
    if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); onRedo(); return; }
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      update({ anchor: { row: 1, col: 0 }, end: { row: rowCount, col: columnCount - 1 } });
      return;
    }
    if (!current) return;
    if (event.key === 'Escape') { event.preventDefault(); update(null); event.currentTarget.blur(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onClear(cArmSelectionBounds(current)); return; }
    let target = { ...(event.shiftKey ? current.end : current.anchor) };
    const movements = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (movements[event.key]) {
      target.row += movements[event.key][0];
      target.col += movements[event.key][1];
    } else if (event.key === 'Enter') target.row += event.shiftKey ? -1 : 1;
    else if (event.key === 'Tab') {
      target.col += event.shiftKey ? -1 : 1;
      if (target.col >= columnCount) { target.col = 0; target.row += 1; }
      if (target.col < 0) { target.col = columnCount - 1; target.row -= 1; }
      if (target.row < 1 || target.row > rowCount) return;
    } else return;
    event.preventDefault();
    target = { row: Math.max(1, Math.min(rowCount, target.row)), col: Math.max(0, Math.min(columnCount - 1, target.col)) };
    const extend = event.shiftKey && Boolean(movements[event.key]);
    update({ anchor: extend ? current.anchor : target, end: target });
    if (!extend) focus(target);
  };
  return { rootRef, bounds, getCellProps, onFocus, onKeyDown, selectRange: update };
}
