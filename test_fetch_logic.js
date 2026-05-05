import { parseSchedulerPatientIdentity, getExplicitVisitSuffix } from './src/lib/schedulerUtils.js';
import { normalizeNameForMatch } from './src/lib/memoParser.js';

const s = {
  year: 2025,
  month: 5,
  week_index: 1,
  day_index: 4,
  content: '2629/조다슬*'
};
const chartParam = null;
const nameParam = '조다슬';

const parsed = parseSchedulerPatientIdentity(s.content);
console.log('parsed:', parsed);

const matchChart = chartParam && String(parsed.patientChart || '').trim() === chartParam;
const matchName = nameParam && normalizeNameForMatch(parsed.patientName).includes(nameParam);

console.log('matchChart:', matchChart);
console.log('matchName:', matchName);

console.log('will push?', (!chartParam && matchName) || (chartParam && matchChart));

