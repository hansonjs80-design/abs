import { useState, useEffect, useCallback, useMemo } from 'react';

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
  onClose,
}) {
  const [activeTab, setActiveTab] = useState('shockwave'); // 'shockwave' | 'manual_therapy'

  const currentTherapists = activeTab === 'manual_therapy' ? manualTherapists : therapists;
  const currentMonthlyData = activeTab === 'manual_therapy' ? monthlyManualTherapists : monthlyTherapists;
  const lastDay = new Date(year, month, 0).getDate();
  const colCount = Math.max(1, currentTherapists?.length || 0);

  // 탭별 로컬 편집 상태
  const [shockwaveSlots, setShockwaveSlots] = useState(null);
  const [manualSlots, setManualSlots] = useState(null);

  const buildSlots = useCallback((therapistList, monthlyData, count) => {
    const ld = new Date(year, month, 0).getDate();
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
      setShockwaveSlots(buildSlots(therapists, monthlyTherapists, Math.max(1, therapists?.length || 0)));
    }
  }, [therapists, monthlyTherapists, buildSlots, shockwaveSlots]);

  useEffect(() => {
    if (!manualSlots) {
      setManualSlots(buildSlots(manualTherapists, monthlyManualTherapists, Math.max(1, manualTherapists?.length || 0)));
    }
  }, [manualTherapists, monthlyManualTherapists, buildSlots, manualSlots]);

  const slots = activeTab === 'manual_therapy' ? manualSlots : shockwaveSlots;
  const setSlots = activeTab === 'manual_therapy' ? setManualSlots : setShockwaveSlots;

  const [saving, setSaving] = useState(false);

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

  // 저장 (현재 탭)
  const handleSave = useCallback(async () => {
    if (!slots) return;
    setSaving(true);
    const configs = [];
    Object.entries(slots).forEach(([slotStr, ranges]) => {
      const slotIndex = parseInt(slotStr, 10);
      ranges.forEach((range) => {
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

    const success = await onSave(year, month, configs, activeTab);
    setSaving(false);
    if (success) onClose();
  }, [slots, onSave, onClose, year, month, activeTab]);

  // ESC 닫기
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!slots) return null;

  return (
    <div className="monthly-therapist-backdrop" onMouseDown={onClose}>
      <div
        className="monthly-therapist-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="monthly-therapist-header">
          <h3 className="monthly-therapist-title">
            🩺 {year}년 {month}월 치료사 설정
          </h3>
          <button type="button" className="monthly-therapist-close" onClick={onClose}>✕</button>
        </div>

        {/* 탭 */}
        <div className="monthly-therapist-tabs">
          <button
            type="button"
            className={`monthly-therapist-tab${activeTab === 'shockwave' ? ' active' : ''}`}
            onClick={() => setActiveTab('shockwave')}
          >
            ⚡ 충격파 치료사
          </button>
          <button
            type="button"
            className={`monthly-therapist-tab${activeTab === 'manual_therapy' ? ' active' : ''}`}
            onClick={() => setActiveTab('manual_therapy')}
          >
            🤲 도수 치료사
          </button>
        </div>

        <div className="monthly-therapist-desc">
          각 슬롯(열)별로 날짜 범위와 치료사를 지정합니다. 빈 이름은 해당 기간 비활성 처리됩니다.
        </div>

        <div className="monthly-therapist-body">
          {Array.from({ length: colCount }, (_, slotIndex) => (
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
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="monthly-therapist-footer">
          <button type="button" className="monthly-therapist-cancel" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="monthly-therapist-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '저장 중...' : `${activeTab === 'manual_therapy' ? '도수치료' : '충격파'} 저장`}
          </button>
        </div>
      </div>
    </div>
  );
}
