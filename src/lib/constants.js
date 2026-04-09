/* =============================================
 * 색상/스타일 상수 (기존 스프레드시트 코드에서 변환)
 * ============================================*/

// 달력 배경 색상
export const COLORS = {
  white: '#ffffff',
  green: '#93c47d',
  greenOtherMonth: '#93c47c',
  preserveYellow: '#ffe599',
  preserveRed: '#f4cccc',
  holidayHeader: '#ea9999',
  holidayName: '#f4cccc',
  holidayBg: '#93c47e',
  todayDateBg: '#b4a7d6',
  todayMemoBg: '#fff2cc',
  sundayBg: '#f5d5d5',
  saturdayBg: '#cfe2f3',
  grayBg: '#d9d9d8',
  specialWorkBg: '#f4cccc',
};

// 글자 색상
export const FONT_COLORS = {
  red: '#ff0000',
  blue: '#1155cc',
  normal: '#000000',
  dim: '#999999',
  purple: '#9900ff',
  green: '#40a417',
  orange: '#ff6d01',
  nightBlue: '#3c78d8',
  darkRed: '#980000',
};

// 보호된 색상 (자동 덮어쓰기 방지)
export const PROTECTED_COLORS = new Set([
  '#ffe599', '#ea9999', '#f4cccc', '#93c47e', '#93c47c'
]);

// 자동 배경색 (자동으로 변경 가능한 색상)
export const AUTO_BG_COLORS = new Set([
  '#fff2cc', '#f5d5d5', '#cfe2f3', '#b4a7d6', '#d9d9d8', '#ffffff', '', 'white'
]);

// 요일 이름
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEKDAYS_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

// 부서 매핑
export const CLINIC_DEPT_MAP = {
  pt: ['shock'],
  '충격파': ['shock'],
  shock: ['shock'],
  sw: ['shock'],
};
