import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import '../../styles/shockwave_stats.css';

export default function ShockwaveDataGrid({ logs, therapists, currentYear, currentMonth, fetchLogs }) {
  // === Data and Layout Preparation ===
  const generateDraftRows = (count, startIndex) => {
    return Array.from({ length: count }).map((_, i) => ({
      id: `draft-${startIndex + i}`, date: '', patient_name: '', chart_number: '', visit_count: '', body_part: '', therapist_name: '', prescription: '', prescription_count: '', isDraft: true
    }));
  };

  const gridData = useMemo(() => {
    const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const groups = {};
    sortedLogs.forEach(log => {
      if (!groups[log.date]) groups[log.date] = { items: [], total: 0 };
      groups[log.date].items.push(log);
      if (log.prescription) groups[log.date].total += parseInt(log.prescription_count || '1', 10) || 1;
    });

    const flattened = [];
    Object.keys(groups).sort().forEach(date => {
      const g = groups[date];
      g.items.forEach((log, idx) => {
        flattened.push({
          ...log,
          isFirstOfDate: idx === 0,
          isLastOfDate: idx === g.items.length - 1,
          dailyTotal: idx === 0 ? g.total : null,
          groupSize: g.items.length
        });
      });
    });

    const minRows = 80; // Keep plenty of drafting space
    const draftsNeeded = Math.max(minRows - flattened.length, 30);
    generateDraftRows(draftsNeeded, flattened.length).forEach(d => {
      flattened.push({ ...d, isFirstOfDate: true, isLastOfDate: true, dailyTotal: null, groupSize: 1 });
    });

    return flattened;
  }, [logs]);

  const columns = useMemo(() => {
    const cols = [
      { id: 'date', label: '날짜', width: 80, isFixed: true, align: 'center', field: 'date' },
      { id: 'patient_name', label: '이름', width: 90, isFixed: true, align: 'center', field: 'patient_name', bold: true },
      { id: 'chart_number', label: '차트번호', width: 90, isFixed: true, align: 'center', field: 'chart_number', color: '#5f6368' },
      { id: 'visit_count', label: '회차', width: 60, isFixed: true, align: 'center', field: 'visit_count' },
      { id: 'body_part', label: '부위', width: 140, isFixed: true, align: 'left', field: 'body_part' },
    ];
    
    therapists.forEach(t => {
      cols.push({ id: `T_${t.id}_F1.5`, label: 'F1.5', therapist: t.name, pres: 'F1.5', width: 45, align: 'center' });
      cols.push({ id: `T_${t.id}_F/Rdc`, label: 'F/Rdc', therapist: t.name, pres: 'F/R DC', width: 45, align: 'center' });
      cols.push({ id: `T_${t.id}_F/R`, label: 'F/R', therapist: t.name, pres: 'F/R', width: 45, align: 'center' });
    });
    
    cols.push({ id: 'totalCount', label: '총건수', width: 60, isReadOnly: true, align: 'center', color: '#cc0000', bold: true });
    return cols;
  }, [therapists]);

  // Utility to read cell value from log depending on column definition
  const getCellValue = (row, col) => {
    if (col.id === 'totalCount') return row.dailyTotal > 0 ? row.dailyTotal : '';
    // Format date specifically for display if it's the date column
    if (col.id === 'date') {
        if (!row.date) return '';
        const parts = row.date.split('-');
        return parts.length === 3 ? `${parts[1]}/${parts[2]}` : row.date;
    }
    if (col.therapist) {
      if (row.therapist_name === col.therapist && row.prescription === col.pres) {
        return row.prescription_count || '1';
      }
      return '';
    }
    return row[col.field] || '';
  };

  // State
  const [selectedRange, setSelectedRange] = useState(null);
  const [focusedCell, setFocusedCell] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingCell, setEditingCell] = useState(null); // { r, c, value }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, row, col }

  const gridRef = useRef(null);
  const editInputRef = useRef(null);

  // === Handlers ===
  const handleMouseDown = (e, r, c) => {
    if (e.button === 2) return; // Right click handled separately
    if (editingCell) finishEditing();
    
    setFocusedCell({ r, c });
    setSelectedRange({ startRow: r, startCol: c, endRow: r, endCol: c });
    setIsDragging(true);
    setContextMenu(null);
  };

  const handleMouseEnter = (r, c) => {
    if (isDragging && selectedRange) {
      setSelectedRange(prev => ({ ...prev, endRow: r, endCol: c }));
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDoubleClick = (r, c) => {
    if (columns[c].isReadOnly) return;
    setEditingCell({ r, c, value: gridData[r][columns[c].field] || getCellValue(gridData[r], columns[c]) });
  };

  const handleContextMenu = (e, r, c) => {
    e.preventDefault();
    if (editingCell) finishEditing();
    // If clicked outside selection, select exactly this cell
    if (!isInSelection(r, c)) {
        setFocusedCell({ r, c });
        setSelectedRange({ startRow: r, startCol: c, endRow: r, endCol: c });
    }
    setContextMenu({ x: e.clientX, y: e.clientY, row: r, col: c });
  };

  const isInSelection = (r, c) => {
    if (!selectedRange) return false;
    const minR = Math.min(selectedRange.startRow, selectedRange.endRow);
    const maxR = Math.max(selectedRange.startRow, selectedRange.endRow);
    const minC = Math.min(selectedRange.startCol, selectedRange.endCol);
    const maxC = Math.max(selectedRange.startCol, selectedRange.endCol);
    return r >= minR && r <= maxR && c >= minC && c <= maxC;
  };

  // Edit completion triggers UPSERT logic
  const finishEditing = async () => {
    if (!editingCell) return;
    const { r, c, value } = editingCell;
    setEditingCell(null);
    gridRef.current?.focus(); // Return focus to grid for keyboard navigation

    const row = gridData[r];
    const colName = columns[c];
    const oldValue = getCellValue(row, colName);

    if (value === oldValue) return; // No change

    // Construct upsert object
    let updates = { id: row.id };
    if (row.isDraft) {
      delete updates.id; // Let Supabase gen UUID
      // Fill draft required fields or defaults
      updates.date = row.date || `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      updates.patient_name = row.patient_name || '';
    }

    if (colName.therapist) {
      // It's a prescription cell
      if (value.trim() === '') {
         // Erase if this was the active prescription
         if (row.therapist_name === colName.therapist && row.prescription === colName.pres) {
            updates.therapist_name = '';
            updates.prescription = '';
            updates.prescription_count = '';
         }
      } else {
         updates.therapist_name = colName.therapist;
         updates.prescription = colName.pres;
         updates.prescription_count = value.trim();
      }
    } else {
      // Normal field
      if (colName.field === 'date') {
         // Auto prefix year if user just types MM-DD
         let formattedVal = value;
         if (value.length === 5 && value.includes('/')) formattedVal = `${currentYear}-${value.replace('/', '-')}`;
         else if (value.length === 5 && value.includes('-')) formattedVal = `${currentYear}-${value}`;
         else if (value.length === 4 && !value.includes('-')) formattedVal = `${currentYear}-${value.substring(0,2)}-${value.substring(2,4)}`;
         updates[colName.field] = formattedVal;
      } else {
         updates[colName.field] = value;
      }
    }

    // Merge existing fields to satisfy NOT NULL constraints if it's a draft
    if (row.isDraft) {
        updates = {
            date: row.date,
            patient_name: row.patient_name,
            chart_number: row.chart_number || '',
            visit_count: row.visit_count || '',
            body_part: row.body_part || '',
            therapist_name: row.therapist_name || '',
            prescription: row.prescription || '',
            prescription_count: row.prescription_count || '',
            ...updates
        };
        // Auto default date if missing
        if (!updates.date) {
            const yesterdayOrLastLog = r > 0 ? gridData[r-1].date : `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
            updates.date = yesterdayOrLastLog;
        }
        if (!updates.patient_name) updates.patient_name = '(이름 모름)';
    }

    try {
        await supabase.from('shockwave_patient_logs').upsert([updates]);
        fetchLogs();
    } catch (err) {
        console.error("Upsert failed", err);
    }
  };

  // Keyboard navigation & copying
  useEffect(() => {
    const handleKeyDown = (e) => {
      // If Context Menu open
      if (contextMenu) {
         if (e.key === 'Escape') setContextMenu(null);
         return;
      }

      // If editing, only handle Escape and Enter
      if (editingCell) {
        if (e.key === 'Escape') setEditingCell(null);
        if (e.key === 'Enter') {
          e.preventDefault();
          finishEditing().then(() => {
             // Move focus down
             const nextRow = Math.min(editingCell.r + 1, gridData.length - 1);
             setFocusedCell({ r: nextRow, c: editingCell.c });
             setSelectedRange({ startRow: nextRow, startCol: editingCell.c, endRow: nextRow, endCol: editingCell.c });
          });
        }
        return;
      }

      // We need focused cell
      if (!focusedCell) return;
      let { r, c } = focusedCell;

      if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
      if (e.key === 'ArrowDown') r = Math.min(gridData.length - 1, r + 1);
      if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
      if (e.key === 'ArrowRight') c = Math.min(columns.length - 1, c + 1);

      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        setFocusedCell({ r, c });
        if (e.shiftKey && selectedRange) {
           setSelectedRange(prev => ({ ...prev, endRow: r, endCol: c }));
        } else {
           setSelectedRange({ startRow: r, startCol: c, endRow: r, endCol: c });
        }
        return;
      }

      if (e.key === 'Enter') {
         e.preventDefault();
         handleDoubleClick(r, c);
         return;
      }

      // Delete contents
      if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          handleDeleteSelection();
          return;
      }

      // Any printable character starts editing
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (!columns[c].isReadOnly) {
             setEditingCell({ r, c, value: '' }); 
             // value is empty so the new char replaces it immediately. The input field will capture the char if autoFocus is fast enough, but to be safe we can prefill:
             setTimeout(() => { if (editInputRef.current) editInputRef.current.value = e.key; }, 0);
          }
      }

      // Copy / Paste / Cut
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); handleCopy(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'x') { e.preventDefault(); handleCut(); }
      // Pasta happens natively in browser via 'paste' event.
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedCell, selectedRange, editingCell, gridData, columns, currentYear, currentMonth]);

  // Paste Event Listener
  useEffect(() => {
      const handlePaste = (e) => {
          if (editingCell) return;
          if (!focusedCell) return;
          const text = (e.clipboardData || window.clipboardData).getData('text');
          if (text) {
              e.preventDefault();
              processPaste(text, focusedCell.r, focusedCell.c);
          }
      };
      window.addEventListener('paste', handlePaste);
      return () => window.removeEventListener('paste', handlePaste);
  }, [focusedCell, editingCell, gridData, columns]);

  const handleCopy = () => {
      if (!selectedRange) return;
      const minR = Math.min(selectedRange.startRow, selectedRange.endRow);
      const maxR = Math.max(selectedRange.startRow, selectedRange.endRow);
      const minC = Math.min(selectedRange.startCol, selectedRange.endCol);
      const maxC = Math.max(selectedRange.startCol, selectedRange.endCol);
      
      let tsv = '';
      for (let r = minR; r <= maxR; r++) {
          let rowStr = [];
          for (let c = minC; c <= maxC; c++) {
              rowStr.push(getCellValue(gridData[r], columns[c]));
          }
          tsv += rowStr.join('\t') + '\n';
      }
      navigator.clipboard.writeText(tsv);
      // Optional: show toast
  };

  const handleCut = () => {
      handleCopy();
      handleDeleteSelection();
  };

  const processPaste = async (text, startR, startC) => {
      const rows = text.split('\n').map(line => line.split('\t'));
      let toUpsert = [];

      for (let i = 0; i < rows.length; i++) {
          if (rows[i].length === 1 && rows[i][0] === '') continue; // skip last empty newline
          const r = startR + i;
          if (r >= gridData.length) break;
          
          let row = gridData[r];
          let updates = { id: row.id };
          if (row.isDraft) {
              delete updates.id;
              updates.date = row.date || `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
              updates.patient_name = row.patient_name || '(이름모름)';
          } else {
              updates.date = row.date;
              updates.patient_name = row.patient_name;
          }

          for (let j = 0; j < rows[i].length; j++) {
              const c = startC + j;
              if (c >= columns.length) break;
              const colName = columns[c];
              if (colName.isReadOnly) continue;

              const val = rows[i][j].trim();
              if (colName.therapist) {
                  if (val !== '') {
                      updates.therapist_name = colName.therapist;
                      updates.prescription = colName.pres;
                      updates.prescription_count = val;
                  }
              } else {
                  if (colName.field === 'date') {
                      let formattedVal = val;
                      if (val.length === 5 && val.includes('/')) formattedVal = `${currentYear}-${val.replace('/', '-')}`;
                      updates[colName.field] = formattedVal;
                  } else {
                      updates[colName.field] = val;
                  }
              }
          }
          toUpsert.push(updates);
      }

      if (toUpsert.length > 0) {
          await supabase.from('shockwave_patient_logs').upsert(toUpsert);
          fetchLogs();
      }
  };

  const handleDeleteSelection = async () => {
      if (!selectedRange) return;
      const minR = Math.min(selectedRange.startRow, selectedRange.endRow);
      const maxR = Math.max(selectedRange.startRow, selectedRange.endRow);
      const minC = Math.min(selectedRange.startCol, selectedRange.endCol);
      const maxC = Math.max(selectedRange.startCol, selectedRange.endCol);
      
      let toUpsert = [];
      for (let r = minR; r <= maxR; r++) {
         let row = gridData[r];
         if (row.isDraft) continue; // Can't delete what hasn't been saved

         // If ALL columns selected for a row, we could theoretically delete the whole record.
         // Let's just clear the fields. Actual deletion via context menu.
         let updates = { id: row.id };
         let modified = false;

         for (let c = minC; c <= maxC; c++) {
             const colName = columns[c];
             if (colName.isReadOnly) continue;
             if (colName.therapist) {
                 if (row.therapist_name === colName.therapist && row.prescription === colName.pres) {
                     updates.therapist_name = '';
                     updates.prescription = '';
                     updates.prescription_count = '';
                     modified = true;
                 }
             } else {
                 updates[colName.field] = '';
                 modified = true;
             }
         }
         if (modified) toUpsert.push(updates);
      }

      if (toUpsert.length > 0) {
          await supabase.from('shockwave_patient_logs').upsert(toUpsert);
          fetchLogs();
      }
  };

  const deleteRowCompletely = async (rowIndex) => {
      const row = gridData[rowIndex];
      if (row && !row.isDraft) {
          if (window.confirm(`${row.patient_name} 데이터를 삭제하시겠습니까?`)) {
              await supabase.from('shockwave_patient_logs').delete().eq('id', row.id);
              setContextMenu(null);
              fetchLogs();
          }
      }
  };

  // Effect to focus input
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Click outside to cancel context menu
  useEffect(() => {
      const closeMenu = (e) => {
          if (contextMenu) setContextMenu(null);
      };
      window.addEventListener('mousedown', closeMenu);
      return () => window.removeEventListener('mousedown', closeMenu);
  }, [contextMenu]);

  // View Calculation
  // Total sum of everything
  const grandTotal = logs.reduce((s, l) => s + (l.prescription ? (parseInt(l.prescription_count || '1', 10) || 1) : 0), 0);

  return (
    <div className="sw-grid-wrapper" tabIndex={0} onMouseUp={handleMouseUp} outline="none">
      <table className="sw-stats-table custom-grid">
        <thead>
          {/* R1: Title */}
          <tr>
            <th colSpan={columns.length} className="spreadsheet-title" style={{ backgroundColor: '#c3b4f3', fontSize: '1.2rem', padding: '10px' }}>
              {currentMonth}월 충격파 현황
            </th>
          </tr>
          
          {/* R2: Header & Therapists */}
          <tr className="spreadsheet-header-row2">
            <th rowSpan={3} className="sticky-col" style={{ left: 0, width: 80, backgroundColor: '#e2f0d9' }}>날짜</th>
            <th rowSpan={3} className="sticky-col" style={{ left: 80, width: 90, backgroundColor: '#e2f0d9' }}>이름</th>
            <th rowSpan={3} className="sticky-col" style={{ left: 170, width: 90, backgroundColor: '#e2f0d9' }}>차트번호</th>
            <th rowSpan={3} className="sticky-col" style={{ left: 260, width: 60, backgroundColor: '#e2f0d9' }}>회차</th>
            <th rowSpan={3} className="sticky-col border-right-heavy" style={{ left: 320, width: 140, backgroundColor: '#e2f0d9' }}>부위</th>
            
            {therapists.map((t, idx) => {
              const colors = ['#cde4f9', '#ffebb4', '#d9ead3', '#fce5cd', '#ead1dc'];
              const bgColor = colors[idx % colors.length];
              const total = logs.reduce((sum, log) => {
                if (log.therapist_name === t.name && log.prescription) return sum + (parseInt(log.prescription_count || '1', 10) || 1);
                return sum;
              }, 0);

              return (
                <th key={'th1_'+t.id} colSpan={3} style={{ backgroundColor: bgColor }}>
                  {t.name} ( {total}건 )
                </th>
              );
            })}
            <th rowSpan={2} style={{ width: '60px', backgroundColor: '#c1a8c8' }}>총건수</th>
          </tr>

          {/* R3: Prescription Types */}
          <tr className="spreadsheet-header-row3">
            {therapists.map((t, idx) => {
              const colors = ['#cde4f9', '#ffebb4', '#d9ead3', '#fce5cd', '#ead1dc'];
              const bgColor = colors[idx % colors.length];
              return (
                <React.Fragment key={'th2_'+t.id}>
                  <th style={{ backgroundColor: bgColor }}>F1.5</th>
                  <th style={{ backgroundColor: bgColor }}>F/Rdc</th>
                  <th style={{ backgroundColor: bgColor }}>F/R</th>
                </React.Fragment>
              );
            })}
          </tr>

          {/* R4: Prescription Totals */}
          <tr className="spreadsheet-header-row4">
            {therapists.map((t, idx) => {
              let f15 = 0, frdc = 0, fr = 0;
              logs.forEach(log => {
                if (log.therapist_name === t.name && log.prescription) {
                  const cnt = parseInt(log.prescription_count || '1', 10) || 1;
                  const p = log.prescription === 'F/R DC' ? 'F/Rdc' : log.prescription;
                  if (p === 'F1.5') f15 += cnt; else if (p === 'F/Rdc') frdc += cnt; else if (p === 'F/R') fr += cnt;
                }
              });
              return (
                <React.Fragment key={'th3_'+t.id}>
                  <th style={{ color: 'blue' }}>{f15}</th>
                  <th style={{ color: 'blue' }}>{frdc}</th>
                  <th style={{ color: 'blue' }}>{fr}</th>
                </React.Fragment>
              );
            })}
            <th style={{ fontSize: '1.2rem', color: '#cc0000', backgroundColor: '#f4cccc' }}>
              {grandTotal}건
            </th>
          </tr>
        </thead>

        <tbody>
          {gridData.map((row, rIndex) => {
            // Determine vertical visuals for date and total
            // To simulate rowspan, we hide the top border of the cell and make text transparent unless it's the first
            const isFirst = row.isFirstOfDate;
            const isLast = row.isLastOfDate;
            const groupClasses = `group-cell ${isFirst ? 'group-first' : ''} ${isLast ? 'group-last' : ''} ${!isFirst && !isLast ? 'group-middle' : ''}`;

            return (
              <tr key={row.id}>
                {columns.map((col, cIndex) => {
                  const isSelected = isInSelection(rIndex, cIndex);
                  const isFocused = focusedCell?.r === rIndex && focusedCell?.c === cIndex;
                  const isEditing = editingCell?.r === rIndex && editingCell?.c === cIndex;
                  
                  // Sticky left offsets calculation
                  const stickyStyle = col.isFixed ? { position: 'sticky', left: col.id === 'date' ? 0 : col.id === 'patient_name' ? 80 : col.id === 'chart_number' ? 170 : col.id === 'visit_count' ? 260 : 320, zIndex: 5, backgroundColor: isSelected ? '#e8f0fe' : '#fff' } : {};
                  if (col.id === 'body_part') stickyStyle.borderRight = '2px solid #000'; // freeze border

                  let cellValue = getCellValue(row, col);

                  // Apply transparent text if it is grouped and NOT first
                  let cellStyle = { ...stickyStyle, width: col.width, minWidth: col.width, maxWidth: col.width };
                  let cls = `grid-cell align-${col.align} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`;
                  
                  if (col.id === 'date' || col.id === 'totalCount') {
                      cls += ' ' + groupClasses;
                      if (!isFirst) {
                          cellValue = ''; // Visually empty
                      }
                  }

                  if (col.color) cellStyle.color = col.color;
                  if (col.bold) cellStyle.fontWeight = 'bold';
                  if (col.therapist) cls += ' therapist-cell';

                  if (isEditing) {
                     return (
                         <td key={cIndex} className={cls} style={{...cellStyle, padding: 0}}>
                            <input
                              ref={editInputRef}
                              className="inline-editor"
                              value={editingCell.value}
                              onChange={e => setEditingCell({...editingCell, value: e.target.value})}
                              onBlur={finishEditing}
                            />
                         </td>
                     );
                  }

                  return (
                    <td 
                      key={cIndex}
                      className={cls}
                      style={cellStyle}
                      onMouseDown={(e) => handleMouseDown(e, rIndex, cIndex)}
                      onMouseEnter={() => handleMouseEnter(rIndex, cIndex)}
                      onDoubleClick={() => handleDoubleClick(rIndex, cIndex)}
                      onContextMenu={(e) => handleContextMenu(e, rIndex, cIndex)}
                    >
                      {cellValue}
                      {isFocused && <div className="focus-ring"></div>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Context Menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onMouseDown={e => e.stopPropagation()}>
          <div className="context-menu-item" onClick={() => { handleCopy(); setContextMenu(null); }}>복사 (Ctrl+C)</div>
          <div className="context-menu-item" onClick={() => { handleCut(); setContextMenu(null); }}>잘라내기 (Ctrl+X)</div>
          <div className="context-menu-item" onClick={async () => {
              try {
                 const text = await navigator.clipboard.readText();
                 processPaste(text, contextMenu.row, contextMenu.col);
              } catch (e) { alert("붙여넣기 권한이 필요합니다. Ctrl+V를 사용해주세요."); }
              setContextMenu(null);
          }}>붙여넣기 (Ctrl+V)</div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={() => { handleDeleteSelection(); setContextMenu(null); }}>선택 셀 내용 지우기 (Del)</div>
          <div className="context-menu-item delete-row" onClick={() => { deleteRowCompletely(contextMenu.row); }}>이 행(데이터) 영구 삭제</div>
        </div>
      )}
    </div>
  );
}
