import { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const ScheduleContext = createContext();

export function ScheduleProvider({ children }) {
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [staffMemos, setStaffMemos] = useState({});
  const [holidays, setHolidays] = useState(new Set());
  const [therapists, setTherapists] = useState([]);
  const [shockwaveSettings, setShockwaveSettings] = useState({
    start_time: '09:00:00',
    end_time: '18:00:00',
    interval_minutes: 10,
    day_overrides: {}
  });
  const [shockwaveMemos, setShockwaveMemos] = useState({});
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(false);

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
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate);

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
          day_overrides: data.day_overrides || {}
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
        day_overrides: newSettings.day_overrides || {}
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
  const saveShockwaveMemo = useCallback(async (year, month, weekIndex, dayIndex, rowIndex, colIndex, content, bg_color) => {
    try {
      const upsertData = {
        year, month, week_index: weekIndex, day_index: dayIndex, row_index: rowIndex, col_index: colIndex,
        content: content || '',
        updated_at: new Date().toISOString()
      };
      if (bg_color !== undefined) upsertData.bg_color = bg_color;

      const { data, error } = await supabase
        .from('shockwave_schedules')
        .upsert(upsertData, {
          onConflict: 'year,month,week_index,day_index,row_index,col_index'
        })
        .select();

      if (error) throw error;

      const key = `${weekIndex}-${dayIndex}-${rowIndex}-${colIndex}`;
      setShockwaveMemos(prev => ({
        ...prev,
        [key]: data?.[0] || { ...upsertData }
      }));
      return true;
    } catch (err) {
      console.error('Failed to save shockwave memo:', err);
      return false;
    }
  }, []);

  // 다중 셀 동시 업데이트 (병합/병합해제 등)
  const saveShockwaveMemosBulk = useCallback(async (memosArray) => {
    try {
      if (!memosArray || memosArray.length === 0) return true;
      
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

      setShockwaveMemos(prev => {
        const next = { ...prev };
        (data || memosArray).forEach(item => {
          const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
          next[key] = { ...next[key], ...item };
        });
        return next;
      });
      return true;
    } catch (err) {
      console.error('Failed to save bulk shockwave memos:', err);
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

  return (
    <ScheduleContext.Provider value={{
      currentYear, currentMonth,
      setCurrentYear, setCurrentMonth,
      navigateMonth, goToMonth,
      staffMemos, loadStaffMemos, saveStaffMemo,
      holidays, loadHolidays,
      therapists, loadTherapists,
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
