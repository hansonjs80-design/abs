import { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { generateShockwaveCalendar, getTodayKST } from '../lib/calendarUtils';
import { syncTodayShockwaveScheduleToStats } from '../lib/shockwaveSyncUtils';

const ScheduleContext = createContext();

export function ScheduleProvider({ children }) {
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [staffMemos, setStaffMemos] = useState({});
  const [holidays, setHolidays] = useState(new Set());
  const [therapists, setTherapists] = useState([]);
  const [manualTherapists, setManualTherapists] = useState([]);
  const [shockwaveSettings, setShockwaveSettings] = useState({
    start_time: '09:00:00',
    end_time: '18:00:00',
    interval_minutes: 10,
    day_overrides: {},
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
    frozen_columns: 6
  });
  const [shockwaveMemos, setShockwaveMemos] = useState({});
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(false);

  const shouldKeepShockwaveMemo = useCallback((memo) => {
    if (!memo) return false;
    const hasContent = Boolean((memo.content || '').trim());
    const hasBgColor = memo.bg_color !== undefined && memo.bg_color !== null && memo.bg_color !== '';
    const merge = memo.merge_span;
    const hasMerge =
      Boolean(merge) &&
      (
        (merge.rowSpan && merge.rowSpan !== 1) ||
        (merge.colSpan && merge.colSpan !== 1) ||
        merge.mergedInto
      );
    return hasContent || hasBgColor || hasMerge;
  }, []);

  const navigateMonth = useCallback((delta) => {
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
    setCurrentYear(year);
    setCurrentMonth(month);
  }, []);

  // 직원 메모 로드
  const loadStaffMemos = useCallback(async (year, month) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('staff_schedules')
        .select('*')
        .eq('year', year)
        .eq('month', month);

      if (error) throw error;

      const memoMap = {};
      (data || []).forEach(item => {
        const key = `${item.year}-${item.month}-${item.day}-${item.slot_index}`;
        memoMap[key] = item;
      });
      setStaffMemos(memoMap);
    } catch (err) {
      console.error('Failed to load staff memos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 직원 메모 저장/업데이트
  const saveStaffMemo = useCallback(async (year, month, day, slotIndex, content, fontColor = null) => {
    try {
      const { data, error } = await supabase
        .from('staff_schedules')
        .upsert({
          year, month, day,
          slot_index: slotIndex,
          content: content || '',
          font_color: fontColor,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'year,month,day,slot_index'
        })
        .select();

      if (error) throw error;

      const key = `${year}-${month}-${day}-${slotIndex}`;
      setStaffMemos(prev => ({
        ...prev,
        [key]: data?.[0] || { year, month, day, slot_index: slotIndex, content, font_color: fontColor }
      }));
      return true;
    } catch (err) {
      console.error('Failed to save staff memo:', err);
      return false;
    }
  }, []);

  // 공휴일 로드
  const loadHolidays = useCallback(async (year, month) => {
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
      (data || []).forEach(h => {
        const d = new Date(h.date);
        holSet.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
      });
      setHolidays(holSet);
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
    } catch (err) {
      console.error('Failed to load therapists:', err);
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
    } catch (err) {
      console.error('Failed to load manual therapy therapists:', err);
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
          start_time: data.start_time,
          end_time: data.end_time,
          interval_minutes: data.interval_minutes,
          day_overrides: data.day_overrides || {},
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
          frozen_columns: data.frozen_columns || 6
        });
      }
    } catch (err) {
      console.error('Failed to load shockwave settings:', err);
    }
  }, []);

  // 충격파 스케줄러 환경설정 저장
  const saveShockwaveSettings = useCallback(async (newSettings) => {
    try {
      const { error } = await supabase.from('shockwave_settings').upsert({
        id: '00000000-0000-0000-0000-000000000000',
        start_time: newSettings.start_time,
        end_time: newSettings.end_time,
        interval_minutes: newSettings.interval_minutes,
        day_overrides: newSettings.day_overrides || {},
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
        prescription_colors: newSettings.prescription_colors || {}
      }, { onConflict: 'id' });

      if (error) throw error;
      setShockwaveSettings(newSettings);
      return true;
    } catch (err) {
      console.error('Failed to save shockwave settings:', err);
      return false;
    }
  }, []);

  // 충격파 스케줄 로드
  const loadShockwaveMemos = useCallback(async (year, month) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shockwave_schedules')
        .select('*')
        .eq('year', year)
        .eq('month', month);

      if (error) throw error;

      const memoMap = {};
      (data || []).forEach(item => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        memoMap[key] = item;
      });
      setShockwaveMemos(memoMap);
    } catch (err) {
      console.error('Failed to load shockwave memos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 충격파 스케줄 저장
  const saveShockwaveMemo = useCallback(async (year, month, weekIndex, dayIndex, rowIndex, colIndex, content, bg_color, merge_span, prescription) => {
    try {
      const key = `${weekIndex}-${dayIndex}-${rowIndex}-${colIndex}`;
      const optimisticMemo = shockwaveMemos[key] || {};
      const upsertData = {
        year, month, week_index: weekIndex, day_index: dayIndex, row_index: rowIndex, col_index: colIndex,
        content: content !== undefined ? content : optimisticMemo.content,
        updated_at: new Date().toISOString()
      };
      if (bg_color !== undefined) upsertData.bg_color = bg_color;
      if (merge_span !== undefined) upsertData.merge_span = merge_span;
      if (prescription !== undefined) upsertData.prescription = prescription;

      setShockwaveMemos(prev => {
        const next = { ...prev };
        const updated = { ...optimisticMemo, ...upsertData };
        if (shouldKeepShockwaveMemo(updated)) next[key] = updated;
        else delete next[key];
        return next;
      });

      const { data, error } = await supabase
        .from('shockwave_schedules')
        .upsert(upsertData, {
          onConflict: 'year,month,week_index,day_index,row_index,col_index'
        })
        .select();

      if (error) throw error;

      const savedMemo = data?.[0] || { ...optimisticMemo, ...upsertData };
      const nextShockwaveMemos = { ...shockwaveMemos, [key]: savedMemo };
      
      setShockwaveMemos(prev => {
        const next = { ...prev };
        if (shouldKeepShockwaveMemo(savedMemo)) next[key] = savedMemo;
        else delete next[key];
        return next;
      });

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
  }, [shockwaveMemos, therapists, shouldKeepShockwaveMemo]);

  // 다중 셀 동시 업데이트 (병합/병합해제 등)
  const saveShockwaveMemosBulk = useCallback(async (memosArray) => {
    const previousMemos = {};
    const optimisticMemos = {};

    try {
      if (!memosArray || memosArray.length === 0) return true;
      memosArray.forEach((item) => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        previousMemos[key] = shockwaveMemos[key];
        optimisticMemos[key] = {
          ...(shockwaveMemos[key] || {}),
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
      
      const { data, error } = await supabase
        .from('shockwave_schedules')
        .upsert(
          memosArray.map(m => ({
            ...m,
            updated_at: new Date().toISOString()
          })), 
          { onConflict: 'year,month,week_index,day_index,row_index,col_index' }
        )
        .select();

      if (error) throw error;

      const nextShockwaveMemos = { ...shockwaveMemos };
      (data || memosArray).forEach(item => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        const merged = { ...nextShockwaveMemos[key], ...item };
        if (shouldKeepShockwaveMemo(merged)) nextShockwaveMemos[key] = merged;
        else delete nextShockwaveMemos[key];
      });

      setShockwaveMemos(prev => {
        const next = { ...prev };
        (data || memosArray).forEach(item => {
          const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
          const merged = { ...next[key], ...item };
          if (shouldKeepShockwaveMemo(merged)) next[key] = merged;
          else delete next[key];
        });
        return next;
      });

      const today = getTodayKST();
      const todayDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const weeks = generateShockwaveCalendar(currentYear, currentMonth);
      const touchedDates = new Set();
      
      memosArray.forEach((item) => {
        const dayInfo = weeks[item.week_index]?.[item.day_index];
        if (dayInfo && dayInfo.isCurrentMonth) {
          const dateStr = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
          if (dateStr <= todayDateStr) {
            touchedDates.add(dateStr);
          }
        }
      });

      if (touchedDates.size > 0) {
        for (const dateStr of touchedDates) {
          if (therapists.length > 0) {
            try {
              await syncTodayShockwaveScheduleToStats({
                year: currentYear,
                month: currentMonth,
                memos: nextShockwaveMemos,
                therapists,
                targetDateStr: dateStr,
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
                targetDateStr: dateStr,
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
  }, [currentYear, currentMonth, shockwaveMemos, therapists, shouldKeepShockwaveMemo]);

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

  return (
    <ScheduleContext.Provider value={{
      currentYear, currentMonth,
      setCurrentYear, setCurrentMonth,
      navigateMonth, goToMonth,
      staffMemos, loadStaffMemos, saveStaffMemo,
      holidays, loadHolidays,
      therapists, loadTherapists,
      manualTherapists, loadManualTherapists,
      shockwaveSettings, loadShockwaveSettings, saveShockwaveSettings,
      shockwaveMemos, loadShockwaveMemos, saveShockwaveMemo, saveShockwaveMemosBulk,
      notices, loadNotices, saveNotice,
      loading
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export const useSchedule = () => useContext(ScheduleContext);
