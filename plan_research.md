# Grid Implementation Details

## Data Flattening
Logs are sorted by date.
```javascript
const combinedRows = [...logs, ...draftRows];
// draftRows = 30 empty rows
```

## Styling for "RowSpan" Simulation
```css
/* date cell simulation */
.cell-date.group-middle {
    border-top: none !important;
    border-bottom: none !important;
    color: transparent;
}
.cell-date.group-first {
    border-bottom: none !important;
}
.cell-date.group-last {
    border-top: none !important;
}
```
Wait, if `color: transparent`, it won't show. First row has text, middle/last rows have transparent text.
Actually, we don't even need text in middle rows, we can just render `null` value.

## ColDefs
```javascript
   const colSpecs = [
      { id: 'date', width: 80, text: '날짜', fixedOffset: 0 },
      { id: 'patient_name', width: 90, text: '이름', fixedOffset: 80 },
      { id: 'chart_number', width: 90, text: '차트번호', fixedOffset: 170 },
      ...
   ]
```
