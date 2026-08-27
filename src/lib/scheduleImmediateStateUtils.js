const EMPTY_SCHEDULE_IMMEDIATE_STATE = Object.freeze({});

export function getScheduleImmediateStateMonthKey(year, month) {
  return `${Number(year)}-${String(Number(month)).padStart(2, '0')}`;
}

export function scopeScheduleImmediateState(state, stateMonthKey, year, month) {
  const activeMonthKey = getScheduleImmediateStateMonthKey(year, month);
  return stateMonthKey === activeMonthKey
    ? (state || EMPTY_SCHEDULE_IMMEDIATE_STATE)
    : EMPTY_SCHEDULE_IMMEDIATE_STATE;
}

