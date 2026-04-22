import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DAY_NAMES,
  getDateOverridesForMonth,
  getMonthlyDayOverrides,
  getMonthKey,
  setMonthlyDayOverrides,
} from '../../lib/schedulerOperatingHours';
import {
  getEffectiveStaffScheduleBlockRules,
  setMonthlyStaffScheduleBlockRules,
} from '../../lib/staffScheduleBlockRules';

/**
 * 월별 치료사 설정 모달
 * - 충격파 / 도수치료 탭 분리
 * - 슬롯(열) 번호별로 날짜 범위 + 치료사 이름 설정
 * - 같은 슬롯에 여러 기간을 분할 설정 가능
 * - 빈 이름 = 해당 기간 비활성
 */
export default function MonthlyTherapistConfig({
  year,
  month,
  therapists,              // 충격파 기본 치료사 목록
  manualTherapists,        // 도수치료 기본 치료사 목록
  monthlyTherapists,       // 현재 월별 충격파 설정
  monthlyManualTherapists, // 현재 월별 도수치료 설정
  onSave,                  // (year, month, configs, type) => Promise<boolean>
  onSaveRoster,            // (type, roster) => Promise<boolean>
  settings,
  onSaveSettings,
  onClose,
}) {
  const [configSection, setConfigSection] = useState('therapists'); // therapists | weekly | dates | staffBlocks
  const [activeTab, setActiveTab] = useState('shockwave'); // 'shockwave' | 'manual_therapy'

  const currentTherapists = activeTab === 'manual_therapy' ? manualTherapists : therapists;
  const lastDay = new Date(year, month, 0).getDate();

  // 탭별 로컬 편집 상태
  const [shockwaveSlots, setShockwaveSlots] = useState(null);
  const [manualSlots, setManualSlots] = useState(null);
  const [dayOverrides, setDayOverrides] = useState({});
  const [dateOverrides, setDateOverrides] = useState({});
  const [staffBlockRules, setStaffBlockRules] = useState([]);
  const [newDateOverride, setNewDateOverride] = useState({
    date: '',
    start_time: '',
    end_time: '',
    lunch_start: '',
    lunch_end: '',
    no_lunch: false,
  });

  const buildSlots = useCallback((therapistList, monthlyData) => {
    const ld = new Date(year, month, 0).getDate();
    const therapistCount = Array.isArray(therapistList) ? therapistList.length : 0;
    const monthlyMaxSlot = (Array.isArray(monthlyData) ? monthlyData : []).reduce(
      (max, item) => Math.max(max, Number(item?.slot_index) || 0),
      -1
    );
    const count = Math.max(1, therapistCount, monthlyMaxSlot + 1);
    const map = {};
    for (let i = 0; i < count; i++) {
      map[i] = [];
    }
    if (monthlyData && monthlyData.length > 0) {
      monthlyData.forEach((item) => {
        if (item.slot_index < count) {
          if (!map[item.slot_index]) map[item.slot_index] = [];
          map[item.slot_index].push({
            therapist_name: item.therapist_name ?? '',
            start_day: item.start_day,
            end_day: Math.min(item.end_day, ld),
          });
        }
      });
    }
    for (let i = 0; i < count; i++) {
      if (map[i].length === 0) {
        map[i] = [{
          therapist_name: therapistList?.[i]?.name || '',
          start_day: 1,
          end_day: ld,
        }];
      }
    }
    return map;
  }, [year, month]);

  // 초기화
  useEffect(() => {
    if (!shockwaveSlots) {
      setShockwaveSlots(buildSlots(therapists, monthlyTherapists));
    }
  }, [therapists, monthlyTherapists, buildSlots, shockwaveSlots]);

  useEffect(() => {
    if (!manualSlots) {
      setManualSlots(buildSlots(manualTherapists, monthlyManualTherapists));
    }
  }, [manualTherapists, monthlyManualTherapists, buildSlots, manualSlots]);

  const slots = activeTab === 'manual_therapy' ? manualSlots : shockwaveSlots;
  const setSlots = activeTab === 'manual_therapy' ? setManualSlots : setShockwaveSlots;
  const slotIndexes = useMemo(
    () => Object.keys(slots || {}).map(Number).sort((a, b) => a - b),
    [slots]
  );

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDayOverrides(getMonthlyDayOverrides(settings?.day_overrides, year, month));
    setDateOverrides(getDateOverridesForMonth(settings?.date_overrides, year, month));
    setStaffBlockRules(getEffectiveStaffScheduleBlockRules(settings, year, month).rules);
  }, [settings, settings?.day_overrides, settings?.date_overrides, settings?.staff_schedule_block_rules, year, month]);

  const addSlot = useCallback(() => {
    setSlots((prev) => {
      const nextIndex = Object.keys(prev || {}).map(Number).reduce((max, value) => Math.max(max, value), -1) + 1;
      return {
        ...(prev || {}),
        [nextIndex]: [{
          therapist_name: '',
          start_day: 1,
          end_day: lastDay,
        }],
      };
    });
  }, [lastDay, setSlots]);

  const removeSlot = useCallback((slotIndex) => {
    setSlots((prev) => {
      if (!prev) return prev;
      const indexes = Object.keys(prev).map(Number).sort((a, b) => a - b);
      if (indexes.length <= 1) return prev;
      const next = {};
      indexes
        .filter((index) => index !== slotIndex)
        .forEach((oldIndex, nextIndex) => {
          next[nextIndex] = prev[oldIndex];
        });
      return next;
    });
  }, [setSlots]);

  // 기간 분할 추가
  const addRange = useCallback((slotIndex) => {
    setSlots((prev) => {
      if (!prev) return prev;
      const current = [...(prev[slotIndex] || [])];
      const lastRange = current[current.length - 1];
      const newStartDay = lastRange ? Math.min(lastRange.end_day + 1, lastDay) : 1;
      if (newStartDay > lastDay) return prev;

      if (lastRange && lastRange.end_day >= newStartDay) {
        current[current.length - 1] = { ...lastRange, end_day: newStartDay - 1 };
      }

      current.push({
        therapist_name: '',
        start_day: newStartDay,
        end_day: lastDay,
      });

      return { ...prev, [slotIndex]: current };
    });
  }, [lastDay, setSlots]);

  // 기간 삭제
  const removeRange = useCallback((slotIndex, rangeIndex) => {
    setSlots((prev) => {
      if (!prev) return prev;
      const current = [...(prev[slotIndex] || [])];
      if (current.length <= 1) return prev;
      current.splice(rangeIndex, 1);
      if (current.length > 0) {
        current[current.length - 1] = { ...current[current.length - 1], end_day: lastDay };
      }
      return { ...prev, [slotIndex]: current };
    });
  }, [lastDay, setSlots]);

  // 필드 업데이트
  const updateRange = useCallback((slotIndex, rangeIndex, field, value) => {
    setSlots((prev) => {
      if (!prev) return prev;
      const current = [...(prev[slotIndex] || [])];
      const item = { ...current[rangeIndex] };
      item[field] = value;

      if (field === 'start_day') {
        const numVal = Math.max(1, Math.min(lastDay, parseInt(value, 10) || 1));
        item.start_day = numVal;
        if (item.end_day < numVal) item.end_day = numVal;
        if (rangeIndex > 0) {
          current[rangeIndex - 1] = { ...current[rangeIndex - 1], end_day: numVal - 1 };
        }
      }

      if (field === 'end_day') {
        const numVal = Math.max(item.start_day, Math.min(lastDay, parseInt(value, 10) || lastDay));
        item.end_day = numVal;
        if (rangeIndex < current.length - 1) {
          current[rangeIndex + 1] = { ...current[rangeIndex + 1], start_day: numVal + 1 };
        }
      }

      current[rangeIndex] = item;
      return { ...prev, [slotIndex]: current };
    });
  }, [lastDay, setSlots]);

  const updateDayOverride = useCallback((dow, field, value) => {
    setDayOverrides((prev) => {
      const updated = { ...prev };
      updated[dow] = { ...(prev[dow] || {}) };

      if (field === 'no_lunch') {
        if (value) {
          updated[dow].no_lunch = true;
          delete updated[dow].lunch_start;
          delete updated[dow].lunch_end;
        } else {
          delete updated[dow].no_lunch;
        }
      } else if (value === '' || value === undefined) {
        delete updated[dow][field];
      } else {
        updated[dow][field] = value;
      }

      if (Object.keys(updated[dow]).length === 0) delete updated[dow];
      return updated;
    });
  }, []);

  const updateDateOverride = useCallback((dateKey, field, value) => {
    setDateOverrides((prev) => {
      const updated = { ...prev };
      updated[dateKey] = { ...(prev[dateKey] || {}) };

      if (field === 'no_lunch') {
        if (value) {
          updated[dateKey].no_lunch = true;
          delete updated[dateKey].lunch_start;
          delete updated[dateKey].lunch_end;
        } else {
          delete updated[dateKey].no_lunch;
        }
      } else if (value === '' || value === undefined) {
        delete updated[dateKey][field];
      } else {
        updated[dateKey][field] = value;
      }

      if (Object.keys(updated[dateKey]).length === 0) delete updated[dateKey];
      return updated;
    });
  }, []);

  const addDateOverride = useCallback(() => {
    if (!newDateOverride.date) return;
    const monthKey = getMonthKey(year, month);
    if (!newDateOverride.date.startsWith(monthKey)) return;

    const nextOverride = {
      start_time: newDateOverride.start_time || settings?.start_time?.slice(0, 5) || '09:00',
      end_time: newDateOverride.end_time || settings?.end_time?.slice(0, 5) || '18:00',
    };
    if (newDateOverride.no_lunch) {
      nextOverride.no_lunch = true;
    } else {
      nextOverride.lunch_start = newDateOverride.lunch_start || '';
      nextOverride.lunch_end = newDateOverride.lunch_end || '';
    }
    setDateOverrides((prev) => ({
      ...prev,
      [newDateOverride.date]: nextOverride,
    }));
    setNewDateOverride({
      date: '',
      start_time: '',
      end_time: '',
      lunch_start: '',
      lunch_end: '',
      no_lunch: false,
    });
  }, [newDateOverride, settings, year, month]);

  const removeDateOverride = useCallback((dateKey) => {
    setDateOverrides((prev) => {
      const updated = { ...prev };
      delete updated[dateKey];
      return updated;
    });
  }, []);

  // 저장 (현재 탭)
  const handleSave = useCallback(async () => {
    if (!slots) return;
    setSaving(true);
    const configs = [];
    const roster = [];
    Object.entries(slots).sort(([a], [b]) => Number(a) - Number(b)).forEach(([slotStr, ranges]) => {
      const slotIndex = parseInt(slotStr, 10);
      const fallbackName = currentTherapists?.[slotIndex]?.name || '';
      const primaryName = (ranges || []).find((range) => String(range.therapist_name || '').trim())?.therapist_name || fallbackName;
      roster[slotIndex] = { name: String(primaryName || '').trim() };
      (ranges || []).forEach((range) => {
        if (range.start_day <= range.end_day) {
          configs.push({
            slot_index: slotIndex,
            therapist_name: range.therapist_name ?? '',
            start_day: range.start_day,
            end_day: range.end_day,
          });
        }
      });
    });

    const rosterSuccess = onSaveRoster ? await onSaveRoster(activeTab, roster) : true;
    const success = rosterSuccess && await onSave(year, month, configs, activeTab);
    setSaving(false);
    if (success) onClose();
  }, [slots, currentTherapists, onSaveRoster, onSave, onClose, year, month, activeTab]);

  const handleSaveOperatingSettings = useCallback(async () => {
    if (!onSaveSettings || !settings) return;
    setSaving(true);
    const monthKey = getMonthKey(year, month);
    const preservedDateOverrides = Object.fromEntries(
      Object.entries(settings.date_overrides || {}).filter(([dateKey]) => !String(dateKey).startsWith(monthKey))
    );
    const success = await onSaveSettings({
      ...settings,
      day_overrides: setMonthlyDayOverrides(settings.day_overrides || {}, year, month, dayOverrides),
      date_overrides: {
        ...preservedDateOverrides,
        ...dateOverrides,
      },
    });
    setSaving(false);
    if (success) onClose();
  }, [onSaveSettings, settings, year, month, dayOverrides, dateOverrides, onClose]);

  const addStaffBlockRule = useCallback(() => {
    setStaffBlockRules((prev) => ([
      ...(prev || []),
      {
        id: `staff-block-${Date.now()}`,
        keyword: '',
        start_time: '13:00',
        end_time: '18:00',
        bg_color: '#d9ead3',
        enabled: true,
        invert_match: false,
      },
    ]));
  }, []);

  const updateStaffBlockRule = useCallback((index, field, value) => {
    setStaffBlockRules((prev) => (prev || []).map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, [field]: value } : rule
    )));
  }, []);

  const removeStaffBlockRule = useCallback((index) => {
    setStaffBlockRules((prev) => (prev || []).filter((_, ruleIndex) => ruleIndex !== index));
  }, []);

  const handleSaveStaffBlockRules = useCallback(async () => {
    if (!onSaveSettings || !settings) return;
    setSaving(true);
    const success = await onSaveSettings({
      ...settings,
      staff_schedule_block_rules: setMonthlyStaffScheduleBlockRules(settings, year, month, staffBlockRules),
    });
    setSaving(false);
    if (success) onClose();
  }, [onSaveSettings, settings, year, month, staffBlockRules, onClose]);

  // ESC 닫기
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!slots) return null;

  const renderTherapistSettings = () => (
    <>
      <div className="monthly-therapist-tabs">
        <button
          type="button"
          className={`monthly-therapist-tab${activeTab === 'shockwave' ? ' active' : ''}`}
          onClick={() => setActiveTab('shockwave')}
        >
          충격파 치료사
        </button>
        <button
          type="button"
          className={`monthly-therapist-tab${activeTab === 'manual_therapy' ? ' active' : ''}`}
          onClick={() => setActiveTab('manual_therapy')}
        >
          도수 치료사
        </button>
      </div>

      <div className="monthly-therapist-desc">
        스케줄러 열 인원수와 날짜별 담당 치료사를 월별로 관리합니다. 빈 이름은 해당 기간 비활성 처리됩니다.
      </div>

      <div className="monthly-therapist-toolbar">
        <span>현재 {slotIndexes.length}명 구성</span>
        <button type="button" className="monthly-therapist-add-slot" onClick={addSlot}>
          + 치료사 추가
        </button>
      </div>

      <div className="monthly-therapist-body">
        {slotIndexes.map((slotIndex) => (
          <div key={`${activeTab}-${slotIndex}`} className="monthly-therapist-slot">
            <div className="monthly-therapist-slot-header">
              <span className="monthly-therapist-slot-badge">{slotIndex + 1}번</span>
              <span className="monthly-therapist-slot-default">
                기본: {currentTherapists?.[slotIndex]?.name || '(없음)'}
              </span>
              <button
                type="button"
                className="monthly-therapist-add-btn"
                onClick={() => addRange(slotIndex)}
                title="기간 분할 추가"
              >
                + 분할
              </button>
              {slotIndexes.length > 1 && (
                <button
                  type="button"
                  className="monthly-therapist-remove-slot-btn"
                  onClick={() => removeSlot(slotIndex)}
                  title="이 치료사 열 삭제"
                >
                  열 삭제
                </button>
              )}
            </div>

            <div className="monthly-therapist-ranges">
              {(slots[slotIndex] || []).map((range, rangeIndex) => (
                <div key={rangeIndex} className="monthly-therapist-range-row">
                  <input
                    type="number"
                    className="monthly-therapist-day-input"
                    min={1}
                    max={lastDay}
                    value={range.start_day}
                    onChange={(e) => updateRange(slotIndex, rangeIndex, 'start_day', e.target.value)}
                  />
                  <span className="monthly-therapist-range-sep">~</span>
                  <input
                    type="number"
                    className="monthly-therapist-day-input"
                    min={range.start_day}
                    max={lastDay}
                    value={range.end_day}
                    onChange={(e) => updateRange(slotIndex, rangeIndex, 'end_day', e.target.value)}
                  />
                  <span className="monthly-therapist-range-day">일</span>
                  <input
                    type="text"
                    className="monthly-therapist-name-input"
                    placeholder="치료사 이름 (비워두면 비활성)"
                    value={range.therapist_name}
                    onChange={(e) => updateRange(slotIndex, rangeIndex, 'therapist_name', e.target.value)}
                  />
                  {(slots[slotIndex] || []).length > 1 && (
                    <button
                      type="button"
                      className="monthly-therapist-remove-btn"
                      onClick={() => removeRange(slotIndex, rangeIndex)}
                      title="이 기간 삭제"
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  const renderWeeklySettings = () => (
    <>
      <div className="monthly-therapist-desc">
        {year}년 {month}월에만 적용할 요일별 운영시간입니다. 비워둔 항목은 기본 운영시간을 사용합니다.
      </div>
      <div className="monthly-therapist-body monthly-therapist-body--settings">
        <div className="monthly-operating-table-wrap">
          <table className="monthly-operating-table">
            <thead>
              <tr>
                <th>요일</th>
                <th>시작</th>
                <th>종료</th>
                <th>점심 시작</th>
                <th>점심 종료</th>
                <th>점심 없음</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6].map((dow) => {
                const override = dayOverrides[dow] || {};
                const isNoLunch = override.no_lunch === true;
                return (
                  <tr key={dow}>
                    <td className="monthly-operating-day">{DAY_NAMES[dow]}</td>
                    <td>
                      <input
                        type="time"
                        className="monthly-operating-input"
                        value={override.start_time || ''}
                        placeholder={settings?.start_time?.slice(0, 5) || '09:00'}
                        onChange={(e) => updateDayOverride(dow, 'start_time', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        className="monthly-operating-input"
                        value={override.end_time || ''}
                        placeholder={settings?.end_time?.slice(0, 5) || '18:00'}
                        onChange={(e) => updateDayOverride(dow, 'end_time', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        className="monthly-operating-input"
                        value={isNoLunch ? '' : (override.lunch_start || '')}
                        placeholder="12:00"
                        disabled={isNoLunch}
                        onChange={(e) => updateDayOverride(dow, 'lunch_start', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        className="monthly-operating-input"
                        value={isNoLunch ? '' : (override.lunch_end || '')}
                        placeholder="13:00"
                        disabled={isNoLunch}
                        onChange={(e) => updateDayOverride(dow, 'lunch_end', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={isNoLunch}
                        onChange={(e) => updateDayOverride(dow, 'no_lunch', e.target.checked)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderDateSettings = () => {
    const monthKey = getMonthKey(year, month);
    const minDate = `${monthKey}-01`;
    const maxDate = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

    return (
      <>
        <div className="monthly-therapist-desc">
          특정 날짜만 운영시간이 다를 때 추가합니다. 날짜별 설정은 요일별 설정보다 우선 적용됩니다.
        </div>
        <div className="monthly-therapist-body monthly-therapist-body--settings">
          <div className="monthly-date-override-form">
            <input
              type="date"
              className="monthly-operating-input"
              min={minDate}
              max={maxDate}
              value={newDateOverride.date}
              onChange={(e) => setNewDateOverride((prev) => ({ ...prev, date: e.target.value }))}
            />
            <input
              type="time"
              className="monthly-operating-input"
              value={newDateOverride.start_time}
              placeholder={settings?.start_time?.slice(0, 5) || '09:00'}
              onChange={(e) => setNewDateOverride((prev) => ({ ...prev, start_time: e.target.value }))}
            />
            <input
              type="time"
              className="monthly-operating-input"
              value={newDateOverride.end_time}
              placeholder={settings?.end_time?.slice(0, 5) || '18:00'}
              onChange={(e) => setNewDateOverride((prev) => ({ ...prev, end_time: e.target.value }))}
            />
            <input
              type="time"
              className="monthly-operating-input"
              value={newDateOverride.no_lunch ? '' : newDateOverride.lunch_start}
              placeholder="12:00"
              disabled={newDateOverride.no_lunch}
              onChange={(e) => setNewDateOverride((prev) => ({ ...prev, lunch_start: e.target.value }))}
            />
            <input
              type="time"
              className="monthly-operating-input"
              value={newDateOverride.no_lunch ? '' : newDateOverride.lunch_end}
              placeholder="13:00"
              disabled={newDateOverride.no_lunch}
              onChange={(e) => setNewDateOverride((prev) => ({ ...prev, lunch_end: e.target.value }))}
            />
            <label className="monthly-date-no-lunch">
              <input
                type="checkbox"
                checked={newDateOverride.no_lunch}
                onChange={(e) => setNewDateOverride((prev) => ({
                  ...prev,
                  no_lunch: e.target.checked,
                  lunch_start: e.target.checked ? '' : prev.lunch_start,
                  lunch_end: e.target.checked ? '' : prev.lunch_end,
                }))}
              />
              점심 없음
            </label>
            <button type="button" className="monthly-therapist-add-slot" onClick={addDateOverride}>
              추가
            </button>
          </div>

          <div className="monthly-operating-table-wrap">
            <table className="monthly-operating-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>시작</th>
                  <th>종료</th>
                  <th>점심 시작</th>
                  <th>점심 종료</th>
                  <th>점심 없음</th>
                  <th>삭제</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(dateOverrides).length === 0 ? (
                  <tr>
                    <td className="monthly-operating-empty" colSpan={7}>이 달에 따로 지정한 날짜별 운영시간이 없습니다.</td>
                  </tr>
                ) : (
                  Object.entries(dateOverrides).sort((a, b) => a[0].localeCompare(b[0])).map(([dateKey, override]) => {
                    const isNoLunch = override.no_lunch === true;
                    return (
                      <tr key={dateKey}>
                        <td className="monthly-operating-day">{dateKey}</td>
                        <td>
                          <input
                            type="time"
                            className="monthly-operating-input"
                            value={override.start_time || ''}
                            onChange={(e) => updateDateOverride(dateKey, 'start_time', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="time"
                            className="monthly-operating-input"
                            value={override.end_time || ''}
                            onChange={(e) => updateDateOverride(dateKey, 'end_time', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="time"
                            className="monthly-operating-input"
                            value={isNoLunch ? '' : (override.lunch_start || '')}
                            disabled={isNoLunch}
                            onChange={(e) => updateDateOverride(dateKey, 'lunch_start', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="time"
                            className="monthly-operating-input"
                            value={isNoLunch ? '' : (override.lunch_end || '')}
                            disabled={isNoLunch}
                            onChange={(e) => updateDateOverride(dateKey, 'lunch_end', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={isNoLunch}
                            onChange={(e) => updateDateOverride(dateKey, 'no_lunch', e.target.checked)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="monthly-therapist-remove-btn"
                            onClick={() => removeDateOverride(dateKey)}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  const renderStaffBlockSettings = () => {
    const effective = getEffectiveStaffScheduleBlockRules(settings, year, month);
    const sourceText = !effective.source_month_key
      ? '기본 근무표 연동 규칙 사용 중'
      : effective.source_month_key === effective.target_month_key
        ? '이번 달 직접 설정 사용 중'
        : `${effective.source_month_key} 설정을 이어받아 적용 중`;

    return (
      <>
        <div className="monthly-therapist-desc">
          근무표 메모가 “문구/치료사명” 형식과 일치하면 해당 날짜의 스케줄러에서 그 치료사 열의 지정 시간대를 색칠합니다. 공백은 완화되어 “야간 PT”와 “야간PT”를 같은 문구로 인식합니다.
          <br />
          {sourceText}
        </div>
        <div className="monthly-therapist-toolbar monthly-staff-block-toolbar">
          <span>현재 {staffBlockRules.length}개 규칙</span>
          <button type="button" className="monthly-therapist-add-slot" onClick={addStaffBlockRule}>
            + 색칠 규칙 추가
          </button>
        </div>
        <div className="monthly-therapist-body monthly-therapist-body--settings">
          <div className="monthly-operating-table-wrap">
            <table className="monthly-operating-table monthly-staff-block-table">
              <thead>
                <tr>
                  <th>사용</th>
                  <th>근무표 문구</th>
                  <th>시작</th>
                  <th>종료</th>
                  <th>색상</th>
                  <th>미포함</th>
                  <th>삭제</th>
                </tr>
              </thead>
              <tbody>
                {staffBlockRules.length === 0 ? (
                  <tr>
                    <td className="monthly-operating-empty" colSpan={7}>이 달에 설정된 근무표 연동 색칠 규칙이 없습니다.</td>
                  </tr>
                ) : staffBlockRules.map((rule, index) => (
                  <tr key={rule.id || index}>
                    <td>
                      <input
                        type="checkbox"
                        checked={rule.enabled !== false}
                        onChange={(e) => updateStaffBlockRule(index, 'enabled', e.target.checked)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="monthly-operating-input monthly-staff-block-keyword"
                        value={rule.keyword || ''}
                        placeholder="오후 반차"
                        onChange={(e) => updateStaffBlockRule(index, 'keyword', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        className="monthly-operating-input"
                        value={rule.start_time || ''}
                        onChange={(e) => updateStaffBlockRule(index, 'start_time', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="time"
                        className="monthly-operating-input"
                        value={rule.end_time || ''}
                        onChange={(e) => updateStaffBlockRule(index, 'end_time', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="color"
                        className="monthly-staff-block-color"
                        value={rule.bg_color || '#d9ead3'}
                        onChange={(e) => updateStaffBlockRule(index, 'bg_color', e.target.value)}
                      />
                    </td>
                    <td>
                      <label className="monthly-staff-block-invert">
                        <input
                          type="checkbox"
                          checked={rule.invert_match === true}
                          onChange={(e) => updateStaffBlockRule(index, 'invert_match', e.target.checked)}
                        />
                        <span>목록에 없는 치료사</span>
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="monthly-therapist-remove-btn"
                        onClick={() => removeStaffBlockRule(index)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="monthly-therapist-backdrop" onMouseDown={onClose}>
      <div
        className="monthly-therapist-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="monthly-therapist-header">
          <h3 className="monthly-therapist-title">
            {year}년 {month}월 스케줄 설정
          </h3>
          <button type="button" className="monthly-therapist-close" onClick={onClose}>x</button>
        </div>

        <div className="monthly-therapist-section-tabs">
          <button
            type="button"
            className={`monthly-therapist-section-tab${configSection === 'therapists' ? ' active' : ''}`}
            onClick={() => setConfigSection('therapists')}
          >
            치료사 설정
          </button>
          <button
            type="button"
            className={`monthly-therapist-section-tab${configSection === 'weekly' ? ' active' : ''}`}
            onClick={() => setConfigSection('weekly')}
          >
            요일별 운영
          </button>
          <button
            type="button"
            className={`monthly-therapist-section-tab${configSection === 'dates' ? ' active' : ''}`}
            onClick={() => setConfigSection('dates')}
          >
            날짜별 운영
          </button>
          <button
            type="button"
            className={`monthly-therapist-section-tab${configSection === 'staffBlocks' ? ' active' : ''}`}
            onClick={() => setConfigSection('staffBlocks')}
          >
            근무표 연동
          </button>
        </div>

        {configSection === 'therapists' && renderTherapistSettings()}
        {configSection === 'weekly' && renderWeeklySettings()}
        {configSection === 'dates' && renderDateSettings()}
        {configSection === 'staffBlocks' && renderStaffBlockSettings()}

        <div className="monthly-therapist-footer">
          <button type="button" className="monthly-therapist-cancel" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="monthly-therapist-save"
            onClick={
              configSection === 'therapists'
                ? handleSave
                : configSection === 'staffBlocks'
                  ? handleSaveStaffBlockRules
                  : handleSaveOperatingSettings
            }
            disabled={saving}
          >
            {saving
              ? '저장 중...'
              : configSection === 'therapists'
                ? `${activeTab === 'manual_therapy' ? '도수치료' : '충격파'} 저장`
                : configSection === 'staffBlocks'
                  ? '근무표 연동 저장'
                  : '운영시간 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
