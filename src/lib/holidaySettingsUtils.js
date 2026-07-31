export function getHolidayEditDraft(holiday = {}) {
  return {
    id: String(holiday.id || ''),
    date: String(holiday.date || '').slice(0, 10),
    name: String(holiday.name || ''),
  };
}

export function buildHolidayUpdateRequest(editingHoliday = {}, holidays = []) {
  const id = String(editingHoliday.id || '').trim();
  const date = String(editingHoliday.date || '').trim().slice(0, 10);
  const name = String(editingHoliday.name || '').trim();

  if (!id) {
    return { ok: false, message: '수정할 공휴일을 찾을 수 없습니다.' };
  }
  if (!date) {
    return { ok: false, message: '공휴일 날짜를 선택해 주세요.' };
  }

  const hasDuplicateDate = (Array.isArray(holidays) ? holidays : []).some((holiday) => (
    String(holiday?.id || '') !== id
    && String(holiday?.date || '').slice(0, 10) === date
  ));
  if (hasDuplicateDate) {
    return { ok: false, message: '같은 날짜의 공휴일이 이미 등록되어 있습니다.' };
  }

  return {
    ok: true,
    id,
    payload: {
      date,
      name: name || null,
    },
  };
}
