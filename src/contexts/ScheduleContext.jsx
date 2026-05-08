import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { generateShockwaveCalendar, getTodayKST, buildCrossMonthMirroredPayloads } from '../lib/calendarUtils';
import { syncTodayShockwaveScheduleToStats } from '../lib/shockwaveSyncUtils';
import { syncTodayManualTherapyScheduleToStats } from '../lib/manualTherapyUtils';

const ScheduleContext = createContext();

export function ScheduleProvider({ children }) {
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [staffMemos, setStaffMemos] = useState({});
  const [holidays, setHolidays] = useState(new Set());
  const [holidayNames, setHolidayNames] = useState(new Map());
  const [therapists, setTherapists] = useState([]);
  const [manualTherapists, setManualTherapists] = useState([]);
  const [shockwaveSettings, setShockwaveSettings] = useState({
    id: '00000000-0000-0000-0000-000000000000',
    start_time: '09:00:00',
    end_time: '18:00:00',
    interval_minutes: 10,
    day_overrides: {},
    date_overrides: {},
    prescriptions: ['F1.5', 'F/Rdc', 'F/R'],
    manual_therapy_prescriptions: ['40분', '60분'],
    prescription_prices: {
      'F1.5': 50000,
      'F/Rdc': 70000,
      'F/R': 80000,
    },
    prescription_colors: {},
    incentive_percentage: 7,
    manual_therapy_incentive_percentage: 0,
    frozen_columns: 6,
    staff_schedule_block_rules: {},
    monthly_settlement_settings: {}
  });
  const [shockwaveMemos, setShockwaveMemos] = useState({});
  const [monthlyTherapists, setMonthlyTherapists] = useState([]);
  const [monthlyManualTherapists, setMonthlyManualTherapists] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [calendarSlotSettings, setCalendarSlotSettings] = useState(null);
  const shockwaveWriteQueueRef = useRef(new Map());
  const loadCacheRef = useRef({ staffMemos: null, shockwaveMemos: null, holidays: null });
  const staffMemosRef = useRef(staffMemos);
  const staffMemoSaveRequestRef = useRef(new Map());
  const staffMemosLoadRequestRef = useRef(0);
  const shockwaveMemosRef = useRef(shockwaveMemos);
  const currentDateRef = useRef({ year: currentYear, month: currentMonth });
  const shockwaveMemosLoadRequestRef = useRef(0);
  const monthlyTherapistLoadRequestRef = useRef({ shockwave: 0, manual_therapy: 0 });

  useEffect(() => {
    staffMemosRef.current = staffMemos;
  }, [staffMemos]);

  useEffect(() => {
    shockwaveMemosRef.current = shockwaveMemos;
  }, [shockwaveMemos]);

  useEffect(() => {
    currentDateRef.current = { year: currentYear, month: currentMonth };
  }, [currentYear, currentMonth]);

  const isCurrentScheduleMonth = useCallback((year, month) => (
    currentDateRef.current.year === year && currentDateRef.current.month === month
  ), []);

  const enqueueShockwaveWrite = useCallback((keys, task) => {
    const targetKeys = Array.from(new Set((keys || []).filter(Boolean)));
    const previousWrites = targetKeys
      .map((key) => shockwaveWriteQueueRef.current.get(key))
      .filter(Boolean);
    const queuedWrite = Promise
      .allSettled(previousWrites)
      .then(task);
    const trackedWrite = queuedWrite.finally(() => {
      targetKeys.forEach((key) => {
        if (shockwaveWriteQueueRef.current.get(key) === trackedWrite) {
          shockwaveWriteQueueRef.current.delete(key);
        }
      });
    });
    targetKeys.forEach((key) => shockwaveWriteQueueRef.current.set(key, trackedWrite));
    return queuedWrite;
  }, []);

  const waitForShockwaveWrites = useCallback(async () => {
    const pendingWrites = Array.from(shockwaveWriteQueueRef.current.values());
    if (pendingWrites.length === 0) return;
    await Promise.allSettled(pendingWrites);
  }, []);

  const shouldKeepShockwaveMemo = useCallback((memo) => {
    if (!memo) return false;
    const hasContent = Boolean((memo.content || '').trim());
    const hasBodyPart = Boolean((memo.body_part || '').trim());
    const hasBgColor = memo.bg_color !== undefined && memo.bg_color !== null && memo.bg_color !== '';
    const merge = memo.merge_span;
    const hasMetaMemoList = Array.isArray(merge?.meta?.memo_list) && merge.meta.memo_list.some((item) => String(item || '').trim());
    const hasBodyPartOptions = Array.isArray(merge?.meta?.body_part_options) && merge.meta.body_part_options.some((item) => String(item || '').trim());
    const hasMerge =
      Boolean(merge) &&
      (
        (merge.rowSpan && merge.rowSpan !== 1) ||
        (merge.colSpan && merge.colSpan !== 1) ||
        merge.mergedInto
      );
    return hasContent || hasBodyPart || hasBgColor || hasMerge || hasMetaMemoList || hasBodyPartOptions;
  }, []);

  const protectExistingScheduleContent = useCallback(async (items, localSnapshot = {}) => {
    const list = Array.isArray(items) ? items : [];
    const blankContentItems = list.filter((item) => (
      item &&
      Object.prototype.hasOwnProperty.call(item, 'content') &&
      !String(item.content || '').trim()
    ));

    const needsProtection = blankContentItems.filter((item) => {
      const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      return !String(localSnapshot[key]?.content || '').trim();
    });

    if (needsProtection.length === 0) return list;

    const monthKeys = Array.from(new Set(
      needsProtection.map((item) => `${item.year}-${item.month}`)
    ));
    const existingByCell = new Map();

    for (const monthKey of monthKeys) {
      const [year, month] = monthKey.split('-').map(Number);
      if (!Number.isFinite(year) || !Number.isFinite(month)) continue;

      const pageSize = 1000;
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from('shockwave_schedules')
          .select('year,month,week_index,day_index,row_index,col_index,content')
          .eq('year', year)
          .eq('month', month)
          .order('week_index', { ascending: true })
          .order('day_index', { ascending: true })
          .order('row_index', { ascending: true })
          .order('col_index', { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;

        (data || []).forEach((row) => {
          const key = `${row.year}-${row.month}-${row.week_index}-${row.day_index}-${row.row_index}-${row.col_index}`;
          existingByCell.set(key, row);
        });

        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
    }

    return list.map((item) => {
      if (!item || !Object.prototype.hasOwnProperty.call(item, 'content')) return item;
      if (String(item.content || '').trim()) return item;

      const localKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      if (String(localSnapshot[localKey]?.content || '').trim()) return item;

      const dbKey = `${item.year}-${item.month}-${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      const existing = existingByCell.get(dbKey);
      if (!String(existing?.content || '').trim()) return item;

      return {
        ...item,
        content: existing.content,
      };
    });
  }, []);

  const navigateMonth = useCallback((delta) => {
    loadCacheRef.current = { staffMemos: null, shockwaveMemos: null, holidays: null };
    setCurrentMonth(prev => {
      let newMonth = prev + delta;
      let newYear = currentYear;
      if (newMonth < 1) { newMonth = 12; newYear--; }
      if (newMonth > 12) { newMonth = 1; newYear++; }
      setCurrentYear(newYear);
      return newMonth;
    });
  }, [currentYear]);

  const goToMonth = useCallback((year, month) => {
    loadCacheRef.current = { staffMemos: null, shockwaveMemos: null, holidays: null };
    setCurrentYear(year);
    setCurrentMonth(month);
  }, []);

  // 직원 메모 로드 (캐시 키로 중복 방지)
  const loadStaffMemos = useCallback(async (year, month, options = {}) => {
    const cacheKey = `${year}-${month}-${options.includeAdjacentMonths ? 'adj' : 'single'}`;
    if (loadCacheRef.current.staffMemos === cacheKey) return staffMemosRef.current;
    loadCacheRef.current.staffMemos = cacheKey;
    const requestId = ++staffMemosLoadRequestRef.current;

    setLoading(true);
    try {
      const targetMonths = [{ year, month }];
      if (options.includeAdjacentMonths) {
        const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
        const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
        targetMonths.unshift(prev);
        targetMonths.push(next);
      }

      const memoMap = {};

      await Promise.all(targetMonths.map(async (target) => {
        let page = 0;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase
            .from('staff_schedules')
            .select('*')
            .eq('year', target.year)
            .eq('month', target.month)
            .range(page * 1000, (page + 1) * 1000 - 1);
            
          if (error) throw error;
          
          (data || []).forEach(item => {
            const key = `${item.year}-${item.month}-${item.day}-${item.slot_index}`;
            memoMap[key] = item;
          });
          
          if (!data || data.length < 1000) hasMore = false;
          page++;
        }
      }));

      if (loadCacheRef.current.staffMemos !== cacheKey || staffMemosLoadRequestRef.current !== requestId) return memoMap;
      setStaffMemos(memoMap);
      return memoMap;
    } catch (err) {
      console.error('Failed to load staff memos:', err);
      if (staffMemosLoadRequestRef.current === requestId) {
        loadCacheRef.current.staffMemos = null;
      }
      return null;
    } finally {
      if (staffMemosLoadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  // 직원 메모 저장/업데이트
  const saveStaffMemo = useCallback(async (year, month, day, slotIndex, content, fontColor = null, bgColor = null) => {
    const key = `${year}-${month}-${day}-${slotIndex}`;
    const requestId = (staffMemoSaveRequestRef.current.get(key) || 0) + 1;
    staffMemoSaveRequestRef.current.set(key, requestId);
    const previousMemo = staffMemosRef.current[key];
    try {
      const upsertData = {
        year, month, day,
        slot_index: slotIndex,
        content: content || '',
        updated_at: new Date().toISOString()
      };
      if (fontColor !== undefined) upsertData.font_color = fontColor;
      if (bgColor !== undefined) upsertData.bg_color = bgColor;
      
      // 낙관적 업데이트 (네트워크 응답 대기 중 화면 깜빡임 방지)
      setStaffMemos(prev => ({
        ...prev,
        [key]: { ...prev[key], ...upsertData, slot_index: slotIndex }
      }));

      const { data, error } = await supabase
        .from('staff_schedules')
        .upsert(upsertData, {
          onConflict: 'year,month,day,slot_index'
        })
        .select();

      if (error) {
        // 실패 시 원래 상태로 롤백 로직이 필요할 수 있으나, 현재는 에러만 던짐
        throw error;
      }

      // 서버 데이터로 최종 업데이트
      if (staffMemoSaveRequestRef.current.get(key) !== requestId) return true;
      setStaffMemos(prev => ({
        ...prev,
        [key]: data?.[0] || { ...prev[key], ...upsertData, slot_index: slotIndex }
      }));
      return true;
    } catch (err) {
      if (staffMemoSaveRequestRef.current.get(key) === requestId) {
        setStaffMemos(prev => {
          const next = { ...prev };
          if (previousMemo === undefined) delete next[key];
          else next[key] = previousMemo;
          return next;
        });
      }
      console.error('Failed to save staff memo:', err);
      return false;
    } finally {
      if (staffMemoSaveRequestRef.current.get(key) === requestId) {
        staffMemoSaveRequestRef.current.delete(key);
      }
    }
  }, []);

  // 공휴일 로드
  const loadHolidays = useCallback(async (year, month) => {
    const cacheKey = `${year}-${month}`;
    if (loadCacheRef.current.holidays === cacheKey) return;
    loadCacheRef.current.holidays = cacheKey;

    try {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      const endStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .gte('date', startDate)
        .lt('date', endStr);

      if (error) throw error;

      const holSet = new Set();
      const holNames = new Map();
      (data || []).forEach(h => {
        const d = new Date(h.date);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        holSet.add(key);
        if (h.name) holNames.set(key, h.name);
      });
      if (loadCacheRef.current.holidays !== cacheKey) return;
      setHolidays(holSet);
      setHolidayNames(holNames);
    } catch (err) {
      console.error('Failed to load holidays:', err);
    }
  }, []);

  // 치료사 로드
  const loadTherapists = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('shockwave_therapists')
        .select('*')
        .eq('is_active', true)
        .order('slot_index');

      if (error) throw error;

      setTherapists(data || []);
      return data || [];
    } catch (err) {
      console.error('Failed to load therapists:', err);
      return [];
    }
  }, []);

  const loadManualTherapists = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('manual_therapy_therapists')
        .select('*')
        .eq('is_active', true)
        .order('slot_index');

      if (error) throw error;
      setManualTherapists(data || []);
      return data || [];
    } catch (err) {
      console.error('Failed to load manual therapy therapists:', err);
      return [];
    }
  }, []);

  const saveTherapistRoster = useCallback(async (type = 'shockwave', roster = []) => {
    const tableName = type === 'manual_therapy' ? 'manual_therapy_therapists' : 'shockwave_therapists';
    const setter = type === 'manual_therapy' ? setManualTherapists : setTherapists;
    try {
      const { error: deactivateError } = await supabase
        .from(tableName)
        .update({ is_active: false })
        .eq('is_active', true);

      if (deactivateError) throw deactivateError;

      const rows = (Array.isArray(roster) ? roster : [])
        .map((item, index) => ({
          name: String(item?.name ?? item ?? '').trim(),
          slot_index: index,
          is_active: true,
        }))
        .filter((item) => item.name);

      if (rows.length === 0) {
        setter([]);
        return true;
      }

      const { data, error: insertError } = await supabase
        .from(tableName)
        .insert(rows)
        .select('*')
        .order('slot_index');

      if (insertError) throw insertError;
      setter(data || rows);
      return true;
    } catch (err) {
      console.error(`Failed to save therapist roster (${type}):`, err);
      return false;
    }
  }, []);

  // 충격파 스케줄러 환경설정 로드
  const loadShockwaveSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('shockwave_settings')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 is empty row

      if (data) {
        setShockwaveSettings({
          id: data.id || '00000000-0000-0000-0000-000000000000',
          start_time: data.start_time,
          end_time: data.end_time.substring(0, 5),
          interval_minutes: data.interval_minutes,
          day_overrides: data.day_overrides || {},
          date_overrides: data.date_overrides || {},
          prescriptions: data.prescriptions || ['F1.5', 'F/Rdc', 'F/R'],
          manual_therapy_prescriptions: data.manual_therapy_prescriptions || ['40분', '60분'],
          prescription_prices: data.prescription_prices || {
            'F1.5': 50000,
            'F/Rdc': 70000,
            'F/R': 80000,
          },
          prescription_colors: data.prescription_colors || {},
          incentive_percentage: data.incentive_percentage ?? 7,
          manual_therapy_incentive_percentage: data.manual_therapy_incentive_percentage ?? 0,
          frozen_columns: data.frozen_columns || 6,
          staff_schedule_block_rules: data.staff_schedule_block_rules || {},
          monthly_settlement_settings: data.monthly_settlement_settings || {}
        });
      }
    } catch (err) {
      console.error('Failed to load shockwave settings:', err);
    }
  }, []);

  // 앱 시작 시 치료사 목록과 설정을 미리 로드 (탭 전환 시 즉시 표시하기 위해)
  useEffect(() => {
    if (!initialLoadDone) {
      Promise.all([
        loadTherapists(),
        loadManualTherapists(),
        loadShockwaveSettings(),
      ]).then(() => setInitialLoadDone(true));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 근무표 달력 주차별 슬롯 수 설정 로드
  const loadCalendarSlotSettings = useCallback(async (year, month) => {
    try {
      const { data, error } = await supabase
        .from('staff_calendar_settings')
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setCalendarSlotSettings({ year, month, week_slot_counts: data.week_slot_counts });
      } else {
        // 이전 달 설정이 있으면 복사, 없으면 기본값
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const { data: prevData } = await supabase
          .from('staff_calendar_settings')
          .select('week_slot_counts')
          .eq('year', prevYear)
          .eq('month', prevMonth)
          .maybeSingle();

        const defaults = prevData?.week_slot_counts || { '0': 6, '1': 6, '2': 6, '3': 6, '4': 6 };
        setCalendarSlotSettings({ year, month, week_slot_counts: defaults });
      }
    } catch (err) {
      console.error('Failed to load calendar slot settings:', err);
      setCalendarSlotSettings({ year, month, week_slot_counts: { '0': 6, '1': 6, '2': 6, '3': 6, '4': 6 } });
    }
  }, []);

  // 근무표 달력 주차별 슬롯 수 설정 저장
  const saveCalendarSlotSettings = useCallback(async (year, month, weekSlotCounts) => {
    try {
      const { error } = await supabase
        .from('staff_calendar_settings')
        .upsert({
          year,
          month,
          week_slot_counts: weekSlotCounts,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'year,month' });

      if (error) throw error;
      setCalendarSlotSettings({ year, month, week_slot_counts: weekSlotCounts });
      return true;
    } catch (err) {
      console.error('Failed to save calendar slot settings:', err);
      return false;
    }
  }, []);

  // 충격파 스케줄러 환경설정 저장
  const saveShockwaveSettings = useCallback(async (newSettings) => {
    try {
      const nextUpdatedAt = new Date().toISOString();
      const { data: latestRow } = await supabase
        .from('shockwave_settings')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const targetId = latestRow?.id || newSettings.id || shockwaveSettings?.id || '00000000-0000-0000-0000-000000000000';
      const basePayload = {
        id: targetId,
        start_time: newSettings.start_time,
        end_time: newSettings.end_time,
        interval_minutes: newSettings.interval_minutes,
        day_overrides: newSettings.day_overrides || {},
        date_overrides: newSettings.date_overrides || {},
        prescriptions: newSettings.prescriptions || ['F1.5', 'F/Rdc', 'F/R'],
        manual_therapy_prescriptions: newSettings.manual_therapy_prescriptions || ['40분', '60분'],
        prescription_prices: newSettings.prescription_prices || {
          'F1.5': 50000,
          'F/Rdc': 70000,
          'F/R': 80000,
        },
        incentive_percentage: newSettings.incentive_percentage ?? 7,
        manual_therapy_incentive_percentage: newSettings.manual_therapy_incentive_percentage ?? 0,
        frozen_columns: newSettings.frozen_columns || 6,
        prescription_colors: newSettings.prescription_colors || {},
        staff_schedule_block_rules: newSettings.staff_schedule_block_rules || {},
        updated_at: nextUpdatedAt
      };
      const payload = {
        ...basePayload,
        monthly_settlement_settings: newSettings.monthly_settlement_settings || {}
      };

      const { error } = await supabase
        .from('shockwave_settings')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
        const missingOptionalColumn = /monthly_settlement_settings|staff_schedule_block_rules|schema cache|column/i.test(message);
        if (!missingOptionalColumn) throw error;

        console.warn('Optional settings column is missing. Saving compatible global settings only.');
        const { staff_schedule_block_rules, ...compatiblePayload } = basePayload;
        const { error: retryError } = await supabase
          .from('shockwave_settings')
          .upsert(compatiblePayload, { onConflict: 'id' });
        if (retryError) throw retryError;
      }
      setShockwaveSettings({ ...newSettings, id: targetId, updated_at: nextUpdatedAt });
      return true;
    } catch (err) {
      console.error('Failed to save shockwave settings:', err);
      return false;
    }
  }, [shockwaveSettings?.id]);

  // 충격파 스케줄 로드 (단일 쿼리 + 캐시 키)
  const loadShockwaveMemos = useCallback(async (year, month, options = {}) => {
    const cacheKey = `${year}-${month}`;
    if (!options.force && loadCacheRef.current.shockwaveMemos === cacheKey) return shockwaveMemosRef.current;
    loadCacheRef.current.shockwaveMemos = cacheKey;
    const requestId = ++shockwaveMemosLoadRequestRef.current;

    setLoading(true);
    try {
      await waitForShockwaveWrites();

      let allData = [];
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('shockwave_schedules')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .order('week_index', { ascending: true })
          .order('day_index', { ascending: true })
          .order('row_index', { ascending: true })
          .order('col_index', { ascending: true })
          .range(page * 1000, (page + 1) * 1000 - 1);

        if (error) throw error;
        if (data) allData.push(...data);
        if (!data || data.length < 1000) hasMore = false;
        page++;
      }

      const memoMap = {};
      allData.forEach(item => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        memoMap[key] = item;
      });
      if (loadCacheRef.current.shockwaveMemos !== cacheKey || shockwaveMemosLoadRequestRef.current !== requestId) return memoMap;
      setShockwaveMemos(prev => {
        const next = { ...memoMap };
        Object.entries(prev || {}).forEach(([key, memo]) => {
          if (memo?.year !== year || memo?.month !== month) return;
          if (next[key]) return;
          if (shouldKeepShockwaveMemo(memo)) next[key] = memo;
        });
        return next;
      });
      return memoMap;
    } catch (err) {
      console.error('Failed to load shockwave memos:', err);
      if (shockwaveMemosLoadRequestRef.current === requestId) {
        loadCacheRef.current.shockwaveMemos = null;
      }
      return null;
    } finally {
      if (shockwaveMemosLoadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [waitForShockwaveWrites, shouldKeepShockwaveMemo]);

  // 충격파 스케줄 저장
  const saveShockwaveMemo = useCallback(async (year, month, weekIndex, dayIndex, rowIndex, colIndex, content, bg_color, merge_span, prescription, body_part) => {
    const key = `${weekIndex}-${dayIndex}-${rowIndex}-${colIndex}`;
    return enqueueShockwaveWrite([key], async () => {
      try {
      const optimisticMemo = shockwaveMemosRef.current[key] || {};
      let upsertData = {
        year, month, week_index: weekIndex, day_index: dayIndex, row_index: rowIndex, col_index: colIndex,
        content: content !== undefined ? content : optimisticMemo.content,
        updated_at: new Date().toISOString()
      };
      if (bg_color !== undefined) upsertData.bg_color = bg_color;
      if (merge_span !== undefined) upsertData.merge_span = merge_span;
      if (prescription !== undefined) upsertData.prescription = prescription;
      if (body_part !== undefined) upsertData.body_part = body_part;

      setShockwaveMemos(prev => {
        const next = { ...prev };
        const updated = { ...optimisticMemo, ...upsertData };
        if (shouldKeepShockwaveMemo(updated)) next[key] = updated;
        else delete next[key];
        return next;
      });

      [upsertData] = await protectExistingScheduleContent([upsertData], { [key]: optimisticMemo });

      const upsertPayloads = buildCrossMonthMirroredPayloads([upsertData]);

      const { data, error } = await supabase
        .from('shockwave_schedules')
        .upsert(upsertPayloads, {
          onConflict: 'year,month,week_index,day_index,row_index,col_index'
        })
        .select();

      if (error) throw error;

      const savedMemo = data?.find(d => d.year === year && d.month === month) || { ...optimisticMemo, ...upsertData };
      const nextShockwaveMemos = { ...shockwaveMemosRef.current, [key]: savedMemo };
      
      if (isCurrentScheduleMonth(year, month)) {
        setShockwaveMemos(prev => {
          const next = { ...prev };
          if (shouldKeepShockwaveMemo(savedMemo)) next[key] = savedMemo;
          else delete next[key];
          return next;
        });
      }

      const today = getTodayKST();
      const todayDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const weeks = generateShockwaveCalendar(year, month);
      const dayInfo = weeks[weekIndex]?.[dayIndex];
      const targetDateStr = dayInfo && dayInfo.isCurrentMonth
        ? `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`
        : null;

      if (targetDateStr && targetDateStr <= todayDateStr) {
        if (therapists.length > 0) {
          try {
            await syncTodayShockwaveScheduleToStats({
              year,
              month,
              memos: nextShockwaveMemos,
              therapists,
              monthlyTherapists,
              targetDateStr,
            });
          } catch (syncErr) {
            console.error('Failed to sync shockwave memo to stats:', syncErr);
          }
        }
        if (manualTherapists.length > 0) {
          try {
            await syncTodayManualTherapyScheduleToStats({
              year,
              month,
              memos: nextShockwaveMemos,
              therapists: manualTherapists,
              monthlyTherapists: monthlyManualTherapists,
              targetDateStr,
            });
          } catch (syncErr) {
            console.error('Failed to sync manual therapy memo to stats:', syncErr);
          }
        }
      }
      return true;
      } catch (err) {
        setShockwaveMemos(prev => ({ ...prev }));
        console.error('Failed to save shockwave memo:', err);
        return false;
      }
    });
  }, [therapists, manualTherapists, monthlyTherapists, monthlyManualTherapists, shouldKeepShockwaveMemo, protectExistingScheduleContent, enqueueShockwaveWrite, isCurrentScheduleMonth]);

  // 다중 셀 동시 업데이트 (병합/병합해제 등)
  const saveShockwaveMemosBulk = useCallback(async (memosArray) => {
    if (!memosArray || memosArray.length === 0) return true;
    const targetKeys = memosArray.map((item) => `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`);

    return enqueueShockwaveWrite(targetKeys, async () => {
      const previousMemos = {};
      const optimisticMemos = {};

      try {
      const currentMemosSnapshot = shockwaveMemosRef.current;
      memosArray.forEach((item) => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        previousMemos[key] = currentMemosSnapshot[key];
        optimisticMemos[key] = {
          ...(currentMemosSnapshot[key] || {}),
          ...item,
          updated_at: new Date().toISOString()
        };
      });

      setShockwaveMemos(prev => {
        const next = { ...prev };
        Object.entries(optimisticMemos).forEach(([key, value]) => {
          if (shouldKeepShockwaveMemo(value)) next[key] = value;
          else delete next[key];
        });
        return next;
      });

      const guardedMemosArray = await protectExistingScheduleContent(memosArray, previousMemos);
      const upsertPayloads = buildCrossMonthMirroredPayloads(guardedMemosArray.map(m => ({
        ...m,
        updated_at: new Date().toISOString()
      })));

      const { data, error } = await supabase
        .from('shockwave_schedules')
        .upsert(
          upsertPayloads, 
          { onConflict: 'year,month,week_index,day_index,row_index,col_index' }
        )
        .select();

      if (error) throw error;

      const viewRelevantData = (data || guardedMemosArray).filter(d => d.year === currentYear && d.month === currentMonth);
      const nextShockwaveMemos = { ...shockwaveMemosRef.current };
      viewRelevantData.forEach(item => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        const merged = { ...nextShockwaveMemos[key], ...item };
        if (shouldKeepShockwaveMemo(merged)) nextShockwaveMemos[key] = merged;
        else delete nextShockwaveMemos[key];
      });

      if (isCurrentScheduleMonth(currentYear, currentMonth)) {
        setShockwaveMemos(prev => {
          const next = { ...prev };
          viewRelevantData.forEach(item => {
            const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
            const merged = { ...next[key], ...item };
            if (shouldKeepShockwaveMemo(merged)) next[key] = merged;
            else delete next[key];
          });
          return next;
        });
      }

      const weeks = generateShockwaveCalendar(currentYear, currentMonth);
      const affectedDates = new Set();
      
      guardedMemosArray.forEach((item) => {
        const dayInfo = weeks[item.week_index]?.[item.day_index];
        if (dayInfo && dayInfo.isCurrentMonth) {
          const dateStr = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
          affectedDates.add(dateStr);
        }
      });

      const today = getTodayKST();
      const todayDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      for (const targetDateStr of affectedDates) {
        if (targetDateStr && targetDateStr <= todayDateStr) {
          if (therapists.length > 0) {
            try {
              await syncTodayShockwaveScheduleToStats({
                year: currentYear,
                month: currentMonth,
                memos: nextShockwaveMemos,
                therapists,
                monthlyTherapists,
                targetDateStr,
              });
            } catch (syncErr) {
              console.error('Failed to sync bulk shockwave memos to stats:', syncErr);
            }
          }
          if (manualTherapists.length > 0) {
            try {
              await syncTodayManualTherapyScheduleToStats({
                year: currentYear,
                month: currentMonth,
                memos: nextShockwaveMemos,
                therapists: manualTherapists,
                monthlyTherapists: monthlyManualTherapists,
                targetDateStr,
              });
            } catch (syncErr) {
              console.error('Failed to sync bulk manual therapy memos to stats:', syncErr);
            }
          }
        }
      }
      return true;
    } catch (err) {
      setShockwaveMemos(prev => {
        const next = { ...prev };
        memosArray.forEach((item) => {
          const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
          if (previousMemos[key] === undefined) delete next[key];
          else next[key] = previousMemos[key];
        });
        return next;
      });
      console.error('Failed to save bulk shockwave memos:', err);
      return false;
      }
    });
  }, [currentYear, currentMonth, therapists, manualTherapists, monthlyTherapists, monthlyManualTherapists, shouldKeepShockwaveMemo, protectExistingScheduleContent, enqueueShockwaveWrite, isCurrentScheduleMonth]);

  // 월별 치료사 설정 로드 (type: 'shockwave' | 'manual_therapy')
  const loadMonthlyTherapists = useCallback(async (year, month, type = 'shockwave') => {
    const fallbackList = type === 'manual_therapy' ? manualTherapists : therapists;
    const setter = type === 'manual_therapy' ? setMonthlyManualTherapists : setMonthlyTherapists;
    const requestId = (monthlyTherapistLoadRequestRef.current[type] || 0) + 1;
    monthlyTherapistLoadRequestRef.current[type] = requestId;
    const applyIfLatest = (rows) => {
      if (monthlyTherapistLoadRequestRef.current[type] === requestId) setter(rows);
    };
    try {
      const { data, error } = await supabase
        .from('shockwave_monthly_therapists')
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .eq('type', type)
        .order('slot_index')
        .order('start_day');

      if (error) throw error;

      if (data && data.length > 0) {
        applyIfLatest(data);
        return data;
      }

      // 해당 월 데이터 없음 → 가장 최근 이전 월 설정을 상속 (최근 12개월만 스캔)
      const currentValue = year * 12 + month;
      const lookbackYear = month <= 12 ? year - 1 : year;
      const { data: previousRows, error: prevError } = await supabase
        .from('shockwave_monthly_therapists')
        .select('*')
        .eq('type', type)
        .gte('year', lookbackYear)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .order('slot_index')
        .order('start_day')
        .limit(50);

      const previousMonths = (previousRows || []).filter((item) => {
        const itemYear = Number(item.year);
        const itemMonth = Number(item.month);
        return itemYear * 12 + itemMonth < currentValue;
      });
      const inheritedValue = previousMonths.reduce((max, item) => {
        const value = Number(item.year) * 12 + Number(item.month);
        return Math.max(max, value);
      }, -Infinity);
      const prevData = previousMonths.filter((item) => {
        const value = Number(item.year) * 12 + Number(item.month);
        return value === inheritedValue;
      });

      if (!prevError && prevData.length > 0) {
        const slotMap = new Map();
        prevData.forEach((item) => {
          const existing = slotMap.get(item.slot_index);
          if (!existing || item.start_day > existing.start_day) {
            slotMap.set(item.slot_index, item);
          }
        });
        const lastDay = new Date(year, month, 0).getDate();
        const inherited = Array.from(slotMap.values()).map((item) => ({
          slot_index: item.slot_index,
          therapist_name: item.therapist_name,
          start_day: 1,
          end_day: lastDay,
          year,
          month,
          type,
        }));
        applyIfLatest(inherited);
        return inherited;
      }

      // 이전 달도 없음 → 기본 therapists 테이블에서 생성
      const lastDay = new Date(year, month, 0).getDate();
      let baseTherapists = fallbackList;
      if (!baseTherapists || baseTherapists.length === 0) {
        const tableName = type === 'manual_therapy' ? 'manual_therapy_therapists' : 'shockwave_therapists';
        const { data: defaultRows, error: defaultError } = await supabase
          .from(tableName)
          .select('*')
          .eq('is_active', true)
          .order('slot_index');

        if (!defaultError && Array.isArray(defaultRows)) {
          baseTherapists = defaultRows;
          if (type === 'manual_therapy') setManualTherapists(defaultRows);
          else setTherapists(defaultRows);
        }
      }

      const defaults = (baseTherapists || []).map((t) => ({
        slot_index: t.slot_index,
        therapist_name: t.name || '',
        start_day: 1,
        end_day: lastDay,
        year,
        month,
        type,
      }));
      applyIfLatest(defaults);
      return defaults;
    } catch (err) {
      console.error(`Failed to load monthly therapists (${type}):`, err);
      return [];
    }
  }, [therapists, manualTherapists]);

  // 월별 치료사 설정 저장 (type: 'shockwave' | 'manual_therapy')
  const saveMonthlyTherapists = useCallback(async (year, month, configs, type = 'shockwave') => {
    const setter = type === 'manual_therapy' ? setMonthlyManualTherapists : setMonthlyTherapists;
    try {
      const { error: deleteError } = await supabase
        .from('shockwave_monthly_therapists')
        .delete()
        .eq('year', year)
        .eq('month', month)
        .eq('type', type);

      if (deleteError) throw deleteError;

      if (configs.length > 0) {
        const rows = configs.map((c) => ({
          year,
          month,
          slot_index: c.slot_index,
          therapist_name: c.therapist_name ?? '',
          start_day: c.start_day,
          end_day: c.end_day,
          type,
          created_at: new Date().toISOString(),
        }));

        const { error: insertError } = await supabase
          .from('shockwave_monthly_therapists')
          .insert(rows);

        if (insertError) throw insertError;
      }

      setter(configs.map((c) => ({ ...c, year, month, type })));
      return true;
    } catch (err) {
      console.error(`Failed to save monthly therapists (${type}):`, err);
      return false;
    }
  }, []);

  // 공지사항 로드/저장
  const loadNotices = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .order('slot_index');

      if (error) throw error;
      setNotices(data || []);
    } catch (err) {
      console.error('Failed to load notices:', err);
    }
  }, []);

  const saveNotice = useCallback(async (slotIndex, content) => {
    try {
      const { error } = await supabase
        .from('notices')
        .upsert({
          slot_index: slotIndex,
          content,
          updated_at: new Date().toISOString()
        }, { onConflict: 'slot_index' });

      if (error) throw error;
      await loadNotices();
      return true;
    } catch (err) {
      console.error('Failed to save notice:', err);
      return false;
    }
  }, [loadNotices]);

  // Real-time synchronization
  useEffect(() => {
    const channel = supabase.channel('schedule-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shockwave_schedules' },
        (payload) => {
          if (payload.new && payload.new.year === currentYear && payload.new.month === currentMonth) {
            const item = payload.new;
            const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
            if (shockwaveWriteQueueRef.current.has(key)) return;
            setShockwaveMemos(prev => {
              const next = { ...prev };
              if (shouldKeepShockwaveMemo(item)) next[key] = item;
              else delete next[key];
              return next;
            });
          } else if (payload.old && payload.eventType === 'DELETE') {
            const item = payload.old;
            if (item.year === currentYear && item.month === currentMonth) {
              const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
              if (shockwaveWriteQueueRef.current.has(key)) return;
              setShockwaveMemos(prev => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_schedules' },
        (payload) => {
          if (payload.new && payload.new.year === currentYear && payload.new.month === currentMonth) {
            const item = payload.new;
            const key = `${item.year}-${item.month}-${item.day}-${item.slot_index}`;
            if (staffMemoSaveRequestRef.current.has(key)) return;
            setStaffMemos(prev => ({ ...prev, [key]: item }));
          } else if (payload.old && payload.eventType === 'DELETE') {
            const item = payload.old;
            if (item.year === currentYear && item.month === currentMonth) {
              const key = `${item.year}-${item.month}-${item.day}-${item.slot_index}`;
              if (staffMemoSaveRequestRef.current.has(key)) return;
              setStaffMemos(prev => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentYear, currentMonth, shouldKeepShockwaveMemo]);

  return (
    <ScheduleContext.Provider value={{
      currentYear, currentMonth,
      setCurrentYear, setCurrentMonth,
      navigateMonth, goToMonth,
      staffMemos, loadStaffMemos, saveStaffMemo,
      holidays, holidayNames, loadHolidays,
      therapists, loadTherapists,
      manualTherapists, loadManualTherapists,
      saveTherapistRoster,
      shockwaveSettings, loadShockwaveSettings, saveShockwaveSettings,
      shockwaveMemos, loadShockwaveMemos, saveShockwaveMemo, saveShockwaveMemosBulk,
      monthlyTherapists, monthlyManualTherapists, loadMonthlyTherapists, saveMonthlyTherapists,
      notices, loadNotices, saveNotice,
      calendarSlotSettings, loadCalendarSlotSettings, saveCalendarSlotSettings,
      loading
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export const useSchedule = () => useContext(ScheduleContext);
