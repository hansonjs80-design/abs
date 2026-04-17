import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../components/common/Toast';
import { supabase } from '../lib/supabaseClient';
import { useSchedule } from '../contexts/ScheduleContext';
import { Sun, Moon, Database, Users, Shield, RefreshCw, Copy } from 'lucide-react';

const SQL_SNIPPETS = [
  {
    title: '충격파 설정 테이블',
    description: '기본 시간, 간격 그리고 요일별 오버라이드 정보 저장.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time time NOT NULL DEFAULT '09:00:00',
  end_time time NOT NULL DEFAULT '18:00:00',
  interval_minutes int NOT NULL DEFAULT 10,
  day_overrides jsonb NOT NULL DEFAULT '{}',
  prescriptions text[] DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'],
  manual_therapy_prescriptions text[] DEFAULT ARRAY['40분', '60분'],
  prescription_prices jsonb NOT NULL DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb,
  incentive_percentage numeric(5,2) NOT NULL DEFAULT 7,
  manual_therapy_incentive_percentage numeric(5,2) NOT NULL DEFAULT 0,
  frozen_columns int DEFAULT 6,
  prescription_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shockwave_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS day_overrides jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescriptions text[] DEFAULT ARRAY['F1.5', 'F/Rdc', 'F/R'];
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_prescriptions text[] DEFAULT ARRAY['40분', '60분'];
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescription_prices jsonb NOT NULL DEFAULT '{"F1.5":50000,"F/Rdc":70000,"F/R":80000}'::jsonb;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS incentive_percentage numeric(5,2) NOT NULL DEFAULT 7;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS manual_therapy_incentive_percentage numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS frozen_columns int DEFAULT 6;
ALTER TABLE public.shockwave_settings ADD COLUMN IF NOT EXISTS prescription_colors jsonb NOT NULL DEFAULT '{}'::jsonb;`
  },
  {
    title: '치료사 목록 테이블',
    description: '스케줄러에 나열할 치료사 이름과 순서를 관리.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slot_index int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shockwave_therapists DISABLE ROW LEVEL SECURITY;`
  },
  {
    title: '도수치료 치료사 목록 테이블',
    description: '도수치료 현황 탭에 나열할 치료사 이름과 순서를 관리.',
    sql: `CREATE TABLE IF NOT EXISTS public.manual_therapy_therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slot_index int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_therapy_therapists DISABLE ROW LEVEL SECURITY;`
  },
  {
    title: '통합 충격파 스케줄 테이블',
    description: '스케줄러의 셀 내용, 배경색, 병합(JSON) 정보를 저장합니다.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL,
  week_index int NOT NULL,
  day_index int NOT NULL,
  row_index int NOT NULL,
  col_index int NOT NULL,
  content text,
  bg_color text,
  prescription text,
  merge_span jsonb DEFAULT '{"rowSpan": 1, "colSpan": 1, "mergedInto": null}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, month, week_index, day_index, row_index, col_index)
);
ALTER TABLE public.shockwave_schedules DISABLE ROW LEVEL SECURITY;`
  },
  {
    title: '환자 치료 로그 (통계/현황)',
    description: '충격파/도수치료 통계 탭에서 관리하는 환자 일일 기록 테이블입니다.',
    sql: `CREATE TABLE IF NOT EXISTS public.shockwave_patient_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  patient_name text NOT NULL,
  chart_number text,
  visit_count text,
  body_part text,
  therapist_name text,
  prescription text,
  prescription_count integer,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shockwave_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS prescription_count integer;
ALTER TABLE public.shockwave_patient_logs ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS public.manual_therapy_patient_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  patient_name text NOT NULL,
  chart_number text,
  visit_count text,
  body_part text,
  therapist_name text,
  prescription text,
  prescription_count integer,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_therapy_patient_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS prescription text;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS prescription_count integer;
ALTER TABLE public.manual_therapy_patient_logs ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';`
  },
  {
    title: '직원 근무표용 스케줄 테이블',
    description: '직원 근무표 탭에서 사용하는 메모 저장소입니다.',
    sql: `CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL,
  day int NOT NULL,
  slot_index int NOT NULL,
  content text,
  font_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, month, day, slot_index)
);
ALTER TABLE public.staff_schedules DISABLE ROW LEVEL SECURITY;`
  },
  {
    title: '공지사항 및 공휴일',
    description: '공지사항 보드 및 달력 공휴일 관리용.',
    sql: `-- 공지사항
CREATE TABLE IF NOT EXISTS public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_index int NOT NULL UNIQUE,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notices DISABLE ROW LEVEL SECURITY;

-- 공휴일
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;`
  }
];

