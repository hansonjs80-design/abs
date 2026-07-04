import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  generateShockwaveCalendar,
} from '../lib/calendarUtils';
import {
  canonicalizeShockwaveScheduleItemDate,
  getVisibleShockwaveScheduleMonths,
  mapShockwaveScheduleItemToVisibleMonth,
} from '../lib/shockwaveScheduleDateMapping';
import {
  applyScheduleDeviceSettings,
  saveScheduleDeviceSettings,
  SCHEDULE_DEVICE_SETTINGS_EVENT,
} from '../lib/scheduleDeviceSettings';
import { syncTodayShockwaveScheduleToStats } from '../lib/shockwaveSyncUtils';
import { syncTodayManualTherapyScheduleToStats } from '../lib/manualTherapyUtils';
import { normalizeStaffDeptNameSpacing } from '../lib/staffMemoFormatUtils';
import { buildShockwaveIntervalRealignmentUpdates } from '../lib/scheduleIntervalRealignmentUtils';
import {
  applyRealtimeShockwaveMemoUpdate,
  applyShockwaveMemoStateUpdate,
  buildOptimisticShockwaveMemos,
  rollbackShockwaveMemoState,
} from '../lib/scheduleSaveStateUtils';
import {
  isIntentionalClearScheduleItem,
  sanitizeShockwaveScheduleItemForDisplay,
} from '../lib/shockwaveScheduleSanitize';
import {
  getPendingDraftId,
  readDeletedScheduleDrafts,
  readPendingScheduleDrafts,
  rememberDeletedScheduleDraft,
} from '../lib/schedulerUtils';

