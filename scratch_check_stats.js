import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const [k, v] = line.split('=');
  if (k && v) env[k.trim()] = v.trim();
});

const url = env['VITE_SUPABASE_URL'];
const key = env['VITE_SUPABASE_KEY'];

// 달력 날짜 매핑을 위한 유틸
function generateShockwaveCalendar(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  
  // 첫 주의 시작 요일 (0: 일요일, 1: 월요일 ...)
  const startDayOfWeek = firstDay.getDay(); 
  const totalDays = lastDay.getDate();
  
  const weeks = [];
  let currentWeek = Array(7).fill(null);
  
  // 이전 달 날짜들 채우기
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  for (let i = 0; i < startDayOfWeek; i++) {
    const prevDay = prevMonthLastDay - startDayOfWeek + 1 + i;
    const prevDate = new Date(year, month - 2, prevDay);
    currentWeek[i] = {
      year: prevDate.getFullYear(),
      month: prevDate.getMonth() + 1,
      day: prevDay,
      isCurrentMonth: false
    };
  }
  
  // 이번 달 날짜들 채우기
  for (let day = 1; day <= totalDays; day++) {
    const dayOfWeek = (startDayOfWeek + day - 1) % 7;
    const weekIndex = Math.floor((startDayOfWeek + day - 1) / 7);
    
    if (dayOfWeek === 0 && day > 1) {
      weeks.push(currentWeek);
      currentWeek = Array(7).fill(null);
    }
    
    currentWeek[dayOfWeek] = {
      year,
      month,
      day,
      isCurrentMonth: true
    };
    
    if (day === totalDays) {
      // 다음 달 날짜들로 남은 칸 채우기
      let nextDay = 1;
      for (let i = dayOfWeek + 1; i < 7; i++) {
        const nextDate = new Date(year, month, nextDay);
        currentWeek[i] = {
          year: nextDate.getFullYear(),
          month: nextDate.getMonth() + 1,
          day: nextDay,
          isCurrentMonth: false
        };
        nextDay++;
      }
      weeks.push(currentWeek);
    }
  }
  return weeks;
}

// 특수문구 거름망
function parseTherapyInfo(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return null;
  const s = rawContent.trim();
  if (!s) return null;

  if (/^(휴무|연차|반차|출근|퇴근|근무|야간|오전|오후|처방|건수|총건수|합계|결산|주차)$/.test(s)) return null;
  if (/^\d{1,2}:\d{2}$/.test(s)) return null;

  let chart = "";
  let name = s;
  let visit = "";

  if (s.includes('/')) {
    const parts = s.split('/');
    const p0 = parts[0].trim();
    const p1 = parts[1]?.trim() || '';

    if (/\d/.test(p0) && /[^\d*()]/.test(p1)) {
       chart = p0;
       name = p1;
    } else if (/[^\d*()]/.test(p0) && /\d/.test(p1)) {
       name = p0;
       chart = p1;
    } else {
       chart = p0;
       name = p1;
    }
  }

  // 도수치료 표기(40/60 패턴)는 충격파 통계에서 제외
  if (/[가-힣a-zA-Z]\s*\*?\s*(\d{2,3})\**($|[(\s])/.test(s)) return null;

  const visitMatch = name.match(/\((\d+)₩?\)$/);
  if (visitMatch) {
    visit = visitMatch[1];
    name = name.replace(/\(\d+₩?\)$/, '').trim();
  } else if (/\(-\)$/.test(name)) {
    visit = "-";
    name = name.replace(/\(-\)$/, '').trim();
  } else if (name.endsWith('*')) {
    visit = "1";
  }

  name = name.trim();
  if (!name || /^\d+$/.test(name.replace(/\*/g, ''))) return null;

  return {
    patient_name: name,
    chart_number: chart,
    visit_count: visit, 
    original: s
  };
}

async function run() {
  // 1. 2026년 4월 shockwave_schedules 조회
  const res = await fetch(`${url}/rest/v1/shockwave_schedules?year=eq.2026&month=eq.4&select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const schedules = await res.json();
  
  const weeks = generateShockwaveCalendar(2026, 4);
  
  // 2. 2026년 4월 shockwave_patient_logs 조회
  const logsRes = await fetch(`${url}/rest/v1/shockwave_patient_logs?date=gte.2026-04-01&date=lte.2026-04-30&select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const logs = await logsRes.json();

  console.log("=== 2026년 4월 스케줄 상세 분석 ===");
  
  // 순수 완료된 충격파 스케줄 추출
  const completedShockwaveSchedules = [];
  
  schedules.forEach(s => {
    if (s.content && s.content.trim() !== "" && s.bg_color && s.bg_color.toLowerCase() === '#ffe599') {
      const parsed = parseTherapyInfo(s.content);
      if (parsed) {
        const dayInfo = weeks[s.week_index]?.[s.day_index];
        if (dayInfo && dayInfo.isCurrentMonth) {
          const dateStr = `2026-04-${String(dayInfo.day).padStart(2, '0')}`;
          completedShockwaveSchedules.push({
            ...s,
            dateStr,
            parsed
          });
        }
      }
    }
  });

  console.log("스케줄 표 상 완료(bg_color = #ffe599)된 순수 충격파 예약 수:", completedShockwaveSchedules.length);
  console.log("실제 충격파 통계 로그 수(patient_logs):", logs.length);

  // 누락된 건 확인
  // 스케줄 표 데이터 키: "dateStr:patient_name:col_index"
  // 통계 로그 데이터 키: "date:patient_name" (or scheduler_cell_key)
  const logKeys = new Set(logs.map(l => l.scheduler_cell_key).filter(Boolean));
  const logNameDateKeys = new Set(logs.map(l => `${l.date}:${l.patient_name.replace(/\*/g, '')}`));

  const missingSchedules = [];
  completedShockwaveSchedules.forEach(s => {
    const cellKey = `2026:04:${s.week_index}:${s.day_index}:${s.row_index}:${s.col_index}`;
    const nameDateKey = `${s.dateStr}:${s.parsed.patient_name.replace(/\*/g, '')}`;
    
    if (!logKeys.has(cellKey) && !logNameDateKeys.has(nameDateKey)) {
      missingSchedules.push(s);
    }
  });

  console.log("\n=== 통계 로그에 누락된 스케줄 항목 (총 " + missingSchedules.length + "건) ===");
  missingSchedules.forEach((s, i) => {
    console.log(`[${i+1}] 날짜: ${s.dateStr} | content: "${s.content}" | col_index: ${s.col_index} (치료사) | pres: ${s.prescription || '(비어있음)'} | body: ${s.body_part || '(비어있음)'}`);
  });
}

run().catch(console.error);
