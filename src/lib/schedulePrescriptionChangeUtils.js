function getPayloadKey(item) {
  if (!item) return '';
  return item.key || `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
}

function pickPayloadMemoFields(item) {
  const next = {};
  if (Object.prototype.hasOwnProperty.call(item, 'content')) next.content = String(item.content ?? '');
  if (Object.prototype.hasOwnProperty.call(item, 'bg_color')) next.bg_color = item.bg_color ?? null;
  if (item.merge_span || item.mergeSpan) next.merge_span = item.merge_span || item.mergeSpan;
  if (Object.prototype.hasOwnProperty.call(item, 'prescription')) next.prescription = item.prescription ?? null;
  if (Object.prototype.hasOwnProperty.call(item, 'body_part')) next.body_part = item.body_part ?? null;
  return next;
}

export function mergeSchedulePayloadIntoPendingContextSaves(pendingMap, payload) {
  if (!pendingMap) return;
  const rows = Array.isArray(payload) ? payload : [payload];

  rows.filter(Boolean).forEach((item) => {
    const key = getPayloadKey(item);
    if (!key || !pendingMap.has(key)) return;

    const pending = pendingMap.get(key) || {};
    const memoFields = pickPayloadMemoFields(item);
    const overrides = {
      ...(pending.overrides || {}),
      ...memoFields,
    };

    pendingMap.set(key, {
      ...pending,
      memo: {
        ...(pending.memo || {}),
        ...memoFields,
      },
      overrides,
    });
  });
}

export function mergeSchedulePayloadIntoPendingShortcutSaves(pendingMap, payload) {
  if (!pendingMap) return;
  const rows = Array.isArray(payload) ? payload : [payload];

  rows.filter(Boolean).forEach((item) => {
    const key = getPayloadKey(item);
    if (!key || !pendingMap.has(key)) return;

    const pending = pendingMap.get(key) || {};
    const memoFields = pickPayloadMemoFields(item);
    const nextPending = {
      ...pending,
      memo: {
        ...(pending.memo || {}),
        ...memoFields,
      },
    };

    if (Object.prototype.hasOwnProperty.call(memoFields, 'content')) {
      if (Object.prototype.hasOwnProperty.call(pending, 'stableContent')) {
        nextPending.stableContent = memoFields.content;
      }
      if (Object.prototype.hasOwnProperty.call(pending, 'nextContent')) {
        nextPending.nextContent = memoFields.content;
      }
    }
    if (Object.prototype.hasOwnProperty.call(memoFields, 'merge_span') &&
      Object.prototype.hasOwnProperty.call(pending, 'nextMergeSpan')) {
      nextPending.nextMergeSpan = memoFields.merge_span;
    }

    pendingMap.set(key, nextPending);
  });
}