const SQL_SETUP_SCRIPT = SQL_SNIPPETS.map(snippet => `-- ${snippet.title}\n${snippet.sql}`).join('\n\n');

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const { loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  
  const [therapists, setTherapists] = useState([]);
  const [newTherapist, setNewTherapist] = useState({ name: '', slot_index: 0 });
  const [manualTherapists, setManualTherapists] = useState([]);
  const [newManualTherapist, setNewManualTherapist] = useState({ name: '', slot_index: 0 });
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  
  const [swSettings, setSwSettings] = useState({ 
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
    frozen_columns: 6
  });
  const [dayOverrides, setDayOverrides] = useState({});
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  const handleCopySQL = async (sql) => {
    if (!navigator?.clipboard) {
      addToast('복사 실패: 브라우저가 클립보드를 지원하지 않습니다.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(sql);
      addToast('SQL 코드가 클립보드에 복사되었습니다.', 'success');
    } catch (err) {
      addToast('복사 실패: 클립보드 접근 권한이 필요합니다.', 'error');
    }
  };

  useEffect(() => {
    loadTherapists();
    loadManualTherapists();
    loadHolidays();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('shockwave_settings').select('*').order('updated_at', { ascending: false }).limit(1).single();
      if (!error && data) {
        setSwSettings({
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
          frozen_columns: data.frozen_columns || 6
        });
        setDayOverrides(data.day_overrides || {});
      }
    } catch(e) {}
  };

  const handleSaveSettings = async () => {
    const success = await saveShockwaveSettings({
      start_time: swSettings.start_time + ':00',
      end_time: swSettings.end_time + ':00',
      interval_minutes: Number(swSettings.interval_minutes),
      day_overrides: dayOverrides,
      prescriptions: swSettings.prescriptions,
      manual_therapy_prescriptions: swSettings.manual_therapy_prescriptions,
      prescription_prices: swSettings.prescription_prices,
      prescription_colors: swSettings.prescription_colors,
      incentive_percentage: Number(swSettings.incentive_percentage) || 0,
      manual_therapy_incentive_percentage: Number(swSettings.manual_therapy_incentive_percentage) || 0,
      frozen_columns: Number(swSettings.frozen_columns)
    });
    if (success) addToast('시간표 설정이 저장되었습니다.', 'success');
  };

  const updateDayOverride = (dow, field, value) => {
    setDayOverrides(prev => {
      const updated = { ...prev };
      updated[dow] = { ...(prev[dow] || {}) };
      
      // no_lunch 체크 전환 시
      if (field === 'no_lunch') {
        if (value) {
          updated[dow].no_lunch = true;
          // 점심 시간 삭제
          delete updated[dow].lunch_start;
          delete updated[dow].lunch_end;
        } else {
          delete updated[dow].no_lunch;
        }
      } else {
        if (value === '' || value === undefined) {
          delete updated[dow][field];
        } else {
          updated[dow][field] = value;
        }
      }
      
      if (Object.keys(updated[dow]).length === 0) {
        delete updated[dow];
      }
      
      return updated;
    });
  };

  const loadTherapists = async () => {
    const { data } = await supabase.from('shockwave_therapists').select('*').order('slot_index');
    setTherapists(data || []);
  };

  const loadManualTherapists = async () => {
    const { data } = await supabase.from('manual_therapy_therapists').select('*').order('slot_index');
    setManualTherapists(data || []);
  };

  const loadHolidays = async () => {
    const { data } = await supabase.from('holidays').select('*').order('date');
    setHolidays(data || []);
  };

  const addTherapist = async () => {
    if (!newTherapist.name.trim()) return;
    const { error } = await supabase.from('shockwave_therapists').insert({
      name: newTherapist.name.trim(),
      slot_index: newTherapist.slot_index,
      is_active: true
    });
    if (error) { addToast('추가 실패: ' + error.message, 'error'); return; }
    addToast('치료사가 추가되었습니다', 'success');
    setNewTherapist({ name: '', slot_index: 0 });
    loadTherapists();
  };

  const removeTherapist = async (id) => {
    const { error } = await supabase.from('shockwave_therapists').delete().eq('id', id);
    if (!error) { addToast('삭제되었습니다', 'success'); loadTherapists(); }
  };

  const addManualTherapist = async () => {
    if (!newManualTherapist.name.trim()) return;
    const { error } = await supabase.from('manual_therapy_therapists').insert({
      name: newManualTherapist.name.trim(),
      slot_index: newManualTherapist.slot_index,
      is_active: true
    });
    if (error) { addToast('추가 실패: ' + error.message, 'error'); return; }
    addToast('도수치료 치료사가 추가되었습니다', 'success');
    setNewManualTherapist({ name: '', slot_index: 0 });
    loadManualTherapists();
  };

  const removeManualTherapist = async (id) => {
    const { error } = await supabase.from('manual_therapy_therapists').delete().eq('id', id);
    if (!error) { addToast('삭제되었습니다', 'success'); loadManualTherapists(); }
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
    loadHolidays();
  };

  const removeHoliday = async (id) => {
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (!error) { addToast('삭제되었습니다', 'success'); loadHolidays(); }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">설정</h1>
      </div>

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
          <span className="card-title">⏰ 충격파 스케줄 시간표 설정</span>
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

          <div className="settings-row" style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-color-light)' }}>
            <div style={{ flex: 1 }}>
              <div className="settings-row-label">📝 처방 목록 (현황 탭)</div>
              <div className="settings-row-desc">치료사별로 표시할 처방 종류와 결산에 사용할 가격을 관리합니다.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {swSettings.prescriptions.map((pres, idx) => (
                  <span 
                    key={idx} 
                    style={{ 
                      background: 'var(--accent-color, #6366f1)', 
                      color: 'white', 
                      padding: '4px 4px 4px 10px', 
                      borderRadius: 16, 
                      fontSize: '0.8rem', 
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    {pres}
                    <input
                      type="color"
                      value={swSettings.prescription_colors[pres] || '#000000'}
                      onChange={(e) => {
                        const newColor = e.target.value;
                        setSwSettings(p => ({
                          ...p,
                          prescription_colors: {
                            ...p.prescription_colors,
                            [pres]: newColor
                          }
                        }));
                      }}
                      style={{
                        width: 20,
                        height: 20,
                        padding: 0,
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        overflow: 'hidden'
                      }}
                      title="스케줄러 글자색 선택"
                    />
                    <span
                      style={{ cursor: 'pointer', paddingRight: 6 }}
                      onClick={() => {
                        const next = swSettings.prescriptions.filter((_, i) => i !== idx);
                        setSwSettings(p => ({ ...p, prescriptions: next }));
                      }}
                    >✕</span>
                  </span>
                ))}
                <input 
                  className="form-input" 
                  placeholder="+ 추가" 
                  style={{ width: 100, height: 28, fontSize: '0.8rem', padding: '0 8px' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const val = e.target.value.trim();
                      if (!swSettings.prescriptions.includes(val)) {
                        setSwSettings(p => ({
                          ...p,
                          prescriptions: [...p.prescriptions, val],
                          prescription_prices: {
                            ...p.prescription_prices,
                            [val]: p.prescription_prices?.[val] ?? 0,
                          },
                        }));
                      }
                      e.target.value = '';
                    }
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
                {swSettings.prescriptions.map((pres) => (
                  <label key={`${pres}-price`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>{pres} 가격</span>
                    <input
                      type="number"
                      className="form-input"
                      min={0}
                      step={1000}
                      value={swSettings.prescription_prices?.[pres] ?? 0}
                      onChange={(e) => {
                        const value = Number(e.target.value) || 0;
                        setSwSettings((p) => ({
                          ...p,
                          prescription_prices: {
                            ...p.prescription_prices,
                            [pres]: value,
                          },
                        }));
                      }}
                    />
                  </label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>인센티브 퍼센트</span>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    step={0.1}
                    value={swSettings.incentive_percentage}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setSwSettings((p) => ({
                        ...p,
                        incentive_percentage: Number.isFinite(value) ? value : 0,
                      }));
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="settings-row" style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-color-light)' }}>
            <div style={{ flex: 1 }}>
              <div className="settings-row-label">💆 도수 처방목록 / 인센</div>
              <div className="settings-row-desc">도수치료 통계 탭에서 사용할 시간 라벨과 인센티브 퍼센트를 별도로 관리합니다.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {swSettings.manual_therapy_prescriptions.map((pres, idx) => (
                  <span
                    key={`manual-${idx}`}
                    style={{
                      background: '#0f766e',
                      color: 'white',
                      padding: '4px 10px',
                      borderRadius: 16,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    onClick={() => {
                      const next = swSettings.manual_therapy_prescriptions.filter((_, i) => i !== idx);
                      setSwSettings(p => ({ ...p, manual_therapy_prescriptions: next }));
                    }}
                  >
                    {pres} ✕
                  </span>
                ))}
                <input
                  className="form-input"
                  placeholder="+ 도수 라벨 추가"
                  style={{ width: 140, height: 28, fontSize: '0.8rem', padding: '0 8px' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const val = e.target.value.trim();
                      if (!swSettings.manual_therapy_prescriptions.includes(val)) {
                        setSwSettings(p => ({
                          ...p,
                          manual_therapy_prescriptions: [...p.manual_therapy_prescriptions, val],
                          prescription_prices: {
                            ...p.prescription_prices,
                            [val]: p.prescription_prices?.[val] ?? 0,
                          },
                        }));
                      }
                      e.target.value = '';
                    }
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
                {swSettings.manual_therapy_prescriptions.map((pres) => (
                  <label key={`manual-${pres}-price`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>{pres} 가격</span>
                    <input
                      type="number"
                      className="form-input"
                      min={0}
                      step={1000}
                      value={swSettings.prescription_prices?.[pres] ?? 0}
                      onChange={(e) => {
                        const value = Number(e.target.value) || 0;
                        setSwSettings((p) => ({
                          ...p,
                          prescription_prices: {
                            ...p.prescription_prices,
                            [pres]: value,
                          },
                        }));
                      }}
                    />
                  </label>
                ))}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="settings-row-label" style={{ fontSize: '0.82rem' }}>도수 인센티브 퍼센트</span>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    step={0.1}
                    value={swSettings.manual_therapy_incentive_percentage}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setSwSettings((p) => ({
                        ...p,
                        manual_therapy_incentive_percentage: Number.isFinite(value) ? value : 0,
                      }));
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right', marginTop: 24 }}>
            <button className="btn btn-primary" onClick={handleSaveSettings}>환경설정 저장</button>
          </div>

          {/* 요일별 오버라이드 테이블 */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 10, color: 'var(--text-primary)' }}>📅 요일별 운영 시간 설정</div>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem', marginBottom: 12 }}>
              비워두면 위의 기본 시간이 적용됩니다. 요일별로 시작/종료 시간과 점심 시간을 다르게 설정할 수 있습니다.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border-color)', textAlign: 'center', fontWeight: 700, minWidth: 40 }}>요일</th>
                    <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border-color)', textAlign: 'center', fontWeight: 600, minWidth: 90 }}>시작 시간</th>
                    <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border-color)', textAlign: 'center', fontWeight: 600, minWidth: 90 }}>종료 시간</th>
                    <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border-color)', textAlign: 'center', fontWeight: 600, minWidth: 90 }}>점심 시작</th>
                    <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border-color)', textAlign: 'center', fontWeight: 600, minWidth: 90 }}>점심 종료</th>
                    <th style={{ padding: '8px 6px', borderBottom: '1px solid var(--border-color)', textAlign: 'center', fontWeight: 600, minWidth: 60 }}>점심 없음</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6].map(dow => {
                    const ov = dayOverrides[dow] || {};
                    const isNoLunch = ov.no_lunch === true;
                    return (
                      <tr key={dow} style={{ borderBottom: '1px solid var(--border-color-light)' }}>
                        <td style={{ padding: '6px', textAlign: 'center', fontWeight: 700, color: dow === 6 ? 'var(--cal-saturday-text, #3b82f6)' : 'var(--text-primary)' }}>{DAY_NAMES[dow]}</td>
                        <td style={{ padding: '4px 3px' }}>
                          <input type="time" className="form-input" style={{ width: '100%', padding: '4px 6px', fontSize: '0.78rem' }} value={ov.start_time || ''} placeholder={swSettings.start_time} onChange={e => updateDayOverride(dow, 'start_time', e.target.value)} />
                        </td>
                        <td style={{ padding: '4px 3px' }}>
                          <input type="time" className="form-input" style={{ width: '100%', padding: '4px 6px', fontSize: '0.78rem' }} value={ov.end_time || ''} placeholder={swSettings.end_time} onChange={e => updateDayOverride(dow, 'end_time', e.target.value)} />
                        </td>
                        <td style={{ padding: '4px 3px' }}>
                          <input type="time" className="form-input" style={{ width: '100%', padding: '4px 6px', fontSize: '0.78rem', opacity: isNoLunch ? 0.3 : 1 }} value={isNoLunch ? '' : (ov.lunch_start || '')} placeholder="12:00" disabled={isNoLunch} onChange={e => updateDayOverride(dow, 'lunch_start', e.target.value)} />
                        </td>
                        <td style={{ padding: '4px 3px' }}>
                          <input type="time" className="form-input" style={{ width: '100%', padding: '4px 6px', fontSize: '0.78rem', opacity: isNoLunch ? 0.3 : 1 }} value={isNoLunch ? '' : (ov.lunch_end || '')} placeholder="13:00" disabled={isNoLunch} onChange={e => updateDayOverride(dow, 'lunch_end', e.target.value)} />
                        </td>
                        <td style={{ padding: '4px 3px', textAlign: 'center' }}>
                          <input type="checkbox" checked={isNoLunch} onChange={e => updateDayOverride(dow, 'no_lunch', e.target.checked)} style={{ cursor: 'pointer' }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleSaveSettings}>전체 설정 저장</button>
          </div>
        </div>
      </div>

      {/* 치료사 관리 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title"><Users size={18} /> 치료사 관리</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 120 }}
              placeholder="이름"
              value={newTherapist.name}
              onChange={e => setNewTherapist(p => ({ ...p, name: e.target.value }))}
            />
            <input
              className="form-input"
              style={{ width: 80 }}
              type="number"
              min={0}
              max={10}
              placeholder="순서"
              value={newTherapist.slot_index}
              onChange={e => setNewTherapist(p => ({ ...p, slot_index: parseInt(e.target.value) || 0 }))}
            />
            <button className="btn btn-primary btn-sm" onClick={addTherapist}>추가</button>
          </div>

          {therapists.map(t => (
            <div key={t.id} className="settings-row">
              <div>
                <div className="settings-row-label">{t.name}</div>
                <div className="settings-row-desc">슬롯 (표시 순서): {t.slot_index}</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeTherapist(t.id)}>삭제</button>
            </div>
          ))}

          {therapists.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>
              등록된 치료사가 없습니다
            </p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title"><Users size={18} /> 도수치료 치료사 관리</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 120 }}
              placeholder="이름"
              value={newManualTherapist.name}
              onChange={e => setNewManualTherapist(p => ({ ...p, name: e.target.value }))}
            />
            <input
              className="form-input"
              style={{ width: 80 }}
              type="number"
              min={0}
              max={10}
              placeholder="순서"
              value={newManualTherapist.slot_index}
              onChange={e => setNewManualTherapist(p => ({ ...p, slot_index: parseInt(e.target.value) || 0 }))}
            />
            <button className="btn btn-primary btn-sm" onClick={addManualTherapist}>추가</button>
          </div>

          {manualTherapists.map(t => (
            <div key={t.id} className="settings-row">
              <div>
                <div className="settings-row-label">{t.name}</div>
                <div className="settings-row-desc">슬롯 (표시 순서): {t.slot_index}</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeManualTherapist(t.id)}>삭제</button>
            </div>
          ))}

          {manualTherapists.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>
              등록된 도수치료 치료사가 없습니다
            </p>
          )}
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

          {holidays.slice(0, 20).map(h => (
            <div key={h.id} className="settings-row">
              <div>
                <div className="settings-row-label">{h.date}</div>
                <div className="settings-row-desc">{h.name || '(이름 없음)'}</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => removeHoliday(h.id)}>삭제</button>
            </div>
          ))}

          {holidays.length === 0 && (
            <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>
              등록된 공휴일이 없습니다
            </p>
          )}
        </div>
      </div>

      {/* 계정 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Shield size={18} /> 계정</span>
        </div>
        <div className="card-body">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{user?.email}</div>
              <div className="settings-row-desc">현재 로그인된 계정</div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={signOut}>로그아웃</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <span className="card-title"><Copy size={18} /> Supabase SQL 코드</span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
            아래 SQL 스니펫을 복사해서 Supabase SQL 편집기 또는 psql에 붙여넣으면 현재 프로그램이 사용하는 테이블을 준비할 수 있습니다.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {SQL_SNIPPETS.map(snippet => (
              <div
                key={snippet.title}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  padding: 12,
                  background: 'var(--bg-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{snippet.title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>{snippet.description}</div>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => handleCopySQL(snippet.sql)}
                  >
                    <Copy size={14} />
                    복사
                  </button>
                </div>
                <pre style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  lineHeight: '1.35rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 8,
                  padding: 10,
                  overflowX: 'auto',
                  fontFamily: 'Consolas, menlo, monospace'
                }}>
                  {snippet.sql}
                </pre>
              </div>
            ))}
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
    </div>
  );
}
