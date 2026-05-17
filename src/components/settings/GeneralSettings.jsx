import { useState, useEffect } from 'react';
import { Sun, Moon, Database, Copy } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../common/Toast';
import { useTheme } from '../../contexts/ThemeContext';
import { useSchedule } from '../../contexts/ScheduleContext';
import { SQL_SETUP_SCRIPT, DB_USAGE_CHECK_SQL } from '../../lib/sqlSnippets';

export default function GeneralSettings() {
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const { saveShockwaveSettings } = useSchedule();
  
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  
  const [swSettings, setSwSettings] = useState({ 
    id: '00000000-0000-0000-0000-000000000000',
    start_time: '09:00', 
    end_time: '18:00', 
    interval_minutes: 10,
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

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('shockwave_settings').select('*').order('updated_at', { ascending: false }).limit(1).single();
      if (!error && data) {
        setSwSettings({
          id: data.id || '00000000-0000-0000-0000-000000000000',
          start_time: data.start_time.substring(0, 5),
          end_time: data.end_time.substring(0, 5),
          interval_minutes: data.interval_minutes,
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
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleSaveSettings = async () => {
    const success = await saveShockwaveSettings({
      id: swSettings.id,
      start_time: swSettings.start_time + ':00',
      end_time: swSettings.end_time + ':00',
      interval_minutes: Number(swSettings.interval_minutes),
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
    });
    if (success) addToast('시간표 설정이 저장되었습니다.', 'success');
  };

  const loadHolidays = async () => {
    const { data } = await supabase
      .from('holidays')
      .select('*')
      .order('date', { ascending: false });
    setHolidays(data || []);
  };

  useEffect(() => {
    loadHolidays();
    loadSettings();
  }, []);

  const addHoliday = async () => {
    if (!newHoliday.date) return;
    const { error } = await supabase.from('holidays').insert({
      date: newHoliday.date,
      name: newHoliday.name.trim() || null
    });
    if (error) { addToast('추가 실패: ' + error.message, 'error'); return; }
    addToast('공휴일이 추가되었습니다', 'success');
    setNewHoliday({ date: '', name: '' });
    loadHolidays();
  };

  const removeHoliday = async (id) => {
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (!error) { addToast('삭제되었습니다', 'success'); loadHolidays(); }
  };

  return (
    <>
      {/* 테마 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">{theme === 'light' ? <Sun size={18} /> : <Moon size={18} />} 테마 설정</span>
        </div>
        <div className="card-body">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">다크 모드</div>
              <div className="settings-row-desc">어두운 테마로 전환합니다</div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={toggleTheme}>
              {theme === 'light' ? '다크 모드로' : '라이트 모드로'}
            </button>
          </div>
        </div>
      </div>

      {/* 충격파 시간표 관리 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">⏰ 스케줄 시간표 기본 설정</span>
        </div>
        <div className="card-body">
          <div className="settings-row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="settings-row-label">시작 시간</span>
              <input type="time" className="form-input" style={{ width: 120 }} value={swSettings.start_time} onChange={e => setSwSettings(p => ({ ...p, start_time: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="settings-row-label">종료 시간</span>
              <input type="time" className="form-input" style={{ width: 120 }} value={swSettings.end_time} onChange={e => setSwSettings(p => ({ ...p, end_time: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="settings-row-label">시간 단위</span>
              <select className="form-input" style={{ width: 100 }} value={swSettings.interval_minutes} onChange={e => setSwSettings(p => ({ ...p, interval_minutes: Number(e.target.value) }))}>
                <option value={10}>10분</option>
                <option value={15}>15분</option>
                <option value={20}>20분</option>
                <option value={30}>30분</option>
                <option value={60}>60분(1시간)</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={handleSaveSettings}>적용 및 저장</button>
          </div>
          <div className="settings-row" style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-color-light)' }}>
            <div>
              <div className="settings-row-label">🧊 고정 컬럼 개수</div>
              <div className="settings-row-desc">가로 스크롤 시 왼쪽에 고정할 열의 개수를 지정합니다. (기본 6: #, 날짜, 이름, 차트번호, 회차, 부위)</div>
            </div>
            <input 
              type="number" 
              className="form-input" 
              style={{ width: 80 }} 
              min={0} max={10} 
              value={swSettings.frozen_columns} 
              onChange={e => setSwSettings(p => ({ ...p, frozen_columns: parseInt(e.target.value) || 0 }))} 
            />
          </div>

          <div style={{ textAlign: 'right', marginTop: 24 }}>
            <button className="btn btn-primary" onClick={handleSaveSettings}>환경설정 저장</button>
          </div>
        </div>
      </div>

      {/* 공휴일 관리 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title"><Database size={18} /> 공휴일 관리</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 140 }}
              type="date"
              value={newHoliday.date}
              onChange={e => setNewHoliday(p => ({ ...p, date: e.target.value }))}
            />
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 120 }}
              placeholder="공휴일 이름 (선택)"
              value={newHoliday.name}
              onChange={e => setNewHoliday(p => ({ ...p, name: e.target.value }))}
            />
            <button className="btn btn-primary btn-sm" onClick={addHoliday}>추가</button>
          </div>

          <div
            style={{
              maxHeight: 320,
              overflowY: holidays.length > 5 ? 'auto' : 'visible',
              paddingRight: holidays.length > 5 ? 6 : 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {holidays.map(h => (
              <div key={h.id} className="settings-row" style={{ margin: 0 }}>
                <div>
                  <div className="settings-row-label">{h.date}</div>
                  <div className="settings-row-desc">{h.name || '(이름 없음)'}</div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => removeHoliday(h.id)}>삭제</button>
              </div>
            ))}
          </div>

          {holidays.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>
              등록된 공휴일이 없습니다
            </p>
          )}
        </div>
      </div>

      {/* DB 용량 확인 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title"><Database size={18} /> DB 용량 확인</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={openSupabaseDashboard}
            >
              Supabase 열기
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleCopySQL(DB_USAGE_CHECK_SQL)}
            >
              <Copy size={14} />
              용량 확인 SQL 복사
            </button>
          </div>
        </div>
        <div className="card-body">
          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)',
            }}
          >
            <div
              style={{
                border: '1px solid var(--border-color-light)',
                borderRadius: 16,
                padding: '16px 18px',
                background: 'var(--bg-tertiary)',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>확인 순서</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dbUsageChecklist.map((item, index) => (
                  <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--text-secondary)' }}>
                    <span style={{ minWidth: 20, fontWeight: 800, color: 'var(--primary)' }}>{index + 1}.</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>SQL Editor에서 실행할 코드</div>
              <textarea
                readOnly
                value={DB_USAGE_CHECK_SQL}
                style={{
                  width: '100%',
                  minHeight: 240,
                  borderRadius: 16,
                  border: '1px solid var(--border-color-light)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  padding: 16,
                  fontSize: 13,
                  lineHeight: 1.55,
                  resize: 'vertical',
                }}
              />
              <div style={{ marginTop: 10, color: 'var(--text-tertiary)', fontSize: 13 }}>
                앱 안에서 직접 숫자를 표시하려면 Supabase에 조회용 함수 생성이 추가로 필요합니다. 지금은 설정 탭에서 바로 복사하고 실행할 수 있게 구성했습니다.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <span className="card-title"><Copy size={18} /> 전체 SQL 스크립트</span>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => handleCopySQL(SQL_SETUP_SCRIPT)}
          >
            <Copy size={14} />
            전체 복사
          </button>
        </div>
        <div className="card-body">
          <textarea
            readOnly
            value={SQL_SETUP_SCRIPT}
            style={{
              width: '100%',
              minHeight: 220,
              borderRadius: 10,
              padding: 12,
              fontFamily: 'Consolas, Menlo, monospace',
              fontSize: '0.78rem',
              border: '1px solid var(--border-color)'
            }}
          />
          <p style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            위 전체 SQL을 복사하면 필요한 테이블과 기본 데이터를 한 번에 생성할 수 있습니다.
          </p>
        </div>
      </div>
    </>
  );
}
