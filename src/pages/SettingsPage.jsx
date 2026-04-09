import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../components/common/Toast';
import { supabase } from '../lib/supabaseClient';
import { Sun, Moon, Database, Users, Shield, RefreshCw } from 'lucide-react';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const { loadShockwaveSettings, saveShockwaveSettings } = useSchedule();
  
  const [therapists, setTherapists] = useState([]);
  const [newTherapist, setNewTherapist] = useState({ name: '', slot_index: 0 });
  const [holidays, setHolidays] = useState([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  
  const [swSettings, setSwSettings] = useState({ start_time: '09:00', end_time: '18:00', interval_minutes: 10 });

  useEffect(() => {
    loadTherapists();
    loadHolidays();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('shockwave_settings').select('*').limit(1).single();
      if (!error && data) {
        setSwSettings({
          start_time: data.start_time.substring(0, 5), // '09:00:00' -> '09:00'
          end_time: data.end_time.substring(0, 5),
          interval_minutes: data.interval_minutes
        });
      }
    } catch(e) {}
  };

  const handleSaveSettings = async () => {
    const success = await saveShockwaveSettings({
      start_time: swSettings.start_time + ':00',
      end_time: swSettings.end_time + ':00',
      interval_minutes: Number(swSettings.interval_minutes)
    });
    if (success) addToast('시간표 설정이 저장되었습니다.', 'success');
  };

  const loadTherapists = async () => {
    const { data } = await supabase.from('shockwave_therapists').select('*').order('slot_index');
    setTherapists(data || []);
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
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginTop: 10 }}>
            * 주의: 시간표 구성을 변경하면 기존에 기록되어 있던 메모들의 위치 기준(줄 번호)이 틀어질 수 있습니다. (초기 세팅용으로 사용 권장)
          </p>
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
    </div>
  );
}
