import { useRef, useState, useEffect } from 'react';
import {
  CalendarDays,
  Clock3,
  Code2,
  Copy,
  Database,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../common/Toast';
import { useSchedule } from '../../contexts/ScheduleContext';
import { SQL_SETUP_SCRIPT, DB_USAGE_CHECK_SQL } from '../../lib/sqlSnippets';
import { loadScheduleDeviceSettings } from '../../lib/scheduleDeviceSettings';
import {
  buildHolidayUpdateRequest,
  getHolidayEditDraft,
} from '../../lib/holidaySettingsUtils';

const SHOCKWAVE_SETTINGS_BACKUP_KEY = 'abs.shockwaveSettingsBackup.v1';

export default function GeneralSettings() {
  const { addToast } = useToast();
  const {
    currentYear,
    currentMonth,
    loadShockwaveMemos,
    loadShockwaveSettings,
    loadHolidays: reloadScheduleHolidays,
    saveShockwaveSettings,
    saveShockwaveDeviceScheduleSettings,
    shockwaveMemos,
  } = useSchedule();
  const globalScheduleIntervalRef = useRef({
    interval_minutes: 20,
    time_label_interval_minutes: 20,
  });
  
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [savingHolidayId, setSavingHolidayId] = useState(null);
  
  const [swSettings, setSwSettings] = useState({ 
    id: '00000000-0000-0000-0000-000000000000',
    start_time: '09:00', 
    end_time: '18:00', 
    interval_minutes: 20,
    time_label_interval_minutes: 20,
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
    day_overrides: {},
    date_overrides: {},
    staff_schedule_block_rules: {},
    monthly_settlement_settings: {},
  });

  const dbUsageChecklist = [
    'Supabase 프로젝트 > SQL Editor > New query 에서 실행',
    '첫 번째 결과의 percent_of_free_limit 확인',
    '70% 이상이면 정리 계획 시작, 90% 근처면 정리 필요',
    '핵심 테이블은 shockwave_patient_logs, manual_therapy_patient_logs, shockwave_schedules, staff_schedules',
  ];

  const handleCopySQL = async (sql) => {
    if (!navigator?.clipboard) {
      addToast('복사 실패: 브라우저가 클립보드를 지원하지 않습니다.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(sql);
      addToast('SQL 코드가 클립보드에 복사되었습니다.', 'success');
    } catch {
      addToast('복사 실패: 클립보드 접근 권한이 필요합니다.', 'error');
    }
  };

  const openSupabaseDashboard = () => {
    window.open('https://supabase.com/dashboard', '_blank', 'noopener,noreferrer');
  };

  const backupCurrentScheduleBeforeSettingsSave = () => {
    if (typeof window === 'undefined') return true;
    try {
      const snapshot = {
        created_at: new Date().toISOString(),
        year: currentYear,
        month: currentMonth,
        settings: swSettings,
        schedule_memos: shockwaveMemos || {},
      };
      window.localStorage.setItem(SHOCKWAVE_SETTINGS_BACKUP_KEY, JSON.stringify(snapshot));
      window.__lastShockwaveSettingsBackup = snapshot;
      return true;
    } catch (error) {
      console.error('Failed to create shockwave settings backup:', error);
      return false;
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('shockwave_settings').select('*').order('updated_at', { ascending: false }).limit(1).single();
      if (!error && data) {
        const globalIntervals = {
          interval_minutes: data.interval_minutes || 20,
          time_label_interval_minutes: data.time_label_interval_minutes
            || data.monthly_settlement_settings?.__schedule_display?.time_label_interval_minutes
            || data.interval_minutes
            || 20,
        };
        const deviceIntervals = loadScheduleDeviceSettings(globalIntervals);
        globalScheduleIntervalRef.current = globalIntervals;
        setSwSettings({
          id: data.id || '00000000-0000-0000-0000-000000000000',
          start_time: data.start_time.substring(0, 5),
          end_time: data.end_time.substring(0, 5),
          interval_minutes: globalIntervals.interval_minutes,
          time_label_interval_minutes: deviceIntervals.time_label_interval_minutes,
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
          day_overrides: data.day_overrides || {},
          date_overrides: data.date_overrides || {},
          staff_schedule_block_rules: data.staff_schedule_block_rules || {},
          monthly_settlement_settings: data.monthly_settlement_settings || {},
          shortcuts: data.shortcuts || {},
          manual_therapy_shortcuts: data.manual_therapy_shortcuts || {},
          dose_tags: data.dose_tags || {},
          manual_therapy_dose_tags: data.manual_therapy_dose_tags || {},
          duration_minutes: data.duration_minutes || {},
          manual_therapy_duration_minutes: data.manual_therapy_duration_minutes || {},
          visit_line_break_prescriptions: data.visit_line_break_prescriptions || [],
          manual_therapy_visit_line_break_prescriptions: data.manual_therapy_visit_line_break_prescriptions || [],
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleSaveSettings = async () => {
    const backupOk = backupCurrentScheduleBeforeSettingsSave();
    if (!backupOk) {
      addToast('저장 전 로컬 백업을 만들지 못했습니다. 저장을 중단했습니다.', 'error');
      return;
    }

    const globalIntervals = globalScheduleIntervalRef.current || {};
    const nextSharedInterval = Number(swSettings.interval_minutes) || Number(globalIntervals.interval_minutes) || 20;
    const nextDeviceTimeLabelInterval = Number(swSettings.time_label_interval_minutes) || nextSharedInterval;

    const success = await saveShockwaveSettings({
      id: swSettings.id,
      start_time: swSettings.start_time + ':00',
      end_time: swSettings.end_time + ':00',
      interval_minutes: nextSharedInterval,
      time_label_interval_minutes: nextDeviceTimeLabelInterval,
      day_overrides: swSettings.day_overrides || {},
      date_overrides: swSettings.date_overrides || {},
      prescriptions: swSettings.prescriptions,
      manual_therapy_prescriptions: swSettings.manual_therapy_prescriptions,
      prescription_prices: swSettings.prescription_prices,
      prescription_colors: swSettings.prescription_colors,
      incentive_percentage: Number(swSettings.incentive_percentage) || 0,
      manual_therapy_incentive_percentage: Number(swSettings.manual_therapy_incentive_percentage) || 0,
      frozen_columns: Number(swSettings.frozen_columns),
      staff_schedule_block_rules: swSettings.staff_schedule_block_rules || {},
      monthly_settlement_settings: swSettings.monthly_settlement_settings || {},
      shortcuts: swSettings.shortcuts || {},
      manual_therapy_shortcuts: swSettings.manual_therapy_shortcuts || {},
      dose_tags: swSettings.dose_tags || {},
      manual_therapy_dose_tags: swSettings.manual_therapy_dose_tags || {},
      duration_minutes: swSettings.duration_minutes || {},
      manual_therapy_duration_minutes: swSettings.manual_therapy_duration_minutes || {},
      visit_line_break_prescriptions: swSettings.visit_line_break_prescriptions || [],
      manual_therapy_visit_line_break_prescriptions: swSettings.manual_therapy_visit_line_break_prescriptions || [],
    });
    if (success) {
      // 기기별 시간열 설정은 DB 저장 성공 후에 적용 (이벤트 디스패치 경합 방지)
      saveShockwaveDeviceScheduleSettings?.({
        time_label_interval_minutes: nextDeviceTimeLabelInterval,
      });
      globalScheduleIntervalRef.current = {
        interval_minutes: nextSharedInterval,
        time_label_interval_minutes: nextDeviceTimeLabelInterval,
      };
      await Promise.allSettled([
        loadShockwaveSettings?.({ force: true }),
        loadShockwaveMemos?.(currentYear, currentMonth, { force: true }),
      ]);
      // DB에서 다시 읽어 UI 폼 상태도 갱신
      await loadSettings();
      addToast('시간표 설정이 저장되었습니다. 기본 병합은 전체 기기에 공통 적용되고, 시간열 표시는 이 기기에만 적용됩니다.', 'success');
    } else {
      addToast('설정 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  };

  const loadHolidayList = async () => {
    const { data } = await supabase
      .from('holidays')
      .select('*')
      .order('date', { ascending: false });
    setHolidays(data || []);
  };

  useEffect(() => {
    loadHolidayList();
    loadSettings();
  }, []);

  const refreshHolidayData = async () => {
    await Promise.allSettled([
      loadHolidayList(),
      reloadScheduleHolidays?.(currentYear, currentMonth, { force: true }),
    ]);
  };

  const addHoliday = async () => {
    if (!newHoliday.date) return;
    const { error } = await supabase.from('holidays').insert({
      date: newHoliday.date,
      name: newHoliday.name.trim() || null
    });
    if (error) { addToast('추가 실패: ' + error.message, 'error'); return; }
    addToast('공휴일이 추가되었습니다', 'success');
    setNewHoliday({ date: '', name: '' });
    await refreshHolidayData();
  };

  const startHolidayEdit = (holiday) => {
    setEditingHoliday(getHolidayEditDraft(holiday));
  };

  const cancelHolidayEdit = () => {
    if (savingHolidayId) return;
    setEditingHoliday(null);
  };

  const updateHoliday = async () => {
    const request = buildHolidayUpdateRequest(editingHoliday, holidays);
    if (!request.ok) {
      addToast(request.message, 'error');
      return;
    }

    setSavingHolidayId(request.id);
    try {
      const { error } = await supabase
        .from('holidays')
        .update(request.payload)
        .eq('id', request.id);
      if (error) {
        addToast('수정 실패: ' + error.message, 'error');
        return;
      }

      setEditingHoliday(null);
      addToast('공휴일이 수정되었습니다', 'success');
      await refreshHolidayData();
    } catch (error) {
      addToast(`수정 실패: ${error?.message || '알 수 없는 오류'}`, 'error');
    } finally {
      setSavingHolidayId(null);
    }
  };

  const removeHoliday = async (id) => {
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (error) {
      addToast('삭제 실패: ' + error.message, 'error');
      return;
    }
    if (editingHoliday?.id === String(id)) setEditingHoliday(null);
    addToast('삭제되었습니다', 'success');
    await refreshHolidayData();
  };

  return (
    <>
      {/* 충격파 시간표 관리 */}
      <div className="card settings-card schedule-settings-card">
        <div className="card-header">
          <div>
            <span className="card-title"><Clock3 size={18} /> 스케줄 시간표</span>
            <p className="settings-card-description">운영 시간과 표의 기본 표시 방식을 설정합니다.</p>
          </div>
        </div>
        <div className="card-body">
          <div className="schedule-settings-grid">
            <label className="settings-control">
              <span>시작 시간</span>
              <input type="time" className="form-input" value={swSettings.start_time} onChange={e => setSwSettings(p => ({ ...p, start_time: e.target.value }))} />
            </label>
            <label className="settings-control">
              <span>종료 시간</span>
              <input type="time" className="form-input" value={swSettings.end_time} onChange={e => setSwSettings(p => ({ ...p, end_time: e.target.value }))} />
            </label>
            <label className="settings-control">
              <span>기본 병합</span>
              <select className="form-input" value={swSettings.interval_minutes} onChange={e => setSwSettings(p => ({ ...p, interval_minutes: Number(e.target.value) }))}>
                <option value={10}>10분</option>
                <option value={15}>15분</option>
                <option value={20}>20분</option>
                <option value={30}>30분</option>
                <option value={60}>60분(1시간)</option>
              </select>
            </label>
            <label className="settings-control">
              <span>시간열 표시</span>
              <select className="form-input" value={swSettings.time_label_interval_minutes} onChange={e => setSwSettings(p => ({ ...p, time_label_interval_minutes: Number(e.target.value) }))}>
                <option value={10}>10분</option>
                <option value={15}>15분</option>
                <option value={20}>20분</option>
                <option value={30}>30분</option>
                <option value={60}>60분(1시간)</option>
              </select>
            </label>
            <label className="settings-control">
              <span>고정 컬럼 수</span>
              <input
                type="number"
                className="form-input"
                min={0}
                max={10}
                value={swSettings.frozen_columns}
                onChange={e => setSwSettings(p => ({ ...p, frozen_columns: parseInt(e.target.value) || 0 }))}
              />
            </label>
          </div>

          <div className="settings-card-footer">
            <p>
              기본 병합은 모든 기기에 공통 적용되고, 시간열 표시는 이 기기에만 적용됩니다.
              고정 컬럼 기본값은 6개입니다.
            </p>
            <button className="btn btn-primary" onClick={handleSaveSettings}>
              <Save size={16} />
              설정 저장
            </button>
          </div>
        </div>
      </div>

      {/* 공휴일 관리 */}
      <div className="card settings-card holiday-settings-card">
        <div className="card-header">
          <div>
            <span className="card-title"><CalendarDays size={18} /> 공휴일 관리</span>
            <p className="holiday-settings-summary">근무표와 스케줄에 표시할 공휴일을 관리합니다.</p>
          </div>
        </div>
        <div className="card-body">
          <form
            className="holiday-settings-create"
            onSubmit={(event) => {
              event.preventDefault();
              addHoliday();
            }}
          >
            <div className="holiday-settings-create-title">새 공휴일 추가</div>
            <div className="holiday-settings-create-fields">
              <label className="holiday-settings-field">
                <span className="holiday-settings-field-label">날짜</span>
                <input
                  className="form-input"
                  type="date"
                  required
                  value={newHoliday.date}
                  onChange={event => setNewHoliday(prev => ({
                    ...prev,
                    date: event.target.value,
                  }))}
                />
              </label>
              <label className="holiday-settings-field">
                <span className="holiday-settings-field-label">공휴일 이름</span>
                <input
                  className="form-input"
                  placeholder="예: 광복절"
                  value={newHoliday.name}
                  onChange={event => setNewHoliday(prev => ({
                    ...prev,
                    name: event.target.value,
                  }))}
                />
              </label>
              <button className="btn btn-primary btn-sm holiday-settings-add-button" type="submit">
                <Plus size={15} />
                추가
              </button>
            </div>
          </form>

          <div className="holiday-settings-list-header">
            <span>등록된 공휴일</span>
            <span className="holiday-settings-count">{holidays.length}개</span>
          </div>

          <div className={`holiday-settings-list${holidays.length > 5 ? ' holiday-settings-list--scrollable' : ''}`}>
            {holidays.map(h => {
              const isEditing = editingHoliday?.id === String(h.id);
              const isSaving = savingHolidayId === String(h.id);
              return (
                <div
                  key={h.id}
                  className={`settings-row holiday-settings-row${isEditing ? ' holiday-settings-row--editing' : ''}`}
                  style={{ margin: 0 }}
                >
                  {isEditing ? (
                    <>
                      <form
                        className="holiday-settings-edit-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          updateHoliday();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelHolidayEdit();
                          }
                        }}
                      >
                        <div className="holiday-settings-edit-fields">
                          <label className="holiday-settings-field">
                            <span className="holiday-settings-field-label">날짜</span>
                            <input
                              className="form-input"
                              type="date"
                              value={editingHoliday.date}
                              disabled={isSaving}
                              onChange={event => setEditingHoliday(prev => ({
                                ...prev,
                                date: event.target.value,
                              }))}
                            />
                          </label>
                          <label className="holiday-settings-field">
                            <span className="holiday-settings-field-label">공휴일 이름</span>
                            <input
                              className="form-input"
                              placeholder="공휴일 이름 (선택)"
                              value={editingHoliday.name}
                              disabled={isSaving}
                              onChange={event => setEditingHoliday(prev => ({
                                ...prev,
                                name: event.target.value,
                              }))}
                            />
                          </label>
                        </div>
                        <div className="holiday-settings-actions">
                          <button
                            type="submit"
                            className="btn btn-primary btn-sm"
                            disabled={isSaving}
                          >
                            <Save size={14} />
                            {isSaving ? '저장 중...' : '저장'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={isSaving}
                            onClick={cancelHolidayEdit}
                          >
                            <X size={14} />
                            취소
                          </button>
                        </div>
                      </form>
                    </>
                  ) : (
                    <>
                      <div className="holiday-settings-info">
                        <div className="settings-row-label">{h.date}</div>
                        <div className="settings-row-desc">{h.name || '(이름 없음)'}</div>
                      </div>
                      <div className="holiday-settings-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => startHolidayEdit(h)}
                        >
                          <Pencil size={14} />
                          수정
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeHoliday(h.id)}
                        >
                          <Trash2 size={14} />
                          삭제
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {holidays.length === 0 && (
            <p className="holiday-settings-empty">
              등록된 공휴일이 없습니다
            </p>
          )}
        </div>
      </div>

      {/* DB 용량 확인 */}
      <details className="card settings-card settings-disclosure">
        <summary className="settings-disclosure-summary">
          <span className="settings-disclosure-icon"><Database size={18} /></span>
          <span>
            <strong>DB 용량 확인</strong>
            <small>Supabase 저장 용량을 점검할 때 사용합니다.</small>
          </span>
          <span className="settings-disclosure-hint">열기</span>
        </summary>
        <div className="card-body settings-disclosure-body">
          <div className="settings-inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={openSupabaseDashboard}>
              Supabase 열기
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCopySQL(DB_USAGE_CHECK_SQL)}>
              <Copy size={14} />
              용량 확인 SQL 복사
            </button>
          </div>

          <div className="db-usage-grid">
            <div className="db-usage-checklist">
              <div className="settings-subtitle">확인 순서</div>
              <div className="db-usage-steps">
                {dbUsageChecklist.map((item, index) => (
                  <div key={item}>
                    <span>{index + 1}</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-code-panel">
              <div className="settings-subtitle">SQL Editor에서 실행할 코드</div>
              <textarea
                className="settings-code-textarea"
                readOnly
                value={DB_USAGE_CHECK_SQL}
              />
              <div className="settings-help-text">
                앱 안에서 직접 숫자를 표시하려면 Supabase에 조회용 함수 생성이 추가로 필요합니다. 지금은 설정 탭에서 바로 복사하고 실행할 수 있게 구성했습니다.
              </div>
            </div>
          </div>
        </div>
      </details>

      <details className="card settings-card settings-disclosure">
        <summary className="settings-disclosure-summary">
          <span className="settings-disclosure-icon"><Code2 size={18} /></span>
          <span>
            <strong>전체 SQL 스크립트</strong>
            <small>초기 테이블과 기본 데이터 생성용 고급 도구입니다.</small>
          </span>
          <span className="settings-disclosure-hint">열기</span>
        </summary>
        <div className="card-body settings-disclosure-body">
          <div className="settings-inline-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => handleCopySQL(SQL_SETUP_SCRIPT)}>
              <Copy size={14} />
              전체 복사
            </button>
          </div>
          <textarea
            className="settings-code-textarea settings-code-textarea--large"
            readOnly
            value={SQL_SETUP_SCRIPT}
          />
          <p className="settings-help-text">
            위 전체 SQL을 복사하면 필요한 테이블과 기본 데이터를 한 번에 생성할 수 있습니다.
          </p>
        </div>
      </details>
    </>
  );
}
