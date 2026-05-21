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
import {
  DEFAULT_SCHEDULER_TEXT_SETTINGS,
  getEffectiveSchedulerTextSettings,
  setMonthlySchedulerTextSettings,
} from '../../lib/schedulerTextSettings';
import {
  DEFAULT_STAFF_DISPLAY_RULES,
  getEffectiveStaffDisplayRules,
  setMonthlyStaffDisplayRules,
  matchDisplayRule,
  parseDeptNameMemo,
} from '../../lib/staffDisplayRules';

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
  const [configSection, setConfigSection] = useState('therapists'); // therapists | weekly | dates | staffBlocks | textStyle
  const [activeTab, setActiveTab] = useState('shockwave'); // 'shockwave' | 'manual_therapy'

  const currentTherapists = activeTab === 'manual_therapy' ? manualTherapists : therapists;
  const lastDay = new Date(year, month, 0).getDate();

  // 탭별 로컬 편집 상태
  const [shockwaveSlots, setShockwaveSlots] = useState(null);
  const [manualSlots, setManualSlots] = useState(null);
  const [dayOverrides, setDayOverrides] = useState({});
  const [dateOverrides, setDateOverrides] = useState({});
  const [staffBlockRules, setStaffBlockRules] = useState([]);
  const [staffDisplayRules, setStaffDisplayRules] = useState([]);
  const [displayPreviewText, setDisplayPreviewText] = useState('간호/강수아');
  const [staffBlockSubTab, setStaffBlockSubTab] = useState('blocks');
  const [schedulerTextSettings, setSchedulerTextSettings] = useState(DEFAULT_SCHEDULER_TEXT_SETTINGS);
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
    setStaffDisplayRules(getEffectiveStaffDisplayRules(settings, year, month).rules);
    setSchedulerTextSettings(getEffectiveSchedulerTextSettings(settings, year, month));
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
        font_color: '#0f172a',
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

  const addStaffDisplayRule = useCallback(() => {
    setStaffDisplayRules((prev) => ([
      ...(prev || []),
      {
        id: `display-rule-${Date.now()}`,
        keyword: '',
        position: 'suffix',
        today_suffix: '',
        calendar_font_color: '',
        calendar_bg_color: '',
        enabled: true,
        priority: 50,
      },
    ]));
  }, []);

  const updateStaffDisplayRule = useCallback((index, field, value) => {
    setStaffDisplayRules((prev) => (prev || []).map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, [field]: value } : rule
    )));
  }, []);

  const removeStaffDisplayRule = useCallback((index) => {
    setStaffDisplayRules((prev) => (prev || []).filter((_, ruleIndex) => ruleIndex !== index));
  }, []);

  const handleSaveStaffBlockRules = useCallback(async () => {
    if (!onSaveSettings || !settings) return;
    setSaving(true);
    const success = await onSaveSettings({
      ...settings,
      staff_schedule_block_rules: setMonthlyStaffScheduleBlockRules(settings, year, month, staffBlockRules),
      staff_display_rules: setMonthlyStaffDisplayRules(settings, year, month, staffDisplayRules),
    });
    setSaving(false);
    if (success) onClose();
  }, [onSaveSettings, settings, year, month, staffBlockRules, staffDisplayRules, onClose]);

  const handleSaveTextSettings = useCallback(async () => {
    if (!onSaveSettings || !settings) return;
    setSaving(true);
    const success = await onSaveSettings({
      ...settings,
      monthly_settlement_settings: setMonthlySchedulerTextSettings(settings, year, month, schedulerTextSettings),
    });
    setSaving(false);
    if (success) onClose();
  }, [onSaveSettings, settings, year, month, schedulerTextSettings, onClose]);

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
    const effectiveBlocks = getEffectiveStaffScheduleBlockRules(settings, year, month);
    const effectiveDisplay = getEffectiveStaffDisplayRules(settings, year, month);

    let matchResult = null;
    let previewFormatted = displayPreviewText;
    let previewStyle = {};

    if (staffBlockSubTab === 'display') {
      const p = parseDeptNameMemo(displayPreviewText);
      if (p) {
        matchResult = matchDisplayRule(displayPreviewText, staffDisplayRules);
        const suffix = matchResult?.rule?.today_suffix || '';
        previewFormatted = suffix ? `${p.dept}/${p.name} ${suffix}` : `${p.dept}/${p.name}`;
        if (matchResult?.rule?.calendar_font_color) previewStyle.color = matchResult.rule.calendar_font_color;
        if (matchResult?.rule?.calendar_bg_color) previewStyle.backgroundColor = matchResult.rule.calendar_bg_color;
      }
    }

    return (
      <>
        <div className="monthly-therapist-desc">
          근무표 메모 연동 기능을 설정합니다. 달력 셀 색칠 규칙과 부서/이름 표시 규칙을 월별로 관리할 수 있습니다.
        </div>

        <div className="monthly-staff-block-sub-tabs">
          <button
            type="button"
            className={`monthly-staff-block-sub-tab${staffBlockSubTab === 'blocks' ? ' active' : ''}`}
            onClick={() => setStaffBlockSubTab('blocks')}
          >
            스케줄러 색칠 규칙
          </button>
          <button
            type="button"
            className={`monthly-staff-block-sub-tab${staffBlockSubTab === 'display' ? ' active' : ''}`}
            onClick={() => setStaffBlockSubTab('display')}
          >
            부서/이름 표시 규칙
          </button>
        </div>

        {staffBlockSubTab === 'blocks' ? (
          <div className="monthly-therapist-body monthly-therapist-body--settings">
            <div className="monthly-staff-block-source">
              {!effectiveBlocks.source_month_key
                ? '기본 근무표 연동 색칠 규칙 사용 중'
                : effectiveBlocks.source_month_key === effectiveBlocks.target_month_key
                  ? '이번 달 직접 설정 사용 중'
                  : `${effectiveBlocks.source_month_key} 색칠 설정을 이어받아 적용 중`}
            </div>
            <div className="monthly-therapist-toolbar monthly-staff-block-toolbar">
              <span>현재 {staffBlockRules.length}개 규칙</span>
              <button type="button" className="monthly-therapist-add-slot" onClick={addStaffBlockRule}>
                + 색칠 규칙 추가
              </button>
            </div>
            <div className="monthly-operating-table-wrap">
              <table className="monthly-operating-table monthly-staff-block-table">
                <thead>
                  <tr>
                    <th>사용</th>
                    <th>근무표 문구</th>
                    <th>시작</th>
                    <th>종료</th>
                    <th>배경색</th>
                    <th>글자색</th>
                    <th>미포함</th>
                    <th>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {staffBlockRules.length === 0 ? (
                    <tr>
                      <td className="monthly-operating-empty" colSpan={8}>이 달에 설정된 근무표 연동 색칠 규칙이 없습니다.</td>
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
                        <input
                          type="color"
                          className="monthly-staff-block-color"
                          value={rule.font_color || '#0f172a'}
                          onChange={(e) => updateStaffBlockRule(index, 'font_color', e.target.value)}
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
        ) : (
          <div className="monthly-therapist-body monthly-therapist-body--settings">
            <div className="monthly-staff-block-source">
              {!effectiveDisplay.source_month_key
                ? '기본 표시 규칙 사용 중'
                : effectiveDisplay.source_month_key === effectiveDisplay.target_month_key
                  ? '이번 달 직접 설정 사용 중'
                  : `${effectiveDisplay.source_month_key} 표시 설정을 이어받아 적용 중`}
            </div>

            <div className="monthly-display-preview-panel">
              <div className="monthly-display-preview-header">
                <strong>실시간 미리보기</strong>
                <span className="monthly-display-preview-desc">메모를 입력하여 규칙이 어떻게 적용되는지 확인하세요.</span>
              </div>
              <div className="monthly-display-preview-content">
                <input
                  type="text"
                  className="monthly-operating-input monthly-display-preview-input"
                  value={displayPreviewText}
                  onChange={(e) => setDisplayPreviewText(e.target.value)}
                  placeholder="예: 야간 간호/강수아"
                />
                <div className="monthly-display-preview-arrow">➔</div>
                <div className="monthly-display-preview-result">
                  <div className="monthly-display-preview-label-row">
                    <span className="monthly-display-preview-label">📅 달력 셀</span>
                  </div>
                  <div className="monthly-display-preview-cell" style={previewStyle}>
                    {displayPreviewText || '(비어있음)'}
                  </div>
                  <div className="monthly-display-preview-label-row" style={{ marginTop: '8px' }}>
                    <span className="monthly-display-preview-label">📋 오늘 일정 패널</span>
                  </div>
                  <div className="monthly-display-preview-today-item" style={{ color: previewStyle.color || 'inherit' }}>
                    <span
                      className="monthly-display-preview-today-dot"
                      style={{
                        background: previewStyle.color === '#3c78d8' ? 'var(--memo-night, #3c78d8)'
                          : previewStyle.color === '#9900ff' ? 'var(--memo-off, #9900ff)'
                          : previewStyle.color === '#40a417' ? 'var(--memo-leave, #40a417)'
                          : previewStyle.color === '#ff6d01' ? 'var(--memo-attend, #ff6d01)'
                          : previewStyle.color === '#ff0000' ? 'var(--memo-special, #ff0000)'
                          : previewStyle.color || 'var(--text-tertiary, #94a3b8)',
                      }}
                    />
                    {previewFormatted || displayPreviewText || '(비어있음)'}
                  </div>
                </div>
              </div>
              <div className="monthly-display-preview-footer">
                매칭된 규칙: {matchResult ? <strong>{matchResult.rule.keyword || '(기본값 – 순수 부서/이름)'}</strong> : <span className="no-match">없음 (부서/이름 패턴이 아니거나 매칭 규칙 없음)</span>}
              </div>
            </div>

            <div className="monthly-therapist-toolbar monthly-staff-block-toolbar">
              <span>현재 {staffDisplayRules.length}개 표시 규칙</span>
              <div>
                <button
                  type="button"
                  className="monthly-therapist-add-slot monthly-therapist-restore-btn"
                  onClick={() => {
                    if (confirm('기본 표시 규칙으로 덮어쓰시겠습니까? 기존 설정은 사라집니다.')) {
                      setStaffDisplayRules(DEFAULT_STAFF_DISPLAY_RULES.map(r => ({ ...r, id: `display-rule-${Date.now()}-${Math.random()}` })));
                    }
                  }}
                  style={{ marginRight: '8px' }}
                >
                  기본 규칙 복원
                </button>
                <button type="button" className="monthly-therapist-add-slot" onClick={addStaffDisplayRule}>
                  + 표시 규칙 추가
                </button>
              </div>
            </div>
            <div className="monthly-display-rules-grid">
              {staffDisplayRules.length === 0 ? (
                <div className="monthly-operating-empty" style={{ gridColumn: '1 / -1' }}>이 달에 설정된 표시 규칙이 없습니다.</div>
              ) : staffDisplayRules.sort((a, b) => b.priority - a.priority).map((rule) => {
                const originalIndex = staffDisplayRules.indexOf(rule);
                const exText = rule.position === 'prefix' ? `${rule.keyword || '야간'} 간호/홍길동`
                             : rule.position === 'suffix' ? `간호/홍길동 ${rule.keyword || '연차'}`
                             : '간호/홍길동';

                return (
                  <div key={rule.id || originalIndex} className={`display-rule-card ${rule.enabled === false ? 'disabled' : ''}`}>
                    <div className="display-rule-card-header">
                      <label className="display-rule-toggle">
                        <input
                          type="checkbox"
                          checked={rule.enabled !== false}
                          onChange={(e) => updateStaffDisplayRule(originalIndex, 'enabled', e.target.checked)}
                        />
                        <span className="display-rule-toggle-text">사용</span>
                      </label>
                      <button
                        type="button"
                        className="monthly-therapist-remove-btn"
                        onClick={() => removeStaffDisplayRule(originalIndex)}
                      >
                        삭제
                      </button>
                    </div>

                    <div className="display-rule-condition">
                      <div className="display-rule-label">조건</div>
                      <div className="display-rule-condition-inputs">
                        <select
                          className="monthly-operating-input"
                          value={rule.position}
                          onChange={(e) => updateStaffDisplayRule(originalIndex, 'position', e.target.value)}
                        >
                          <option value="prefix">키워드가 앞에 올 때</option>
                          <option value="suffix">키워드가 뒤에 올 때</option>
                          <option value="standalone">키워드 없이 단독일 때</option>
                        </select>
                        {rule.position !== 'standalone' && (
                          <input
                            type="text"
                            className="monthly-operating-input"
                            value={rule.keyword || ''}
                            placeholder="키워드 입력"
                            onChange={(e) => updateStaffDisplayRule(originalIndex, 'keyword', e.target.value)}
                          />
                        )}
                      </div>
                    </div>

                    <div className="display-rule-actions">
                      <div className="display-rule-label">결과 지정</div>
                      
                      <div className="display-rule-action-row">
                        <span className="display-rule-action-title">📅 달력</span>
                        <div className="display-rule-colors">
                          <label className="display-rule-color-item" title="글자색">
                            <span>글자</span>
                            <input
                              type="color"
                              className="monthly-staff-block-color"
                              value={rule.calendar_font_color || '#000000'}
                              onChange={(e) => updateStaffDisplayRule(originalIndex, 'calendar_font_color', e.target.value)}
                            />
                            <button
                              type="button"
                              className="display-rule-color-clear"
                              onClick={() => updateStaffDisplayRule(originalIndex, 'calendar_font_color', '')}
                              title="기본값 사용"
                            >
                              ↺
                            </button>
                          </label>
                          <label className="display-rule-color-item" title="배경색">
                            <span>배경</span>
                            <input
                              type="color"
                              className="monthly-staff-block-color"
                              value={rule.calendar_bg_color || '#ffffff'}
                              onChange={(e) => updateStaffDisplayRule(originalIndex, 'calendar_bg_color', e.target.value)}
                            />
                            <button
                              type="button"
                              className="display-rule-color-clear"
                              onClick={() => updateStaffDisplayRule(originalIndex, 'calendar_bg_color', '')}
                              title="빈 배경 사용"
                            >
                              ↺
                            </button>
                          </label>
                        </div>
                      </div>

                      <div className="display-rule-action-row">
                        <span className="display-rule-action-title">📋 오늘 일정</span>
                        <div className="display-rule-today-input">
                          <span className="display-rule-today-prefix">부서/이름 +</span>
                          <input
                            type="text"
                            className="monthly-operating-input"
                            value={rule.today_suffix || ''}
                            placeholder="꼬리말 (예: 휴무)"
                            onChange={(e) => updateStaffDisplayRule(originalIndex, 'today_suffix', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="display-rule-card-preview">
                      <div className="display-rule-preview-cell" style={{
                        color: rule.calendar_font_color || 'inherit',
                        backgroundColor: rule.calendar_bg_color || 'transparent'
                      }}>
                        {exText}
                      </div>
                      <div className="display-rule-preview-today" style={{ color: rule.calendar_font_color || 'inherit' }}>
                        <span
                          className="display-rule-preview-dot"
                          style={{
                            background: rule.calendar_font_color === '#3c78d8' ? 'var(--memo-night, #3c78d8)'
                              : rule.calendar_font_color === '#9900ff' ? 'var(--memo-off, #9900ff)'
                              : rule.calendar_font_color === '#40a417' ? 'var(--memo-leave, #40a417)'
                              : rule.calendar_font_color === '#ff6d01' ? 'var(--memo-attend, #ff6d01)'
                              : rule.calendar_font_color === '#ff0000' ? 'var(--memo-special, #ff0000)'
                              : rule.calendar_font_color || 'var(--text-tertiary, #94a3b8)'
                          }}
                        />
                        간호/홍길동 {rule.today_suffix || ''}
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  };

  const renderTextStyleSettings = () => {
    const effective = getEffectiveSchedulerTextSettings(settings, year, month);
    const sourceText = !effective.source_month_key
      ? '기본 글자 설정 사용 중'
      : effective.source_month_key === effective.target_month_key
        ? '이번 달 직접 설정 사용 중'
        : `${effective.source_month_key} 설정을 이어받아 적용 중`;

    return (
      <>
        <div className="monthly-therapist-desc">
          스케줄 영역의 각 헤더 및 셀의 글자 크기, 두께, 높이를 자유롭게 설정합니다. 너비는 스케줄 표 화면에서 마우스 드래그로 조정 가능합니다.
          <br />
          {sourceText}
        </div>
        <div className="monthly-therapist-body monthly-therapist-body--settings">
          <div className="monthly-text-style-card">
            <div className="monthly-text-style-grid">
              {/* 1. 스케줄 셀 설정 */}
              <label className="monthly-text-style-field">
                <span>스케줄 셀 글자 크기</span>
                <div className="monthly-text-style-size-row">
                  <input
                    type="range"
                    min={9}
                    max={18}
                    step={1}
                    value={schedulerTextSettings.font_size}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      font_size: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.font_size,
                    }))}
                  />
                  <input
                    type="number"
                    className="monthly-operating-input monthly-text-style-number"
                    min={9}
                    max={18}
                    step={1}
                    value={schedulerTextSettings.font_size}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      font_size: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.font_size,
                    }))}
                  />
                  <span className="monthly-text-style-unit">px</span>
                </div>
              </label>

              <label className="monthly-text-style-field">
                <span>스케줄 셀 글자 두께</span>
                <select
                  className="monthly-operating-input monthly-text-style-select"
                  value={schedulerTextSettings.font_weight}
                  onChange={(e) => setSchedulerTextSettings((prev) => ({
                    ...prev,
                    font_weight: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.font_weight,
                  }))}
                >
                  <option value={500}>보통 (500)</option>
                  <option value={600}>조금 굵게 (600)</option>
                  <option value={700}>굵게 (700)</option>
                  <option value={800}>매우 굵게 (800)</option>
                  <option value={900}>최대 굵기 (900)</option>
                </select>
              </label>

              {/* 2. 날짜 헤더 설정 */}
              <label className="monthly-text-style-field">
                <span>날짜 헤더 글자 크기</span>
                <div className="monthly-text-style-size-row">
                  <input
                    type="range"
                    min={11}
                    max={24}
                    step={1}
                    value={schedulerTextSettings.header_font_size ?? 16}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      header_font_size: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_size,
                    }))}
                  />
                  <input
                    type="number"
                    className="monthly-operating-input monthly-text-style-number"
                    min={11}
                    max={24}
                    step={1}
                    value={schedulerTextSettings.header_font_size ?? 16}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      header_font_size: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_size,
                    }))}
                  />
                  <span className="monthly-text-style-unit">px</span>
                </div>
              </label>

              <label className="monthly-text-style-field">
                <span>날짜 헤더 글자 두께</span>
                <select
                  className="monthly-operating-input monthly-text-style-select"
                  value={schedulerTextSettings.header_font_weight ?? 700}
                  onChange={(e) => setSchedulerTextSettings((prev) => ({
                    ...prev,
                    header_font_weight: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.header_font_weight,
                  }))}
                >
                  <option value={500}>보통 (500)</option>
                  <option value={600}>조금 굵게 (600)</option>
                  <option value={700}>굵게 (700)</option>
                  <option value={800}>매우 굵게 (800)</option>
                  <option value={900}>최대 굵기 (900)</option>
                </select>
              </label>

              <label className="monthly-text-style-field" style={{ gridColumn: '1 / -1' }}>
                <span>날짜 헤더 셀 높이 (헤더 높이)</span>
                <div className="monthly-text-style-size-row">
                  <input
                    type="range"
                    min={15}
                    max={80}
                    step={1}
                    value={schedulerTextSettings.header_height ?? 32}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      header_height: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.header_height,
                    }))}
                  />
                  <input
                    type="number"
                    className="monthly-operating-input monthly-text-style-number"
                    min={15}
                    max={80}
                    step={1}
                    value={schedulerTextSettings.header_height ?? 32}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      header_height: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.header_height,
                    }))}
                  />
                  <span className="monthly-text-style-unit">px</span>
                </div>
              </label>

              {/* 3. 치료사 헤더 설정 */}
              <label className="monthly-text-style-field">
                <span>치료사 헤더 글자 크기</span>
                <div className="monthly-text-style-size-row">
                  <input
                    type="range"
                    min={10}
                    max={20}
                    step={1}
                    value={schedulerTextSettings.therapist_font_size ?? 14}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      therapist_font_size: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_size,
                    }))}
                  />
                  <input
                    type="number"
                    className="monthly-operating-input monthly-text-style-number"
                    min={10}
                    max={20}
                    step={1}
                    value={schedulerTextSettings.therapist_font_size ?? 14}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      therapist_font_size: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_size,
                    }))}
                  />
                  <span className="monthly-text-style-unit">px</span>
                </div>
              </label>

              <label className="monthly-text-style-field">
                <span>치료사 헤더 글자 두께</span>
                <select
                  className="monthly-operating-input monthly-text-style-select"
                  value={schedulerTextSettings.therapist_font_weight ?? 700}
                  onChange={(e) => setSchedulerTextSettings((prev) => ({
                    ...prev,
                    therapist_font_weight: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_font_weight,
                  }))}
                >
                  <option value={500}>보통 (500)</option>
                  <option value={600}>조금 굵게 (600)</option>
                  <option value={700}>굵게 (700)</option>
                  <option value={800}>매우 굵게 (800)</option>
                  <option value={900}>최대 굵기 (900)</option>
                </select>
              </label>

              <label className="monthly-text-style-field" style={{ gridColumn: '1 / -1' }}>
                <span>치료사 헤더 셀 높이 (헤더 높이)</span>
                <div className="monthly-text-style-size-row">
                  <input
                    type="range"
                    min={15}
                    max={80}
                    step={1}
                    value={schedulerTextSettings.therapist_height ?? 29}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      therapist_height: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_height,
                    }))}
                  />
                  <input
                    type="number"
                    className="monthly-operating-input monthly-text-style-number"
                    min={15}
                    max={80}
                    step={1}
                    value={schedulerTextSettings.therapist_height ?? 29}
                    onChange={(e) => setSchedulerTextSettings((prev) => ({
                      ...prev,
                      therapist_height: Number(e.target.value) || DEFAULT_SCHEDULER_TEXT_SETTINGS.therapist_height,
                    }))}
                  />
                  <span className="monthly-text-style-unit">px</span>
                </div>
              </label>
            </div>

            <div className="monthly-text-style-preview-wrap">
              <div className="monthly-text-style-preview-label">미리보기</div>
              <div className="monthly-text-style-preview-board">
                <div className="monthly-text-style-preview-row">
                  <div className="monthly-text-style-preview-title">날짜 헤더 미리보기</div>
                  <div
                    className="monthly-text-style-preview-cell"
                    style={{
                      fontSize: `${schedulerTextSettings.header_font_size ?? 16}px`,
                      fontWeight: schedulerTextSettings.header_font_weight ?? 700,
                      height: `${schedulerTextSettings.header_height ?? 32}px`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      padding: '4px 12px',
                      color: '#0f172a',
                    }}
                  >
                    {month}월 21일 목요일
                  </div>
                </div>

                <div className="monthly-text-style-preview-row">
                  <div className="monthly-text-style-preview-title">치료사 헤더 미리보기</div>
                  <div
                    className="monthly-text-style-preview-cell"
                    style={{
                      fontSize: `${schedulerTextSettings.therapist_font_size ?? 14}px`,
                      fontWeight: schedulerTextSettings.therapist_font_weight ?? 700,
                      height: `${schedulerTextSettings.therapist_height ?? 29}px`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      padding: '4px 12px',
                      color: '#0f172a',
                    }}
                  >
                    치료사1
                  </div>
                </div>

                <div className="monthly-text-style-preview-row">
                  <div className="monthly-text-style-preview-title">스케줄 셀 미리보기</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <div
                      className="monthly-text-style-preview-cell"
                      style={{
                        fontSize: `${schedulerTextSettings.font_size}px`,
                        fontWeight: schedulerTextSettings.font_weight,
                      }}
                    >
                      10887/이선영(3)
                    </div>
                    <div
                      className="monthly-text-style-preview-cell monthly-text-style-preview-cell--prescription"
                      style={{
                        fontSize: `${schedulerTextSettings.font_size}px`,
                        fontWeight: schedulerTextSettings.font_weight,
                        color: '#d97706',
                        borderColor: '#f59e0b',
                      }}
                    >
                      14175/김미정(2)
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
          <button
            type="button"
            className={`monthly-therapist-section-tab${configSection === 'textStyle' ? ' active' : ''}`}
            onClick={() => setConfigSection('textStyle')}
          >
            글자크기 설정
          </button>
        </div>

        {configSection === 'therapists' && renderTherapistSettings()}
        {configSection === 'weekly' && renderWeeklySettings()}
        {configSection === 'dates' && renderDateSettings()}
        {configSection === 'staffBlocks' && renderStaffBlockSettings()}
        {configSection === 'textStyle' && renderTextStyleSettings()}

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
                  : configSection === 'textStyle'
                    ? handleSaveTextSettings
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
                  : configSection === 'textStyle'
                    ? '글자 설정 저장'
                  : '운영시간 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
