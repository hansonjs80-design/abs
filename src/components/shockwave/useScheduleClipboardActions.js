import { useCallback } from 'react';
import { incrementSessionCount } from '../../lib/memoParser';
import {
  buildMergeSpanWithVisitCopyLink,
  clearVisitCopyLinkFromMergeSpan,
  cloneMergeSpanWithMeta,
  stripReservationTimeFromMergeSpan,
} from '../../lib/schedulerUtils';

export default function useScheduleClipboardActions({
  selectedCell,
  selectedCellRef,
  selectionInfo,
  memos,
  clipboardRef,
  clipboardSource,
  setClipboardSource,
  currentYear,
  currentMonth,
  baseTimeSlotsLength,
  colCount,
  cellKey,
  buildSchedulerAutoText,
  saveShockwaveMemosBulk,
  recordUndo,
  applyImmediateCellDisplay,
  applyImmediateMergeSpan,
  clearImmediateCellDisplay,
  addToast,
  setContextMenu,
}) {
  const buildMemoSnapshot = useCallback((w, d, r, c) => {
    const key = cellKey(w, d, r, c);
    const memo = memos[key];
    return {
      year: currentYear,
      month: currentMonth,
      week_index: w,
      day_index: d,
      row_index: r,
      col_index: c,
      content: memo?.content || '',
      bg_color: memo?.bg_color || null,
      merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
      prescription: memo?.prescription || '',
      body_part: memo?.body_part || '',
    };
  }, [cellKey, currentMonth, currentYear, memos]);

  const buildClipboardSelection = useCallback(() => {
    if (!selectedCell) return null;

    const range = selectionInfo || {
      w: selectedCell.w,
      d: selectedCell.d,
      minRow: selectedCell.r,
      maxRow: selectedCell.r,
      minCol: selectedCell.c,
      maxCol: selectedCell.c,
    };

    const rowCount = range.maxRow - range.minRow + 1;
    const colCountInRange = range.maxCol - range.minCol + 1;
    const cells = [];
    const plainRows = [];
    const sourceKeys = [];

    for (let rowOffset = 0; rowOffset < rowCount; rowOffset++) {
      const cellRow = [];
      const plainRow = [];
      for (let colOffset = 0; colOffset < colCountInRange; colOffset++) {
        const rowIndex = range.minRow + rowOffset;
        const colIndex = range.minCol + colOffset;
        const key = cellKey(range.w, range.d, rowIndex, colIndex);
        const memo = memos[key];
        cellRow.push({
          sourceKey: key,
          rowOffset,
          colOffset,
          content: memo?.content || '',
          bg_color: memo?.bg_color || null,
          merge_span: memo?.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: memo?.prescription || '',
          body_part: memo?.body_part || '',
        });
        plainRow.push(memo?.content || '');
        sourceKeys.push(key);
      }
      cells.push(cellRow);
      plainRows.push(plainRow.join('\t'));
    }

    return {
      mode: 'copy',
      srcW: range.w,
      srcD: range.d,
      srcMinRow: range.minRow,
      srcMinCol: range.minCol,
      rowCount,
      colCount: colCountInRange,
      cells,
      sourceKeys,
      plainText: plainRows.join('\n'),
    };
  }, [selectedCell, selectionInfo, memos, cellKey]);

  const parsePlainTextClipboard = useCallback((plainText, htmlText = null) => {
    if (typeof plainText !== 'string') return null;
    const normalized = plainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.length) return null;

    const rawRows = normalized.split('\n');
    while (rawRows.length > 1 && rawRows[rawRows.length - 1] === '') {
      rawRows.pop();
    }

    const cells = rawRows.map((rowText, rowOffset) =>
      rowText.split('\t').map((content, colOffset) => ({
        rowOffset,
        colOffset,
        content,
        bg_color: null,
        merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
        prescription: '',
      }))
    );

    if (htmlText) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const styleText = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('\n');
        const classColors = {};
        if (styleText) {
          const styleRegex = /\.([\w-]+)[^{]*\{([^}]+)\}/g;
          let match;
          while ((match = styleRegex.exec(styleText)) !== null) {
            const className = match[1];
            const rules = match[2].toLowerCase();
            const bgMatch = rules.match(/background(?:-color)?\s*:\s*([^;!}]+)/);
            if (bgMatch) {
              const parsedColor = bgMatch[1].trim().split(' ')[0];
              if (parsedColor && parsedColor !== 'none' && parsedColor !== 'transparent' && parsedColor !== 'windowtext') {
                classColors[className] = parsedColor;
              }
            }
          }
        }

        const tables = Array.from(doc.querySelectorAll('table'));
        const targetTable = tables.length > 0 ? tables[0] : null;
        const root = targetTable || doc.body;
        const rows = Array.from(root.querySelectorAll('tr'));
        let cellRowIdx = 0;

        for (let i = 0; i < rows.length; i++) {
          if (cellRowIdx >= cells.length) break;
          const tr = rows[i];
          const tds = Array.from(tr.querySelectorAll('td, th'));
          if (tds.length === 0) continue;

          for (let j = 0; j < tds.length; j++) {
            if (j >= cells[cellRowIdx].length) break;
            const td = tds[j];
            let bgColor = td.style.backgroundColor || td.getAttribute('bgcolor');

            if (!bgColor && td.hasAttribute('style')) {
              const styleStr = td.getAttribute('style').toLowerCase();
              const bgMatch = styleStr.match(/background(?:-color)?\s*:\s*([^;]+)/);
              if (bgMatch) {
                bgColor = bgMatch[1].trim().split(' ')[0];
              }
            }

            if (!bgColor && td.classList.length > 0) {
              for (const cls of Array.from(td.classList)) {
                if (classColors[cls]) {
                  bgColor = classColors[cls];
                  break;
                }
              }
            }

            if (bgColor && bgColor !== 'transparent' && bgColor !== 'none' && bgColor !== 'windowtext') {
              cells[cellRowIdx][j].bg_color = bgColor;
            }
          }
          cellRowIdx++;
        }
      } catch (e) {
        console.error('Failed to parse HTML from clipboard', e);
      }
    }

    const rowCount = cells.length;
    const pastedColCount = cells.reduce((max, row) => Math.max(max, row.length), 0);
    if (!rowCount || !pastedColCount) return null;

    return {
      mode: 'copy',
      srcW: selectedCell?.w ?? 0,
      srcD: selectedCell?.d ?? 0,
      srcMinRow: 0,
      srcMinCol: 0,
      rowCount,
      colCount: pastedColCount,
      cells,
      sourceKeys: [],
      plainText: normalized,
    };
  }, [selectedCell]);

  const buildPastePayload = useCallback((clip, target) => {
    if (!clip?.cells?.length) return [];
    const payload = [];
    const isCrossDate = clip.srcW !== target.w || clip.srcD !== target.d;
    const sourceMasterToTargetMaster = new Map();

    for (const row of clip.cells) {
      for (const cell of row) {
        const targetRow = target.r + cell.rowOffset;
        const targetCol = target.c + cell.colOffset;
        if (targetRow >= baseTimeSlotsLength || targetCol >= colCount) continue;

        const originalContent = cell.content || '';
        let nextContent = originalContent;
        let visitCopyLink = null;
        if (clip.mode === 'copy' && isCrossDate && nextContent) {
          nextContent = incrementSessionCount(nextContent);
          if (nextContent !== originalContent) {
            visitCopyLink = {
              sourceKey: cell.sourceKey || cellKey(
                clip.srcW,
                clip.srcD,
                clip.srcMinRow + cell.rowOffset,
                clip.srcMinCol + cell.colOffset
              ),
              originalContent,
              incrementedContent: nextContent,
            };
          }
        }

        let nextMergeSpan = { rowSpan: 1, colSpan: 1, mergedInto: null };
        const mergeSpan = cell.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null };
        const sourceCellKey = cellKey(
          clip.srcW,
          clip.srcD,
          clip.srcMinRow + cell.rowOffset,
          clip.srcMinCol + cell.colOffset
        );

        if (mergeSpan?.mergedInto) {
          let mappedMasterKey = sourceMasterToTargetMaster.get(mergeSpan.mergedInto);
          if (!mappedMasterKey) {
            const [, , sourceMasterRow, sourceMasterCol] = mergeSpan.mergedInto.split('-').map(Number);
            const masterRowOffset = sourceMasterRow - clip.srcMinRow;
            const masterColOffset = sourceMasterCol - clip.srcMinCol;
            mappedMasterKey = cellKey(
              target.w,
              target.d,
              target.r + masterRowOffset,
              target.c + masterColOffset
            );
            sourceMasterToTargetMaster.set(mergeSpan.mergedInto, mappedMasterKey);
          }
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, { rowSpan: 1, colSpan: 1, mergedInto: mappedMasterKey });
        } else if (mergeSpan?.rowSpan > 1 || mergeSpan?.colSpan > 1) {
          const mappedMasterKey = cellKey(target.w, target.d, targetRow, targetCol);
          sourceMasterToTargetMaster.set(sourceCellKey, mappedMasterKey);
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, {
            rowSpan: mergeSpan.rowSpan || 1,
            colSpan: mergeSpan.colSpan || 1,
            mergedInto: null,
          });
        } else if (mergeSpan?.meta) {
          nextMergeSpan = cloneMergeSpanWithMeta(mergeSpan, { rowSpan: 1, colSpan: 1, mergedInto: null });
        }
        nextMergeSpan = stripReservationTimeFromMergeSpan(nextMergeSpan);
        nextMergeSpan = visitCopyLink
          ? buildMergeSpanWithVisitCopyLink(nextMergeSpan, visitCopyLink)
          : clearVisitCopyLinkFromMergeSpan(nextMergeSpan);

        payload.push({
          year: currentYear,
          month: currentMonth,
          week_index: target.w,
          day_index: target.d,
          row_index: targetRow,
          col_index: targetCol,
          content: nextContent,
          bg_color: isCrossDate ? null : (cell.bg_color || null),
          merge_span: nextMergeSpan,
          prescription: cell.prescription || '',
          body_part: cell.body_part || '',
        });
      }
    }

    return payload;
  }, [baseTimeSlotsLength, colCount, currentYear, currentMonth, cellKey]);

  const handleCopySelection = useCallback(() => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'copy' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'copy' });
    navigator.clipboard.writeText(clip.plainText).catch(() => {
      console.debug('Clipboard sync failed during copy.');
    });
    addToast('복사됨', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, clipboardRef, setClipboardSource, addToast, setContextMenu]);

  const handleCutSelection = useCallback(async () => {
    const clip = buildClipboardSelection();
    if (!clip) return;
    clipboardRef.current = { ...clip, mode: 'cut' };
    setClipboardSource({ keys: new Set(clip.sourceKeys), mode: 'cut' });
    navigator.clipboard.writeText(clip.plainText).catch(() => {
      console.debug('Clipboard sync failed during cut.');
    });
    addToast('잘라내기됨 (붙여넣기 시 원본 삭제)', 'info');
    setContextMenu(null);
  }, [buildClipboardSelection, clipboardRef, setClipboardSource, addToast, setContextMenu]);

  const handlePasteSelection = useCallback(async (forcedPlainText = null, forcedHtmlText = null, explicitTargetCell = null) => {
    const targetCell = explicitTargetCell || selectedCellRef.current || selectedCell;
    if (!targetCell) return;
    let clip = clipboardRef.current;
    const currentClipboardSource = clipboardSource;

    if (typeof forcedPlainText === 'string') {
      const externalClip = parsePlainTextClipboard(forcedPlainText, forcedHtmlText);
      const internalPlainText = clipboardRef.current?.plainText || '';
      const normalizedForced = forcedPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedInternal = internalPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (externalClip?.cells?.length && normalizedForced !== normalizedInternal) {
        clip = externalClip;
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText) {
          const externalClip = parsePlainTextClipboard(clipboardText);
          const internalPlainText = clipboardRef.current?.plainText || '';
          const normalizedForced = clipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const normalizedInternal = internalPlainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          if (externalClip?.cells?.length && normalizedForced !== normalizedInternal) {
            clip = externalClip;
          }
        }
      } catch (error) {
        console.debug('Clipboard read failed during paste.', error);
      }
    }

    if (!clip?.cells?.length) {
      setContextMenu(null);
      return;
    }

    if (currentClipboardSource) {
      setClipboardSource(null);
    }

    const oldMemoSnapshots = new Map();
    const rememberOldMemo = (w, d, r, c) => {
      const key = cellKey(w, d, r, c);
      if (!oldMemoSnapshots.has(key)) {
        oldMemoSnapshots.set(key, buildMemoSnapshot(w, d, r, c));
      }
    };
    const targetRowCount = clip.rowCount;
    const targetColCountInRange = clip.colCount;
    for (let ro = 0; ro < targetRowCount; ro++) {
      for (let co = 0; co < targetColCountInRange; co++) {
        const tr = targetCell.r + ro;
        const tc = targetCell.c + co;
        if (tr >= baseTimeSlotsLength || tc >= colCount) continue;
        rememberOldMemo(targetCell.w, targetCell.d, tr, tc);
      }
    }

    const targetPayload = buildPastePayload(clip, targetCell);
    if (targetPayload.length === 0) {
      setContextMenu(null);
      return;
    }

    const enhancedPayload = await Promise.all(targetPayload.map(async (item) => {
      if (item.content && !item.prescription && !item.body_part) {
        const result = await buildSchedulerAutoText(
          item.week_index,
          item.day_index,
          item.row_index,
          item.col_index,
          item.content,
          true
        );
        return {
          ...item,
          content: result.text || item.content,
          prescription: result.prescription || item.prescription,
          body_part: result.bodyPart || item.body_part,
          merge_span: stripReservationTimeFromMergeSpan(result.mergeSpan || item.merge_span),
        };
      }
      return item;
    }));

    const combinedPayload = new Map();

    if (clip.mode === 'cut' && currentClipboardSource?.keys) {
      Array.from(currentClipboardSource.keys).forEach((k) => {
        const [w, d, r, c] = k.split('-').map(Number);
        rememberOldMemo(w, d, r, c);
        combinedPayload.set(`${w}-${d}-${r}-${c}`, {
          year: currentYear,
          month: currentMonth,
          week_index: w,
          day_index: d,
          row_index: r,
          col_index: c,
          content: '',
          bg_color: null,
          merge_span: { rowSpan: 1, colSpan: 1, mergedInto: null },
          prescription: '',
          body_part: '',
        });
      });
    }

    enhancedPayload.forEach((item) => {
      combinedPayload.set(
        `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`,
        item
      );
    });

    const payload = Array.from(combinedPayload.values());
    const oldMemos = Array.from(oldMemoSnapshots.values());
    recordUndo({ type: 'bulk-edit', oldMemos });
    applyImmediateCellDisplay(payload);
    applyImmediateMergeSpan(payload);
    const success = await saveShockwaveMemosBulk(payload);

    if (success) {
      clearImmediateCellDisplay(payload);
    } else {
      applyImmediateCellDisplay(oldMemos);
      applyImmediateMergeSpan(oldMemos);
      addToast('붙여넣기 실패', 'error');
      setContextMenu(null);
      return;
    }

    if (clip.mode === 'cut' && currentClipboardSource?.keys) {
      clipboardRef.current = { ...clip, mode: 'copy' };
    }

    addToast('붙여넣기 완료', 'success');
    setContextMenu(null);
  }, [
    selectedCell,
    selectedCellRef,
    clipboardRef,
    clipboardSource,
    buildMemoSnapshot,
    parsePlainTextClipboard,
    buildPastePayload,
    buildSchedulerAutoText,
    addToast,
    cellKey,
    currentYear,
    currentMonth,
    baseTimeSlotsLength,
    colCount,
    saveShockwaveMemosBulk,
    recordUndo,
    applyImmediateCellDisplay,
    applyImmediateMergeSpan,
    clearImmediateCellDisplay,
    setClipboardSource,
    setContextMenu,
  ]);

  return {
    handleCopySelection,
    handleCutSelection,
    handlePasteSelection,
  };
}