const ScheduleContext = createContext();
const LOCAL_WRITE_STALE_GUARD_MS = 1200;

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
    interval_minutes: 20,
    time_label_interval_minutes: 20,
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
  const [shockwaveMemosLoadedKey, setShockwaveMemosLoadedKey] = useState('');
  const [monthlyTherapists, setMonthlyTherapists] = useState([]);
  const [monthlyManualTherapists, setMonthlyManualTherapists] = useState([]);
  const [monthlyTherapistLoadKeys, setMonthlyTherapistLoadKeys] = useState({ shockwave: '', manual_therapy: '' });
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [calendarSlotSettings, setCalendarSlotSettings] = useState(null);
  const loadingCountRef = useRef(0);
  const shockwaveWriteQueueRef = useRef(new Map());
  const lastWriteTimeRef = useRef(new Map());
  const localShockwaveWriteTimeRef = useRef(new Map());
  const loadCacheRef = useRef({ staffMemos: null, shockwaveMemos: null, holidays: null });
  const realtimeRefreshTimerRef = useRef(null);
  const staffMemosRef = useRef(staffMemos);
  const staffMemoSaveRequestRef = useRef(new Map());
  const staffMemosLoadRequestRef = useRef(0);
  const shockwaveMemosRef = useRef(shockwaveMemos);
  const currentDateRef = useRef({ year: currentYear, month: currentMonth });
  const shockwaveMemosLoadRequestRef = useRef(0);
  const monthlyTherapistLoadRequestRef = useRef({ shockwave: 0, manual_therapy: 0 });
  const monthlyTherapistSaveRequestRef = useRef({ shockwave: 0, manual_therapy: 0 });
  const therapistRosterLoadRequestRef = useRef({ shockwave: 0, manual_therapy: 0 });
  const therapistRosterSaveRequestRef = useRef({ shockwave: 0, manual_therapy: 0 });
  const noticesLoadRequestRef = useRef(0);
  const noticeSaveRequestRef = useRef(new Map());
  const holidaysLoadRequestRef = useRef(0);
  const calendarSlotSettingsLoadRequestRef = useRef(0);
  const calendarSlotSettingsSaveRequestRef = useRef(0);
  const shockwaveSettingsLoadRequestRef = useRef(0);
  const shockwaveSettingsSaveRequestRef = useRef(0);
  const loadShockwaveMemosRef = useRef(null);
  const therapistsRef = useRef(therapists);
  const manualTherapistsRef = useRef(manualTherapists);
  const shockwaveSettingsRefCache = useRef(shockwaveSettings);
  const monthlyTherapistLoadKeysRef = useRef(monthlyTherapistLoadKeys);

  useEffect(() => {
    staffMemosRef.current = staffMemos;
  }, [staffMemos]);

  useEffect(() => {
    shockwaveMemosRef.current = shockwaveMemos;
  }, [shockwaveMemos]);

  useEffect(() => {
    currentDateRef.current = { year: currentYear, month: currentMonth };
  }, [currentYear, currentMonth]);

  useEffect(() => {
    monthlyTherapistLoadKeysRef.current = monthlyTherapistLoadKeys;
  }, [monthlyTherapistLoadKeys]);

  const monthlyTherapistsRef = useRef(monthlyTherapists);
  const monthlyManualTherapistsRef = useRef(monthlyManualTherapists);

  useEffect(() => {
    monthlyTherapistsRef.current = monthlyTherapists;
  }, [monthlyTherapists]);

  useEffect(() => {
    monthlyManualTherapistsRef.current = monthlyManualTherapists;
  }, [monthlyManualTherapists]);

  // ─── CLIPBOARD GLOBAL STATE ────────────────────────────────
  const clipboardRef = useRef({ content: '', mode: null });
  const [clipboardSource, setClipboardSource] = useState(null); // { keys: Set, mode: 'copy'|'cut' }

  const getNoticeStorageSlot = useCallback((year, month, slotIndex) => (
    Number(year) * 10000 + Number(month) * 100 + Number(slotIndex)
  ), []);

  const normalizeNoticeSlot = useCallback((notice, year, month) => {
    const storageSlot = Number(notice?.slot_index);
    const monthPrefix = Number(year) * 10000 + Number(month) * 100;
    return {
      ...notice,
      storage_slot_index: storageSlot,
      slot_index: storageSlot >= monthPrefix && storageSlot < monthPrefix + 100
        ? storageSlot - monthPrefix
        : storageSlot,
    };
  }, []);

  useEffect(() => {
    therapistsRef.current = therapists;
  }, [therapists]);

  useEffect(() => {
    manualTherapistsRef.current = manualTherapists;
  }, [manualTherapists]);

  useEffect(() => {
    shockwaveSettingsRefCache.current = shockwaveSettings;
  }, [shockwaveSettings]);

  const setMonthlyTherapistLoadedKey = useCallback((type, key) => {
    monthlyTherapistLoadKeysRef.current = {
      ...monthlyTherapistLoadKeysRef.current,
      [type]: key,
    };
    setMonthlyTherapistLoadKeys(monthlyTherapistLoadKeysRef.current);
  }, []);

  const isCurrentScheduleMonth = useCallback((year, month) => (
    currentDateRef.current.year === year && currentDateRef.current.month === month
  ), []);

  const beginLoading = useCallback(() => {
    loadingCountRef.current += 1;
    setLoading(true);
  }, []);

  const endLoading = useCallback(() => {
    loadingCountRef.current = Math.max(0, loadingCountRef.current - 1);
    if (loadingCountRef.current === 0) {
      setLoading(false);
    }
  }, []);

  const enqueueShockwaveWrite = useCallback((keys, task) => {
    const targetKeys = Array.from(new Set((keys || []).filter(Boolean)));
    const previousWrites = targetKeys
      .map((key) => shockwaveWriteQueueRef.current.get(key))
      .filter(Boolean);
    const queuedWrite = Promise
      .allSettled(previousWrites)
      .then(task);

    // API 호출이 끝난 후 1.2초간 실시간 이벤트를 무시하도록 락을 유지하는 쿨다운 체인 생성
    const cooldownDelayPromise = queuedWrite.then(() => {
      return new Promise((resolve) => setTimeout(resolve, 1200));
    });

    const trackedWrite = cooldownDelayPromise.finally(() => {
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

  const getShockwaveMemoTime = useCallback((memo) => {
    const time = memo?.updated_at ? new Date(memo.updated_at).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }, []);

  const shouldIgnoreStaleShockwaveServerItem = useCallback((key, serverItem) => {
    const localLastWrite = localShockwaveWriteTimeRef.current.get(key);
    if (!localLastWrite) return false;

    const localTime = new Date(localLastWrite).getTime();
    if (!Number.isFinite(localTime)) return false;
    const isRecentLocalWrite = Date.now() - localTime < LOCAL_WRITE_STALE_GUARD_MS;
    if (!isRecentLocalWrite) {
      localShockwaveWriteTimeRef.current.delete(key);
      return false;
    }

    const serverTime = getShockwaveMemoTime(serverItem);
    if (serverTime > 0) return serverTime <= localTime;

    return true;
  }, [getShockwaveMemoTime]);

  const reconcileLoadedShockwaveMemosWithLocalWrites = useCallback((memoMap) => {
    const next = { ...(memoMap || {}) };
    const localMemos = shockwaveMemosRef.current || {};

    localShockwaveWriteTimeRef.current.forEach((localLastWrite, key) => {
      if (!localLastWrite) return;

      const localTime = new Date(localLastWrite).getTime();
      if (!Number.isFinite(localTime)) return;
      const isRecentLocalWrite = Date.now() - localTime < LOCAL_WRITE_STALE_GUARD_MS;
      if (!isRecentLocalWrite) {
        localShockwaveWriteTimeRef.current.delete(key);
        return;
      }

      const serverMemo = next[key];
      const serverTime = getShockwaveMemoTime(serverMemo);
      const localMemo = localMemos[key];
      const localMemoTime = getShockwaveMemoTime(localMemo);
      const isRecentUntimestampedConflict = serverMemo && serverTime === 0;
      const serverIsOlderThanLocalWrite = serverMemo && serverTime > 0 && serverTime <= localTime;

      if (serverIsOlderThanLocalWrite || isRecentUntimestampedConflict) {
        if (shouldKeepShockwaveMemo(localMemo)) next[key] = localMemo;
        else delete next[key];
        return;
      }

      if (!serverMemo && localMemo && localMemoTime >= localTime && shouldKeepShockwaveMemo(localMemo)) {
        next[key] = localMemo;
      }
    });

    return next;
  }, [getShockwaveMemoTime, shouldKeepShockwaveMemo]);

  const mergeLoadedShockwaveMemosWithLocalRecovery = useCallback((year, month, memoMap) => {
    if (typeof window === 'undefined') return memoMap || {};

    const next = { ...(memoMap || {}) };
    const deletedDrafts = readDeletedScheduleDrafts();
    const getCanonicalRecoveryDraftId = (key) => {
      const [weekIndex, dayIndex, rowIndex, colIndex] = String(key).split('-').map(Number);
      if (![weekIndex, dayIndex, rowIndex, colIndex].every(Number.isFinite)) return null;
      const canonicalItem = canonicalizeShockwaveScheduleItemDate({
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: rowIndex,
        col_index: colIndex,
      });
      const canonicalKey = `${canonicalItem.week_index}-${canonicalItem.day_index}-${canonicalItem.row_index}-${canonicalItem.col_index}`;
      return getPendingDraftId(canonicalItem.year, canonicalItem.month, canonicalKey);
    };
    const isDeletedAfter = (key, updatedAt) => {
      const visibleDeleted = deletedDrafts[getPendingDraftId(year, month, key)];
      const canonicalDraftId = getCanonicalRecoveryDraftId(key);
      const canonicalDeleted = canonicalDraftId ? deletedDrafts[canonicalDraftId] : null;
      const deletedUpdatedAt = Math.max(
        Number(visibleDeleted?.updatedAt || 0),
        Number(canonicalDeleted?.updatedAt || 0)
      );
      return deletedUpdatedAt > 0 && deletedUpdatedAt >= Number(updatedAt || 0);
    };
    const applyRecoveredMemo = (key, memo, recoveredAt) => {
      if (!key || !memo || isDeletedAfter(key, recoveredAt)) return;
      if (next[key]) return;
      const [weekIndex, dayIndex, rowIndex, colIndex] = key.split('-').map(Number);
      if (![weekIndex, dayIndex, rowIndex, colIndex].every(Number.isFinite)) return;
      const recoveredMemo = {
        ...memo,
        year,
        month,
        week_index: weekIndex,
        day_index: dayIndex,
        row_index: rowIndex,
        col_index: colIndex,
      };
      if (shouldKeepShockwaveMemo(recoveredMemo)) next[key] = recoveredMemo;
    };

    Object.values(readPendingScheduleDrafts()).forEach((draft) => {
      if (Number(draft?.year) !== Number(year) || Number(draft?.month) !== Number(month) || !draft?.key) return;
      const key = String(draft.key);
      applyRecoveredMemo(
        key,
        {
          content: String(draft.value ?? ''),
          updated_at: new Date(Number(draft.updatedAt) || Date.now()).toISOString(),
        },
        draft.updatedAt
      );
    });

    return next;
  }, [shouldKeepShockwaveMemo]);

  const protectExistingScheduleContent = useCallback(async (items, localSnapshot = {}) => {
    const list = Array.isArray(items) ? items : [];
    const isStructuralBlankWrite = (item) => {
      const mergeSpan = item?.merge_span;
      return Boolean(
        mergeSpan?.mergedInto ||
        (mergeSpan?.rowSpan || 1) > 1 ||
        (mergeSpan?.colSpan || 1) > 1
      );
    };
    const blankContentItems = list.filter((item) => (
      item &&
      Object.prototype.hasOwnProperty.call(item, 'content') &&
      !String(item.content || '').trim() &&
      !isIntentionalClearScheduleItem(item) &&
      !isStructuralBlankWrite(item)
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
          .select('year,month,week_index,day_index,row_index,col_index,content,bg_color,merge_span,prescription,body_part')
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
      if (isStructuralBlankWrite(item)) return item;

      const localKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      if (String(localSnapshot[localKey]?.content || '').trim()) return item;

      const dbKey = `${item.year}-${item.month}-${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
      const existing = existingByCell.get(dbKey);
      if (!String(existing?.content || '').trim()) return item;

      return {
        ...item,
        content: existing.content,
        bg_color: existing.bg_color ?? item.bg_color ?? null,
        merge_span: existing.merge_span ?? item.merge_span,
        prescription: existing.prescription ?? item.prescription ?? null,
        body_part: existing.body_part ?? item.body_part ?? null,
      };
    });
  }, []);

  const navigateMonth = useCallback((delta) => {
    loadCacheRef.current = { staffMemos: null, shockwaveMemos: null, holidays: null };
    shockwaveMemosRef.current = {};
    setShockwaveMemosLoadedKey('');
    setShockwaveMemos({});
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
    shockwaveMemosRef.current = {};
    setShockwaveMemosLoadedKey('');
    setShockwaveMemos({});
    setCurrentYear(year);
    setCurrentMonth(month);
  }, []);

  // 직원 메모 로드 (캐시 키로 중복 방지)
  const loadStaffMemos = useCallback(async (year, month, options = {}) => {
    const cacheKey = `${year}-${month}-${options.includeAdjacentMonths ? 'adj' : 'single'}`;
    if (!options.force && loadCacheRef.current.staffMemos === cacheKey) return staffMemosRef.current;
    loadCacheRef.current.staffMemos = cacheKey;
    const requestId = ++staffMemosLoadRequestRef.current;

    beginLoading();
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
            memoMap[key] = {
              ...item,
              content: normalizeStaffDeptNameSpacing(item.content || ''),
            };
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
      endLoading();
    }
  }, [beginLoading, endLoading]);

  // 직원 메모 저장/업데이트
  const saveStaffMemo = useCallback(async (year, month, day, slotIndex, content, fontColor = undefined, bgColor = undefined) => {
    const key = `${year}-${month}-${day}-${slotIndex}`;
    const normalizedContent = normalizeStaffDeptNameSpacing(content || '');
    const requestId = (staffMemoSaveRequestRef.current.get(key) || 0) + 1;
    staffMemoSaveRequestRef.current.set(key, requestId);
    const previousMemo = staffMemosRef.current[key];
    try {
      const upsertData = {
        year, month, day,
        slot_index: slotIndex,
        content: normalizedContent,
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
    const requestId = ++holidaysLoadRequestRef.current;

    try {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const startDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      const afterNextYear = month >= 11 ? year + 1 : year;
      const afterNextMonth = month === 11 ? 1 : month === 12 ? 2 : month + 2;
      const endStr = `${afterNextYear}-${String(afterNextMonth).padStart(2, '0')}-01`;

      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .gte('date', startDate)
        .lt('date', endStr);

      if (error) throw error;

      const holSet = new Set();
      const holNames = new Map();
      (data || []).forEach(h => {
        let key;
        if (h.date && h.date.includes('-')) {
          const [y, m, d] = h.date.split('-');
          key = `${Number(y)}-${Number(m)}-${Number(d.substring(0, 2))}`;
        } else {
          const d = new Date(h.date);
          key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
        }
        holSet.add(key);
        if (h.name) holNames.set(key, h.name);
      });
      if (loadCacheRef.current.holidays !== cacheKey || holidaysLoadRequestRef.current !== requestId) return;
      setHolidays(holSet);
      setHolidayNames(holNames);
    } catch (err) {
      console.error('Failed to load holidays:', err);
      if (holidaysLoadRequestRef.current === requestId) {
        loadCacheRef.current.holidays = null;
      }
    }
  }, []);

  // 치료사 로드
  const loadTherapists = useCallback(async (options = {}) => {
    // 캐시된 데이터가 있고 강제 갱신이 아니면 DB 쿼리 없이 즉시 반환
    if (!options.force && therapistsRef.current && therapistsRef.current.length > 0) {
      return therapistsRef.current;
    }
    const requestId = (therapistRosterLoadRequestRef.current.shockwave || 0) + 1;
    therapistRosterLoadRequestRef.current.shockwave = requestId;
    try {
      const { data, error } = await supabase
        .from('shockwave_therapists')
        .select('*')
        .eq('is_active', true)
        .order('slot_index');

      if (error) throw error;

      const result = data || [];
      if (therapistRosterLoadRequestRef.current.shockwave === requestId) {
        therapistsRef.current = result;
        setTherapists(result);
      }
      return result;
    } catch (err) {
      console.error('[ScheduleContext] loadTherapists 실패:', err);
      return therapistsRef.current || [];
    }
  }, []);

  const loadManualTherapists = useCallback(async (options = {}) => {
    // 캐시된 데이터가 있고 강제 갱신이 아니면 DB 쿼리 없이 즉시 반환
    if (!options.force && manualTherapistsRef.current && manualTherapistsRef.current.length > 0) {
      return manualTherapistsRef.current;
    }
    const requestId = (therapistRosterLoadRequestRef.current.manual_therapy || 0) + 1;
    therapistRosterLoadRequestRef.current.manual_therapy = requestId;
    try {
      const { data, error } = await supabase
        .from('manual_therapy_therapists')
        .select('*')
        .eq('is_active', true)
        .order('slot_index');

      if (error) throw error;

      const result = data || [];
      if (therapistRosterLoadRequestRef.current.manual_therapy === requestId) {
        manualTherapistsRef.current = result;
        setManualTherapists(result);
      }
      return result;
    } catch (err) {
      console.error('[ScheduleContext] loadManualTherapists 실패:', err);
      return manualTherapistsRef.current || [];
    }
  }, []);

  const saveTherapistRoster = useCallback(async (type = 'shockwave', roster = []) => {
    const tableName = type === 'manual_therapy' ? 'manual_therapy_therapists' : 'shockwave_therapists';
    const setter = type === 'manual_therapy' ? setManualTherapists : setTherapists;
    const requestKey = type === 'manual_therapy' ? 'manual_therapy' : 'shockwave';
    const requestId = (therapistRosterSaveRequestRef.current[requestKey] || 0) + 1;
    therapistRosterSaveRequestRef.current[requestKey] = requestId;
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
        if (therapistRosterSaveRequestRef.current[requestKey] === requestId) {
          therapistRosterLoadRequestRef.current[requestKey] += 1;
          // Ref 캐시도 즉시 갱신
          if (type === 'manual_therapy') { manualTherapistsRef.current = []; }
          else { therapistsRef.current = []; }
          setter([]);
        }
        return true;
      }

      const { data, error: insertError } = await supabase
        .from(tableName)
        .insert(rows)
        .select('*')
        .order('slot_index');

      if (insertError) throw insertError;
      if (therapistRosterSaveRequestRef.current[requestKey] === requestId) {
        therapistRosterLoadRequestRef.current[requestKey] += 1;
        const savedData = data || rows;
        // Ref 캐시도 즉시 갱신
        if (type === 'manual_therapy') { manualTherapistsRef.current = savedData; }
        else { therapistsRef.current = savedData; }
        setter(savedData);
      }
      return true;
    } catch (err) {
      console.error(`[ScheduleContext] saveTherapistRoster(${type}) 실패:`, err);
      return false;
    }
  }, []);

  // 충격파 스케줄러 환경설정 로드 (캐시 지원)
  const loadShockwaveSettings = useCallback(async (options = {}) => {
    // 캐시된 설정이 있고 강제 갱신이 아니면 DB 쿼리 없이 즉시 반환
    if (!options.force && shockwaveSettingsRefCache.current && shockwaveSettingsRefCache.current.id && shockwaveSettingsRefCache.current.id !== '00000000-0000-0000-0000-000000000000') {
      return shockwaveSettingsRefCache.current;
    }
    const requestId = ++shockwaveSettingsLoadRequestRef.current;
    try {
      const { data, error } = await supabase
        .from('shockwave_settings')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 is empty row

      if (data) {
        if (shockwaveSettingsLoadRequestRef.current !== requestId) return null;
        const parsed = applyScheduleDeviceSettings({
          id: data.id || '00000000-0000-0000-0000-000000000000',
          start_time: data.start_time?.substring(0, 5) || '09:00',
          end_time: data.end_time?.substring(0, 5) || '18:00',
          interval_minutes: data.interval_minutes,
          time_label_interval_minutes: data.time_label_interval_minutes
            || data.monthly_settlement_settings?.__schedule_display?.time_label_interval_minutes
            || data.interval_minutes
            || 20,
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
          shortcuts: data.shortcuts || {},
          manual_therapy_shortcuts: data.manual_therapy_shortcuts || {},
          dose_tags: data.dose_tags || {},
          manual_therapy_dose_tags: data.manual_therapy_dose_tags || {},
          duration_minutes: data.duration_minutes || {},
          manual_therapy_duration_minutes: data.manual_therapy_duration_minutes || {},
          visit_line_break_prescriptions: data.visit_line_break_prescriptions || [],
          manual_therapy_visit_line_break_prescriptions: data.manual_therapy_visit_line_break_prescriptions || [],
          monthly_settlement_settings: data.monthly_settlement_settings || {}
        });
        shockwaveSettingsRefCache.current = parsed;
        setShockwaveSettings(parsed);
        return data;
      }
      return null;
    } catch (err) {
      console.error('[ScheduleContext] loadShockwaveSettings 실패:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleDeviceSettingsChange = () => {
      setShockwaveSettings((prev) => {
        const next = applyScheduleDeviceSettings(prev);
        shockwaveSettingsRefCache.current = next;
        return next;
      });
    };

    window.addEventListener(SCHEDULE_DEVICE_SETTINGS_EVENT, handleDeviceSettingsChange);
    return () => window.removeEventListener(SCHEDULE_DEVICE_SETTINGS_EVENT, handleDeviceSettingsChange);
  }, []);

  const saveShockwaveDeviceScheduleSettings = useCallback((settings) => {
    const nextDeviceSettings = saveScheduleDeviceSettings(settings, shockwaveSettingsRefCache.current);
    setShockwaveSettings((prev) => {
      const next = {
        ...prev,
        time_label_interval_minutes: nextDeviceSettings.time_label_interval_minutes,
      };
      shockwaveSettingsRefCache.current = next;
      return next;
    });
    return nextDeviceSettings;
  }, []);

  // 앱 시작 시 치료사 목록과 설정을 미리 로드 (탭 전환 시 즉시 표시하기 위해)
  useEffect(() => {
    if (!initialLoadDone) {
      Promise.allSettled([
        loadTherapists(),
        loadManualTherapists(),
        loadShockwaveSettings(),
      ]).then(() => setInitialLoadDone(true));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 근무표 달력 주차별 슬롯 수 설정 로드
  const loadCalendarSlotSettings = useCallback(async (year, month) => {
    const requestId = ++calendarSlotSettingsLoadRequestRef.current;
    const applyIfLatest = (value) => {
      if (calendarSlotSettingsLoadRequestRef.current === requestId) {
        setCalendarSlotSettings(value);
      }
    };
    try {
      const { data, error } = await supabase
        .from('staff_calendar_settings')
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const value = { year, month, week_slot_counts: data.week_slot_counts };
        applyIfLatest(value);
        return value;
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
        const value = { year, month, week_slot_counts: defaults };
        applyIfLatest(value);
        return value;
      }
    } catch (err) {
      console.error('Failed to load calendar slot settings:', err);
      const fallback = { year, month, week_slot_counts: { '0': 6, '1': 6, '2': 6, '3': 6, '4': 6 } };
      applyIfLatest(fallback);
      return fallback;
    }
  }, []);

  // 근무표 달력 주차별 슬롯 수 설정 저장
  const saveCalendarSlotSettings = useCallback(async (year, month, weekSlotCounts) => {
    const requestId = ++calendarSlotSettingsSaveRequestRef.current;
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
      if (calendarSlotSettingsSaveRequestRef.current === requestId) {
        calendarSlotSettingsLoadRequestRef.current += 1;
        setCalendarSlotSettings({ year, month, week_slot_counts: weekSlotCounts });
      }
      return true;
    } catch (err) {
      console.error('Failed to save calendar slot settings:', err);
      return false;
    }
  }, []);

  // 충격파 스케줄러 환경설정 저장
  const saveShockwaveSettings = useCallback(async (newSettings) => {
    const requestId = ++shockwaveSettingsSaveRequestRef.current;
    const { year: activeYear, month: activeMonth } = currentDateRef.current;
    const currentSettings = shockwaveSettingsRefCache.current;
    try {
      const nextUpdatedAt = new Date().toISOString();
      const { data: latestRow } = await supabase
        .from('shockwave_settings')
        .select('id')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const targetId = latestRow?.id || newSettings.id || currentSettings?.id || '00000000-0000-0000-0000-000000000000';

      const oldInterval = currentSettings?.interval_minutes || 20;
      const newInterval = newSettings.interval_minutes;
      if (oldInterval !== newInterval && Number.isFinite(oldInterval) && Number.isFinite(newInterval)) {
        console.info(
          '[ScheduleContext] shockwave interval setting changed. Migrating existing schedules to new interval...',
          { oldInterval, newInterval }
        );

        let allSchedules = [];
        let page = 0;
        let hasMore = true;
        while (hasMore) {
          const { data, error: fetchErr } = await supabase
            .from('shockwave_schedules')
            .select('*')
            .range(page * 1000, (page + 1) * 1000 - 1);
          if (fetchErr) throw fetchErr;
          if (data) allSchedules.push(...data);
          if (!data || data.length < 1000) hasMore = false;
          page++;
        }

        if (allSchedules.length > 0) {
          const updates = buildShockwaveIntervalRealignmentUpdates(allSchedules, newSettings);
          if (updates.length > 0) {
            const insertChunkSize = 200;
            
            // 1단계: UNIQUE 제약조건 충돌 방지를 위해 임시 격리 영역(row_index + 10000)으로 일시적 이동
            const tempUpdates = updates.map((item) => ({
              ...item,
              row_index: item.row_index + 10000,
            }));
            for (let i = 0; i < tempUpdates.length; i += insertChunkSize) {
              const chunk = tempUpdates.slice(i, i + insertChunkSize);
              const { error: tempUpsertErr } = await supabase
                .from('shockwave_schedules')
                .upsert(chunk, { onConflict: 'id' });
              if (tempUpsertErr) throw tempUpsertErr;
            }

            // 2단계: 최종 목적지인 원래의 새 row_index로 안전하게 이동
            for (let i = 0; i < updates.length; i += insertChunkSize) {
              const chunk = updates.slice(i, i + insertChunkSize);
              const { error: upsertErr } = await supabase
                .from('shockwave_schedules')
                .upsert(chunk, { onConflict: 'id' });
              if (upsertErr) throw upsertErr;
            }

            console.info(
              `[ScheduleContext] Successfully migrated ${updates.length} schedules to the new interval slots.`
            );
          }
        }
      }

      const basePayload = {
        id: targetId,
        start_time: newSettings.start_time,
        end_time: newSettings.end_time,
        interval_minutes: newSettings.interval_minutes,
        time_label_interval_minutes: newSettings.time_label_interval_minutes || newSettings.interval_minutes || 20,
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
        shortcuts: newSettings.shortcuts || {},
        manual_therapy_shortcuts: newSettings.manual_therapy_shortcuts || {},
        dose_tags: newSettings.dose_tags || {},
        manual_therapy_dose_tags: newSettings.manual_therapy_dose_tags || {},
        duration_minutes: newSettings.duration_minutes || {},
        manual_therapy_duration_minutes: newSettings.manual_therapy_duration_minutes || {},
        visit_line_break_prescriptions: newSettings.visit_line_break_prescriptions || [],
        manual_therapy_visit_line_break_prescriptions: newSettings.manual_therapy_visit_line_break_prescriptions || [],
        staff_schedule_block_rules: newSettings.staff_schedule_block_rules || {},
        updated_at: nextUpdatedAt
      };
      const payload = {
        ...basePayload,
        monthly_settlement_settings: {
          ...(newSettings.monthly_settlement_settings || {}),
          __schedule_display: {
            ...((newSettings.monthly_settlement_settings || {}).__schedule_display || {}),
            time_label_interval_minutes: newSettings.time_label_interval_minutes || newSettings.interval_minutes || 20,
          },
        }
      };

      const { error } = await supabase
        .from('shockwave_settings')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
        const missingOptionalColumn = /monthly_settlement_settings|staff_schedule_block_rules|dose_tags|manual_therapy_dose_tags|shortcuts|manual_therapy_shortcuts|duration_minutes|manual_therapy_duration_minutes|visit_line_break_prescriptions|manual_therapy_visit_line_break_prescriptions|time_label_interval_minutes|schema cache|column/i.test(message);
        if (!missingOptionalColumn) throw error;

        console.warn('Optional settings column is missing. Saving compatible global settings only.');
        const {
          staff_schedule_block_rules: _staff_schedule_block_rules,
          time_label_interval_minutes: _time_label_interval_minutes,
          shortcuts: _shortcuts,
          manual_therapy_shortcuts: _manual_therapy_shortcuts,
          dose_tags: _dose_tags,
          manual_therapy_dose_tags: _manual_therapy_dose_tags,
          duration_minutes: _duration_minutes,
          manual_therapy_duration_minutes: _manual_therapy_duration_minutes,
          visit_line_break_prescriptions: _visit_line_break_prescriptions,
          manual_therapy_visit_line_break_prescriptions: _manual_therapy_visit_line_break_prescriptions,
          ...compatiblePayload
        } = payload;
        const { error: retryError } = await supabase
          .from('shockwave_settings')
          .upsert(compatiblePayload, { onConflict: 'id' });
        if (retryError) throw retryError;
      }
      if (shockwaveSettingsSaveRequestRef.current === requestId) {
        shockwaveSettingsLoadRequestRef.current += 1;
        const updatedSettings = applyScheduleDeviceSettings({ ...newSettings, id: targetId, updated_at: nextUpdatedAt });
        
        // 태그 명칭 또는 처방별 시간(duration) 변경에 따른 일괄 동기화 마이그레이션 실행
        try {
          const oldSettings = currentSettings;
          if (oldSettings) {
            const tagMappings = [];

            // 도수치료 처방 태그 비교
            const oldMTTags = oldSettings.manual_therapy_dose_tags || {};
            const newMTTags = newSettings.manual_therapy_dose_tags || {};
            const mtPrescriptions = newSettings.manual_therapy_prescriptions || [];
            
            mtPrescriptions.forEach(p => {
              const oldT = oldMTTags[p];
              const newT = newMTTags[p];
              if (oldT && newT && oldT !== newT) {
                tagMappings.push({ oldTag: oldT, newTag: newT });
              }
            });

            // 충격파 처방 태그 비교
            const oldSWTags = oldSettings.dose_tags || {};
            const newSWTags = newSettings.dose_tags || {};
            const swPrescriptions = newSettings.prescriptions || [];

            swPrescriptions.forEach(p => {
              const oldT = oldSWTags[p];
              const newT = newSWTags[p];
              if (oldT && newT && oldT !== newT) {
                tagMappings.push({ oldTag: oldT, newTag: newT });
              }
            });

            if (tagMappings.length > 0) {
              const { data: schedules, error: fetchErr } = await supabase
                .from('shockwave_schedules')
                .select('*')
                .eq('year', activeYear)
                .eq('month', activeMonth);

              if (!fetchErr && schedules && schedules.length > 0) {
                const updatedSchedules = [];

                for (const s of schedules) {
                  let contentChanged = false;
                  let nextContent = s.content || '';

                  for (const mapping of tagMappings) {
                    const escapedOld = mapping.oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`([^/\\d\\s]+)${escapedOld}(\\s*\\(-?\\d*\\)|\\s*\\*)?$`, 'u');
                    if (regex.test(nextContent)) {
                      nextContent = nextContent.replace(regex, `$1${mapping.newTag}$2`);
                      contentChanged = true;
                    }
                  }

                  if (contentChanged) {
                    let targetRowSpan = 1;
                    const slotMinutes = newSettings.interval_minutes || 10;
                    const isMT = s.prescription && (newSettings.manual_therapy_prescriptions || []).includes(s.prescription);
                    const duration = isMT 
                      ? (newSettings.manual_therapy_duration_minutes?.[s.prescription] || 0)
                      : (newSettings.duration_minutes?.[s.prescription] || 0);

                    if (duration > 0) {
                      targetRowSpan = Math.ceil(duration / slotMinutes);
                    }
                    
                    if (slotMinutes === 10 && nextContent.trim() && nextContent.trim() !== '\u200B') {
                      targetRowSpan = Math.max(2, targetRowSpan);
                    }

                    const nextMergeSpan = {
                      ...(s.merge_span || { rowSpan: 1, colSpan: 1, mergedInto: null }),
                      rowSpan: targetRowSpan
                    };

                    updatedSchedules.push({
                      ...s,
                      content: nextContent,
                      merge_span: nextMergeSpan
                    });
                  }
                }

                if (updatedSchedules.length > 0) {
                  const upsertPayload = updatedSchedules.map(item => {
                    const copy = { ...item };
                    delete copy.created_at;
                    copy.updated_at = new Date().toISOString();
                    return copy;
                  });

                  await supabase
                    .from('shockwave_schedules')
                    .upsert(upsertPayload, { onConflict: 'year,month,week_index,day_index,row_index,col_index' });
                }
              }
            }
          }
        } catch (migrationErr) {
          console.error('Failed to run scheduler cell tag migration:', migrationErr);
        }

        // Ref 캐시도 즉시 갱신
        shockwaveSettingsRefCache.current = updatedSettings;
        setShockwaveSettings(updatedSettings);
      }
      
      // 설정 저장 완료 후 즉시 서버에서 메모를 강제 리로드하여 로컬 캐시를 동기화
      loadCacheRef.current.shockwaveMemos = null;
      loadShockwaveMemosRef.current?.(activeYear, activeMonth, { force: true });

      return true;
    } catch (err) {
      console.error('Failed to save shockwave settings:', err);
      return false;
    }
  }, []);

  // 충격파 스케줄 로드 (단일 쿼리 + 캐시 키)
  const loadShockwaveMemos = useCallback(async (year, month, options = {}) => {
    const cacheKey = `${year}-${month}`;
    if (!options.force && loadCacheRef.current.shockwaveMemos === cacheKey) {
      setShockwaveMemosLoadedKey(cacheKey);
      return shockwaveMemosRef.current;
    }
    loadCacheRef.current.shockwaveMemos = cacheKey;
    const requestId = ++shockwaveMemosLoadRequestRef.current;

    beginLoading();
    try {
      await waitForShockwaveWrites();

      const allData = [];
      const visibleMonths = getVisibleShockwaveScheduleMonths(year, month);
      for (const target of visibleMonths) {
        let page = 0;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase
            .from('shockwave_schedules')
            .select('*')
            .eq('year', target.year)
            .eq('month', target.month)
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
      }

      const memoMap = {};
      allData.forEach(item => {
        if (!shouldKeepShockwaveMemo(item)) return;
        const visibleItem = sanitizeShockwaveScheduleItemForDisplay(
          mapShockwaveScheduleItemToVisibleMonth(item, year, month)
        );
        if (!visibleItem) return;
        const key = `${visibleItem.week_index}-${visibleItem.day_index}-${visibleItem.row_index}-${visibleItem.col_index}`;
        const existing = memoMap[key];
        const existingTime = existing?.updated_at ? Date.parse(existing.updated_at) : 0;
        const nextTime = visibleItem?.updated_at ? Date.parse(visibleItem.updated_at) : 0;
        if (!existing || nextTime >= existingTime) memoMap[key] = visibleItem;
      });
      const reconciledMemoMap = options.skipLocalRecovery === true
        ? reconcileLoadedShockwaveMemosWithLocalWrites(memoMap)
        : mergeLoadedShockwaveMemosWithLocalRecovery(
            year,
            month,
            reconcileLoadedShockwaveMemosWithLocalWrites(memoMap)
          );
      if (loadCacheRef.current.shockwaveMemos !== cacheKey || shockwaveMemosLoadRequestRef.current !== requestId) return reconciledMemoMap;
      setShockwaveMemosLoadedKey(cacheKey);
      setShockwaveMemos(reconciledMemoMap);
      return reconciledMemoMap;
    } catch (err) {
      console.error('Failed to load shockwave memos:', err);
      if (shockwaveMemosLoadRequestRef.current === requestId) {
        loadCacheRef.current.shockwaveMemos = null;
      }
      return null;
    } finally {
      endLoading();
    }
  }, [waitForShockwaveWrites, shouldKeepShockwaveMemo, beginLoading, endLoading, reconcileLoadedShockwaveMemosWithLocalWrites, mergeLoadedShockwaveMemosWithLocalRecovery]);

  useEffect(() => {
    loadShockwaveMemosRef.current = loadShockwaveMemos;
  }, [loadShockwaveMemos]);

  const refreshCurrentScheduleFromServer = useCallback((reason = 'manual', options = {}) => {
    if (realtimeRefreshTimerRef.current) {
      clearTimeout(realtimeRefreshTimerRef.current);
    }

    realtimeRefreshTimerRef.current = setTimeout(() => {
      realtimeRefreshTimerRef.current = null;
      const { year, month } = currentDateRef.current;
      loadCacheRef.current.staffMemos = null;
      loadCacheRef.current.shockwaveMemos = null;

      Promise.allSettled([
        loadShockwaveMemos(year, month, { force: true, skipLocalRecovery: options.skipLocalRecovery === true }),
        loadStaffMemos(year, month, { force: true, includeAdjacentMonths: true }),
      ]).then((results) => {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            const target = index === 0 ? 'shockwave_schedules' : 'staff_schedules';
            console.error(`Failed to refresh ${target} after realtime ${reason}:`, result.reason);
          }
        });
      });
    }, 250);
  }, [loadShockwaveMemos, loadStaffMemos]);

  useEffect(() => () => {
    if (realtimeRefreshTimerRef.current) {
      clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshCurrentScheduleFromServer('visibility');
      }
    };
    const refreshWhenOnline = () => {
      refreshCurrentScheduleFromServer('online');
    };
    const refreshWhenFocused = () => {
      refreshCurrentScheduleFromServer('focus');
    };

    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenOnline);
    window.addEventListener('focus', refreshWhenFocused);

    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenOnline);
      window.removeEventListener('focus', refreshWhenFocused);
    };
  }, [refreshCurrentScheduleFromServer]);

  // 충격파 스케줄 저장
  const saveShockwaveMemo = useCallback(async (year, month, weekIndex, dayIndex, rowIndex, colIndex, content, bg_color, merge_span, prescription, body_part) => {
    const key = `${weekIndex}-${dayIndex}-${rowIndex}-${colIndex}`;
    return enqueueShockwaveWrite([key], async () => {
      const previousMemo = shockwaveMemosRef.current[key];
      let writeStartedAtMs = 0;
      const isWriteStillCurrent = () => {
        const currentLocalWrite = localShockwaveWriteTimeRef.current.get(key);
        if (!currentLocalWrite || !writeStartedAtMs) return true;
        const currentLocalWriteMs = new Date(currentLocalWrite).getTime();
        return !Number.isFinite(currentLocalWriteMs) || currentLocalWriteMs <= writeStartedAtMs;
      };
      try {
      const optimisticMemo = shockwaveMemosRef.current[key] || {};
      const nowStr = new Date().toISOString();
      writeStartedAtMs = new Date(nowStr).getTime();
      let upsertData = {
        year, month, week_index: weekIndex, day_index: dayIndex, row_index: rowIndex, col_index: colIndex,
        content: content !== undefined ? content : optimisticMemo.content,
        updated_at: nowStr
      };
      lastWriteTimeRef.current.set(key, nowStr);
      localShockwaveWriteTimeRef.current.set(key, nowStr);
      if (bg_color !== undefined) upsertData.bg_color = bg_color;
      if (merge_span !== undefined) upsertData.merge_span = merge_span;
      if (prescription !== undefined) upsertData.prescription = prescription;
      if (body_part !== undefined) upsertData.body_part = body_part;

      setShockwaveMemos(prev => {
        const updated = { ...optimisticMemo, ...upsertData };
        return applyShockwaveMemoStateUpdate(prev, key, updated, shouldKeepShockwaveMemo);
      });

      let canonicalUpsertData = canonicalizeShockwaveScheduleItemDate(upsertData);
      const canonicalKey = `${canonicalUpsertData.week_index}-${canonicalUpsertData.day_index}-${canonicalUpsertData.row_index}-${canonicalUpsertData.col_index}`;
      let savedCanonicalMemo = null;

      if (!shouldKeepShockwaveMemo(canonicalUpsertData)) {
        const { error } = await supabase
          .from('shockwave_schedules')
          .delete()
          .eq('year', canonicalUpsertData.year)
          .eq('month', canonicalUpsertData.month)
          .eq('week_index', canonicalUpsertData.week_index)
          .eq('day_index', canonicalUpsertData.day_index)
          .eq('row_index', canonicalUpsertData.row_index)
          .eq('col_index', canonicalUpsertData.col_index);

        if (error) throw error;
        rememberDeletedScheduleDraft(canonicalUpsertData.year, canonicalUpsertData.month, canonicalKey);
        savedCanonicalMemo = canonicalUpsertData;
      } else {
        [canonicalUpsertData] = await protectExistingScheduleContent([canonicalUpsertData], { [canonicalKey]: optimisticMemo });

        const { data, error } = await supabase
          .from('shockwave_schedules')
          .upsert([canonicalUpsertData], {
            onConflict: 'year,month,week_index,day_index,row_index,col_index'
          })
          .select();

        if (error) throw error;
        savedCanonicalMemo = data?.find(d => (
          d.year === canonicalUpsertData.year &&
          d.month === canonicalUpsertData.month &&
          d.week_index === canonicalUpsertData.week_index &&
          d.day_index === canonicalUpsertData.day_index &&
          d.row_index === canonicalUpsertData.row_index &&
          d.col_index === canonicalUpsertData.col_index
        )) || { ...optimisticMemo, ...canonicalUpsertData };
      }

      loadCacheRef.current.shockwaveMemos = null;
      const savedMemo = sanitizeShockwaveScheduleItemForDisplay(
        mapShockwaveScheduleItemToVisibleMonth(savedCanonicalMemo, year, month) || { ...optimisticMemo, ...upsertData }
      );
      if (isWriteStillCurrent() && savedCanonicalMemo?.updated_at) {
        lastWriteTimeRef.current.set(key, savedCanonicalMemo.updated_at);
        localShockwaveWriteTimeRef.current.set(key, savedCanonicalMemo.updated_at);
      }
      const nextShockwaveMemos = { ...shockwaveMemosRef.current, [key]: savedMemo };
      
      if (isWriteStillCurrent() && isCurrentScheduleMonth(year, month)) {
        setShockwaveMemos(prev => {
          const next = { ...prev };
          if (shouldKeepShockwaveMemo(savedMemo)) next[key] = savedMemo;
          else delete next[key];
          return next;
        });
      }

      const weeks = generateShockwaveCalendar(canonicalUpsertData.year, canonicalUpsertData.month);
      const dayInfo = weeks[canonicalUpsertData.week_index]?.[canonicalUpsertData.day_index];
      const targetDateStr = dayInfo && dayInfo.isCurrentMonth && canonicalUpsertData.year === year && canonicalUpsertData.month === month
        ? `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`
        : null;

      if (targetDateStr) {
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
        window.lastDbError = err;
        if (isWriteStillCurrent()) {
          setShockwaveMemos(prev => rollbackShockwaveMemoState(prev, { [key]: previousMemo }));
        }
        console.error('Failed to save shockwave memo:', err);
        return false;
      }
    });
  }, [therapists, manualTherapists, monthlyTherapists, monthlyManualTherapists, shouldKeepShockwaveMemo, protectExistingScheduleContent, enqueueShockwaveWrite, isCurrentScheduleMonth]);

  // 다중 셀 동시 업데이트 (병합/병합해제 등)
  const saveShockwaveMemosBulk = useCallback(async (memosArray, options = {}) => {
    if (!memosArray || memosArray.length === 0) return true;
    const { deferStatsSync = false, shouldApplyClientState } = options || {};
    const targetKeys = memosArray.map((item) => `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`);

    return enqueueShockwaveWrite(targetKeys, async () => {
      let previousMemos = {};
      let writeStartedAtMs = 0;
      const canApplyClientState = () => (
        typeof shouldApplyClientState === 'function'
          ? shouldApplyClientState() !== false
          : true
      );
      const isKeyWriteStillCurrent = (key) => {
        if (!canApplyClientState()) return false;
        const currentLocalWrite = localShockwaveWriteTimeRef.current.get(key);
        if (!currentLocalWrite || !writeStartedAtMs) return true;
        const currentLocalWriteMs = new Date(currentLocalWrite).getTime();
        return !Number.isFinite(currentLocalWriteMs) || currentLocalWriteMs <= writeStartedAtMs;
      };

      try {
      const currentMemosSnapshot = shockwaveMemosRef.current;
      const nowStr = new Date().toISOString();
      writeStartedAtMs = new Date(nowStr).getTime();
      const optimisticSnapshot = buildOptimisticShockwaveMemos(
        currentMemosSnapshot,
        memosArray,
        nowStr
      );
      previousMemos = optimisticSnapshot.previousMemos;
      if (canApplyClientState()) {
        targetKeys.forEach((key) => lastWriteTimeRef.current.set(key, nowStr));
        targetKeys.forEach((key) => localShockwaveWriteTimeRef.current.set(key, nowStr));
      }

      if (canApplyClientState()) {
        setShockwaveMemos(prev => {
          let next = prev;
          Object.entries(optimisticSnapshot.optimisticMemos).forEach(([key, value]) => {
            next = applyShockwaveMemoStateUpdate(next, key, value, shouldKeepShockwaveMemo);
          });
          return next;
        });
      }

      const canonicalMemosArray = memosArray.map((item) => canonicalizeShockwaveScheduleItemDate(item));
      const canonicalLocalSnapshot = { ...previousMemos };
      canonicalMemosArray.forEach((item, index) => {
        const originalKey = targetKeys[index];
        const canonicalKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        const localMemo = previousMemos[originalKey] || currentMemosSnapshot[originalKey];
        if (localMemo) canonicalLocalSnapshot[canonicalKey] = localMemo;
      });
      const intentionalClearKeys = new Set(canonicalMemosArray
        .filter((item) => item?.merge_span?.meta?.intentional_clear === true)
        .map((item) => `${item.year}-${item.month}-${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`));
      const guardedMemosArray = await protectExistingScheduleContent(canonicalMemosArray, canonicalLocalSnapshot);
      const sanitizedMemosArray = guardedMemosArray.map(({ merge_span, ...memo }) => {
        if (!merge_span?.meta?.intentional_clear) {
          return merge_span === undefined ? memo : { ...memo, merge_span };
        }
        const { intentional_clear: _intentionalClear, ...meta } = merge_span.meta;
        const nextMergeSpan = { ...merge_span };
        if (Object.keys(meta).length > 0) nextMergeSpan.meta = meta;
        else delete nextMergeSpan.meta;
        return { ...memo, merge_span: nextMergeSpan };
      });
      const clearPayloads = sanitizedMemosArray.filter((item) => {
        const key = `${item.year}-${item.month}-${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        return intentionalClearKeys.has(key);
      });
      const upsertPayloads = sanitizedMemosArray.map(m => ({
        ...m,
        updated_at: new Date().toISOString()
      }));
      const deletePayloads = clearPayloads;
      deletePayloads.forEach((item) => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        rememberDeletedScheduleDraft(item.year, item.month, key);
      });

      let data = [];
      if (upsertPayloads.length > 0) {
        const { data: upsertData, error } = await supabase
          .from('shockwave_schedules')
          .upsert(
            upsertPayloads,
            { onConflict: 'year,month,week_index,day_index,row_index,col_index' }
          )
          .select();

        if (error) throw error;
        data = upsertData || [];
      }

      const viewRelevantData = [
        ...data,
        ...clearPayloads,
      ]
        .map((item) => sanitizeShockwaveScheduleItemForDisplay(
          mapShockwaveScheduleItemToVisibleMonth(item, currentYear, currentMonth)
        ))
        .filter(Boolean);
      const currentViewRelevantData = canApplyClientState()
        ? viewRelevantData.filter((item) => {
            const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
            return isKeyWriteStillCurrent(key);
          })
        : [];
      loadCacheRef.current.shockwaveMemos = null;
      const nextShockwaveMemos = { ...shockwaveMemosRef.current };
      currentViewRelevantData.forEach(item => {
        const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
        if (item.updated_at) {
          lastWriteTimeRef.current.set(key, item.updated_at);
          localShockwaveWriteTimeRef.current.set(key, item.updated_at);
        }
        const fullKey = `${item.year}-${item.month}-${key}`;
        const merged = intentionalClearKeys.has(fullKey) ? item : { ...nextShockwaveMemos[key], ...item };
        if (shouldKeepShockwaveMemo(merged)) nextShockwaveMemos[key] = merged;
        else delete nextShockwaveMemos[key];
      });

      if (isCurrentScheduleMonth(currentYear, currentMonth)) {
        setShockwaveMemos(prev => {
          const next = { ...prev };
          currentViewRelevantData.forEach(item => {
            const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
            const fullKey = `${item.year}-${item.month}-${key}`;
            const merged = intentionalClearKeys.has(fullKey) ? item : { ...next[key], ...item };
            if (shouldKeepShockwaveMemo(merged)) next[key] = merged;
            else delete next[key];
          });
          return next;
        });
      }

      const weeks = generateShockwaveCalendar(currentYear, currentMonth);
      const affectedDates = new Set();
      
      sanitizedMemosArray.forEach((item) => {
        if (item.year !== currentYear || item.month !== currentMonth) return;
        const dayInfo = weeks[item.week_index]?.[item.day_index];
        if (dayInfo && dayInfo.isCurrentMonth) {
          const dateStr = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
          affectedDates.add(dateStr);
        }
      });

      const syncAffectedStats = async () => {
        for (const targetDateStr of affectedDates) {
        if (targetDateStr) {
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
      };

      if (!canApplyClientState()) {
        return true;
      }

      if (deferStatsSync) {
        setTimeout(() => {
          syncAffectedStats().catch((syncErr) => {
            console.error('Failed to sync deferred bulk schedule stats:', syncErr);
          });
        }, 0);
      } else {
        await syncAffectedStats();
      }
      return true;
    } catch (err) {
      window.lastDbError = err;
      const currentRollbackMemos = Object.fromEntries(
        Object.entries(previousMemos).filter(([key]) => isKeyWriteStillCurrent(key))
      );
      if (Object.keys(currentRollbackMemos).length > 0) {
        setShockwaveMemos(prev => rollbackShockwaveMemoState(prev, currentRollbackMemos));
      }
      console.error('Failed to save bulk shockwave memos:', err);
      return false;
      }
    });
  }, [currentYear, currentMonth, therapists, manualTherapists, monthlyTherapists, monthlyManualTherapists, shouldKeepShockwaveMemo, protectExistingScheduleContent, enqueueShockwaveWrite, isCurrentScheduleMonth]);

  // 월별 치료사 설정 로드 (type: 'shockwave' | 'manual_therapy')
  const loadMonthlyTherapists = useCallback(async (year, month, type = 'shockwave') => {
    const fallbackList = type === 'manual_therapy' ? manualTherapists : therapists;
    const setter = type === 'manual_therapy' ? setMonthlyManualTherapists : setMonthlyTherapists;
    const loadKey = `${year}-${month}`;
    if (monthlyTherapistLoadKeysRef.current[type] === loadKey) {
      const currentList = type === 'manual_therapy' ? monthlyManualTherapistsRef.current : monthlyTherapistsRef.current;
      if (currentList && currentList.length > 0) {
        return currentList;
      }
    }
    if (monthlyTherapistLoadKeysRef.current[type] !== loadKey) {
      setMonthlyTherapistLoadedKey(type, '');
      setter([]);
    }
    const requestId = (monthlyTherapistLoadRequestRef.current[type] || 0) + 1;
    monthlyTherapistLoadRequestRef.current[type] = requestId;
    const applyIfLatest = (rows) => {
      if (monthlyTherapistLoadRequestRef.current[type] === requestId) {
        setter(rows);
        setMonthlyTherapistLoadedKey(type, loadKey);
      }
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
      applyIfLatest([]);
      return [];
    }
  }, [therapists, manualTherapists, setMonthlyTherapistLoadedKey]);

  // 월별 치료사 설정 저장 (type: 'shockwave' | 'manual_therapy')
  const saveMonthlyTherapists = useCallback(async (year, month, configs, type = 'shockwave') => {
    const setter = type === 'manual_therapy' ? setMonthlyManualTherapists : setMonthlyTherapists;
    const requestId = (monthlyTherapistSaveRequestRef.current[type] || 0) + 1;
    monthlyTherapistSaveRequestRef.current[type] = requestId;
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

      if (monthlyTherapistSaveRequestRef.current[type] === requestId) {
        monthlyTherapistLoadRequestRef.current[type] += 1;
        setter(configs.map((c) => ({ ...c, year, month, type })));
        setMonthlyTherapistLoadedKey(type, `${year}-${month}`);
      }
      return true;
    } catch (err) {
      console.error(`Failed to save monthly therapists (${type}):`, err);
      return false;
    }
  }, [setMonthlyTherapistLoadedKey]);

  // 공지사항 로드/저장
  const loadNotices = useCallback(async (year = currentYear, month = currentMonth) => {
    const requestId = ++noticesLoadRequestRef.current;
    const monthPrefix = Number(year) * 10000 + Number(month) * 100;
    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .gte('slot_index', monthPrefix)
        .lt('slot_index', monthPrefix + 100)
        .order('slot_index');

      if (error) throw error;
      const normalized = (data || []).map((notice) => normalizeNoticeSlot(notice, year, month));
      if (noticesLoadRequestRef.current === requestId) {
        setNotices(normalized);
      }
      return normalized;
    } catch (err) {
      console.error('Failed to load notices:', err);
      return null;
    }
  }, [currentMonth, currentYear, normalizeNoticeSlot]);

  const saveNotice = useCallback(async (slotIndex, content, year = currentYear, month = currentMonth) => {
    const storageSlotIndex = getNoticeStorageSlot(year, month, slotIndex);
    const requestId = (noticeSaveRequestRef.current.get(storageSlotIndex) || 0) + 1;
    noticeSaveRequestRef.current.set(storageSlotIndex, requestId);
    const nextNotice = {
      slot_index: storageSlotIndex,
      content,
      updated_at: new Date().toISOString()
    };
    const displayNotice = normalizeNoticeSlot(nextNotice, year, month);
    try {
      setNotices((prev) => {
        const current = Array.isArray(prev) ? prev : [];
        const withoutSlot = current.filter((item) => item.slot_index !== slotIndex);
        return [...withoutSlot, displayNotice].sort((a, b) => Number(a.slot_index) - Number(b.slot_index));
      });

      const { error } = await supabase
        .from('notices')
        .upsert(nextNotice, { onConflict: 'slot_index' });

      if (error) throw error;
      if (noticeSaveRequestRef.current.get(storageSlotIndex) === requestId) {
        noticesLoadRequestRef.current += 1;
      }
      return true;
    } catch (err) {
      console.error('Failed to save notice:', err);
      return false;
    } finally {
      if (noticeSaveRequestRef.current.get(storageSlotIndex) === requestId) {
        noticeSaveRequestRef.current.delete(storageSlotIndex);
      }
    }
  }, [currentMonth, currentYear, getNoticeStorageSlot, normalizeNoticeSlot]);

  // Real-time synchronization
  useEffect(() => {
    const channel = supabase.channel(`schedule-realtime-${currentYear}-${currentMonth}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shockwave_schedules' },
        (payload) => {
          if (payload.new) {
            const item = sanitizeShockwaveScheduleItemForDisplay(
              mapShockwaveScheduleItemToVisibleMonth(payload.new, currentYear, currentMonth)
            );
            if (!item) return;
            const key = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
            if (shockwaveWriteQueueRef.current.has(key)) {
              refreshCurrentScheduleFromServer('shockwave-local-write', { skipLocalRecovery: true });
              return;
            }
            if (shouldIgnoreStaleShockwaveServerItem(key, item)) {
              refreshCurrentScheduleFromServer('shockwave-stale-guard', { skipLocalRecovery: true });
              return;
            }

            if (item.updated_at) {
              lastWriteTimeRef.current.set(key, item.updated_at);
            }

            setShockwaveMemos(prev => applyRealtimeShockwaveMemoUpdate(prev, key, item, shouldKeepShockwaveMemo));
            refreshCurrentScheduleFromServer('shockwave-event', { skipLocalRecovery: true });
          } else if (payload.old && payload.eventType === 'DELETE') {
            const deleteId = payload.old?.id;
            let targetKey = null;
            if (deleteId) {
              const currentMemos = shockwaveMemosRef.current || {};
              for (const [k, memo] of Object.entries(currentMemos)) {
                if (memo && memo.id === deleteId) {
                  targetKey = k;
                  break;
                }
              }
            }

            if (!targetKey) {
              const item = mapShockwaveScheduleItemToVisibleMonth(payload.old, currentYear, currentMonth);
              if (item) {
                targetKey = `${item.week_index}-${item.day_index}-${item.row_index}-${item.col_index}`;
              }
            }

            if (targetKey) {
              if (shockwaveWriteQueueRef.current.has(targetKey)) return;

              setShockwaveMemos(prev => {
                const next = { ...prev };
                delete next[targetKey];
                return next;
              });
              refreshCurrentScheduleFromServer('shockwave-delete', { skipLocalRecovery: true });
            } else {
              refreshCurrentScheduleFromServer('shockwave-delete-unmapped', { skipLocalRecovery: true });
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
            refreshCurrentScheduleFromServer('staff-event', { skipLocalRecovery: true });
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
              refreshCurrentScheduleFromServer('staff-delete', { skipLocalRecovery: true });
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          refreshCurrentScheduleFromServer('subscribed');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Schedule realtime ${status}; refreshing current month from database.`);
          refreshCurrentScheduleFromServer(status.toLowerCase());
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentYear, currentMonth, shouldKeepShockwaveMemo, shouldIgnoreStaleShockwaveServerItem, refreshCurrentScheduleFromServer]);

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
      shockwaveSettings, loadShockwaveSettings, saveShockwaveSettings, saveShockwaveDeviceScheduleSettings,
      shockwaveMemos, shockwaveMemosLoadedKey, loadShockwaveMemos, saveShockwaveMemo, saveShockwaveMemosBulk,
      monthlyTherapists, monthlyManualTherapists, monthlyTherapistLoadKeys, loadMonthlyTherapists, saveMonthlyTherapists,
      notices, loadNotices, saveNotice,
      calendarSlotSettings, loadCalendarSlotSettings, saveCalendarSlotSettings,
      loading,
      clipboardRef, clipboardSource, setClipboardSource
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export const useSchedule = () => useContext(ScheduleContext);
