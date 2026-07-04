import { useCallback } from 'react';
import { generateShockwaveCalendar } from '../../lib/calendarUtils';
import { incrementSessionCount, normalizeNameForMatch } from '../../lib/memoParser';
import { supabase } from '../../lib/supabaseClient';
import {
  get4060PrescriptionFromContent,
  has4060Pattern,
  normalizeConfiguredDoseTagInContent,
  normalize4060StarOrder,
  strip4060FromContent,
  getConfiguredDoseTagFromContent,
  stripDoseTagFromContent,
} from '../../lib/schedulerContentFormat';
import {
  getPrescriptionFromConfiguredDoseTag,
  getPrescriptionScheduleSettings,
} from '../../lib/prescriptionScheduleSettings';
import {
  getScheduleDayDateKey,
  isUnmarkedSameDaySchedulerLog,
  shouldUseScheduleRowForPatientHistory,
  shouldUseScheduleContentForPatientHistory,
} from '../../lib/schedulerHistoryCandidateUtils';
import {
  addBodyPartToMap,
  buildManualNamePart,
  buildMergeSpanWithBodyPartOptions,
  buildMergeSpanWithMemoList,
  buildSchedulerMemoSortKey,
  getBodyPartOptionsFromMergeSpan,
  getExplicitVisitSuffix,
  getManualDoseTag,
  getMemoListFromMergeSpan,
  getNonVisitParentheticalSuffix,
  getSchedulerHistoryTypeLabel,
  normalizeBodyPartKey,
  normalizeSchedulerVisitSuffix,
  parseSchedulerPatientIdentity,
  splitBodyParts,
  stripReservationTimeFromMergeSpan,
} from '../../lib/schedulerUtils';

const getAutoFillOptionSortValue = (option) => {
  const dateValue = String(option?.lastDate || '');
  const visitValue = Number.parseInt(option?.displayVisit ?? option?.nextVisit ?? '0', 10) || 0;
  const chartValue = String(option?.chartNumber || '');
  return `${dateValue}-${String(visitValue).padStart(4, '0')}-${chartValue}`;
};

const sortAutoFillOptions = (options) => (
  [...(Array.isArray(options) ? options : [])].sort((a, b) => (
    getAutoFillOptionSortValue(b).localeCompare(getAutoFillOptionSortValue(a))
  ))
);

const getMemoPrescription = (memo) => (
  String(memo?.prescription || memo?.merge_span?.meta?.prescription || '').trim()
);

const getMemoBodyPart = (memo) => {
  const directBodyPart = String(memo?.body_part || '').trim();
  if (directBodyPart) return directBodyPart;
  return getBodyPartOptionsFromMergeSpan(memo?.merge_span).join(', ');
};

const getHistoryPrescription = (item) => (
  String(item?.prescription || item?.merge_span?.meta?.prescription || '').trim()
);

const getHistoryBodyPart = (item) => {
  const directBodyPart = String(item?.body_part || '').trim();
  if (directBodyPart) return directBodyPart;
  return getBodyPartOptionsFromMergeSpan(item?.merge_span).join(', ');
};

const getHistoryMetadataScore = (item) => {
  if (!item) return 0;
  let score = 0;
  if (getHistoryPrescription(item)) score += 2;
  if (getHistoryBodyPart(item)) score += 2;
  if (getMemoListFromMergeSpan(item.merge_span).length > 0) score += 3;
  if (item.source === 'schedule') score += 1;
  return score;
};

const compareHistoryItemFreshness = (left, right) => {
  if (!left && !right) return 0;
  if (left && !right) return 1;
  if (!left && right) return -1;

  const leftDate = String(left.date || '');
  const rightDate = String(right.date || '');
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  const leftVisit = parseInt(left.visit_count || '0', 10) || 0;
  const rightVisit = parseInt(right.visit_count || '0', 10) || 0;
  if (leftVisit !== rightVisit) return leftVisit - rightVisit;

  return getHistoryMetadataScore(left) - getHistoryMetadataScore(right);
};

export default function useSchedulerAutoText({
  memos,
  weeks,
  settings,
}) {
  const shouldAutoFormatSchedulerName = useCallback((value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    if (/^(휴무|연차|반차|출근|퇴근|근무|야간|오전|오후)$/u.test(text)) return false;
    const hasPatientPattern = /^\d+\/?.*?/.test(text) || text.includes('/');
    if (hasPatientPattern) return true;
    if (/[()*]/.test(text)) return true;
    if (has4060Pattern(text)) return true;
    return true;
  }, []);

  const pickManualOptionForDosePrescription = useCallback((options, prescription) => {
    if (!Array.isArray(options) || options.length === 0) return null;
    const doseTag = getManualDoseTag(prescription);
    if (!doseTag) return null;

    return options.find((option) => (
      option?.type === 'manual' &&
      (String(option.doseTag || '') === doseTag || getManualDoseTag(option.prescription) === doseTag)
    )) || options.find((option) => option?.type === 'manual') || null;
  }, []);

  const showAutoFillDialog = useCallback((dialogData) => {
    if (!dialogData) return Promise.resolve(null);
    const bodyPart =
      dialogData.initialBodyPart ||
      dialogData.latestBodyPart ||
      (Array.isArray(dialogData.bodyParts) ? dialogData.bodyParts[0] : '') ||
      '';

    return Promise.resolve({
      chartNumber: dialogData.chartNumber,
      namePart: dialogData.namePart,
      cleanName: dialogData.cleanName,
      visitCount: dialogData.visitCount,
      prescription: dialogData.prescription || '',
      bodyPart,
      memoList: Array.isArray(dialogData.initialMemoList) ? dialogData.initialMemoList : [],
      type: dialogData.type,
      doseTag: dialogData.doseTag,
    });
  }, []);

  const markUnknownPatient = useCallback((text) => {
    const value = String(text || '').trim();
    if (!value || value.includes('*')) return value;
    const explicitVisitSuffix = getExplicitVisitSuffix(value);
    if (!explicitVisitSuffix) return normalize4060StarOrder(`${value}*`);
    const base = value.slice(0, -explicitVisitSuffix.length).trim();
    return normalize4060StarOrder(`${base}*${explicitVisitSuffix}`);
  }, []);

  const findLatestSchedulerMemoMeta = useCallback((targetCell, chartNumber, cleanName, options = {}) => {
    const normalizedName = normalizeNameForMatch(cleanName);
    const currentSortKey = buildSchedulerMemoSortKey(`${targetCell.w}-${targetCell.d}-${targetCell.r}-${targetCell.c}`, weeks);
    let latestMatch = null;

    Object.entries(memos || {}).forEach(([memoKey, memo]) => {
      if (!memo?.content) return;
      const parts = memoKey.split('-').map(Number);
      if (parts.length !== 4) return;
      const sortKey = buildSchedulerMemoSortKey(memoKey, weeks);
      if (!sortKey || sortKey >= currentSortKey) return;

      const parsed = parseSchedulerPatientIdentity(memo.content);
      const matchesChart = chartNumber && String(parsed.patientChart || '').trim() === String(chartNumber).trim();
      const matchesName = normalizedName && normalizeNameForMatch(parsed.patientName) === normalizedName;
      if (chartNumber ? !matchesChart : !matchesName) return;
      if (options.exclude4060 && has4060Pattern(memo.content)) return;

      const memoList = getMemoListFromMergeSpan(memo.merge_span);
      if (memoList.length === 0) return;

      if (!latestMatch || sortKey > latestMatch.sortKey) {
        latestMatch = {
          sortKey,
          mergeSpan: stripReservationTimeFromMergeSpan(buildMergeSpanWithMemoList(memo.merge_span, memoList)),
        };
      }
    });

    return latestMatch?.mergeSpan;
  }, [memos, weeks]);

  const parseSchedulerPatientText = useCallback((text) => {
    const raw = String(text || '').trim();
    if (!raw.includes('/')) return null;

    const match = raw.match(/^([^/]+)\/(.+?(?:\d{2,3})?)((\(-?\d*\))|\*)?$/);
    if (!match) return null;

    const chartNumber = String(match[1] || '').trim();
    const namePart = String(match[2] || '').trim();
    const suffixToken = match[3] || '';
    const suffixValue = suffixToken.replace(/[()]/g, '') || (suffixToken === '*' ? '*' : '');
    const noteSuffix = getNonVisitParentheticalSuffix(namePart);
    const cleanName = namePart
      .slice(0, noteSuffix ? -noteSuffix.length : undefined)
      .replace(/\(-\)/g, '')
      .trim();
    const normalizedName = normalizeNameForMatch(cleanName);

    if (!chartNumber || !normalizedName) return null;

    return {
      chartNumber,
      rawName: namePart,
      cleanName,
      normalizedName,
      suffixToken,
      suffixValue,
    };
  }, []);

  const findSchedulerHistoryCandidates = useCallback((targetCell, rawInput, targetDate = '') => {
    const normalizedInput = normalizeNameForMatch(rawInput);
    const exactInput = String(rawInput || '').trim();
    const explicitInputIdentity = parseSchedulerPatientText(exactInput);
    const explicitChartNumber = String(explicitInputIdentity?.chartNumber || '').trim();
    const targetMemoKey = `${targetCell.w}-${targetCell.d}-${targetCell.r}-${targetCell.c}`;
    const currentSortKey = buildSchedulerMemoSortKey(targetMemoKey, weeks);
    const candidateMap = new Map();

    Object.entries(memos || {}).forEach(([memoKey, memo]) => {
      const content = String(memo?.content || '').trim();
      if (!content) return;
      if (!shouldUseScheduleContentForPatientHistory(content)) return;
      if (memoKey === targetMemoKey) return;
      const sortKey = buildSchedulerMemoSortKey(memoKey, weeks);
      const sortDate = sortKey?.slice(0, 10) || '';
      if (!sortKey) return;
      if (targetDate) {
        if (sortDate > targetDate) return;
      } else if (currentSortKey && sortKey >= currentSortKey) {
        return;
      }

      const parsed = parseSchedulerPatientText(content);
      const memoChart = String(parsed?.chartNumber || '').trim();
      
      if (!memoChart && !parsed?.normalizedName) return;

      const matchesChart = explicitChartNumber
        ? memoChart === explicitChartNumber
        : exactInput && memoChart === exactInput;
      const matchesName = normalizedInput && parsed?.normalizedName === normalizedInput;
      if (explicitChartNumber ? !matchesChart : (!matchesChart && !matchesName)) return;

      const candidateKey = memoChart || parsed.normalizedName;
      if (!candidateMap.has(candidateKey)) {
        candidateMap.set(candidateKey, {
          chartNumber: memoChart,
          latestMemo: memo,
          latestParsed: parsed,
          latestSortKey: sortKey,
          latestNonEmptyPrescription: '',
          bodyPartsMap: new Map(),
          prescriptions: new Set(),
        });
      }

      const candidate = candidateMap.get(candidateKey);
      if (sortKey > candidate.latestSortKey) {
        candidate.latestMemo = memo;
        candidate.latestParsed = parsed;
        candidate.latestSortKey = sortKey;
      }

      const memoBodyPart = getMemoBodyPart(memo);
      if (memoBodyPart && (!candidate.latestNonEmptyBodyPartSortKey || sortKey > candidate.latestNonEmptyBodyPartSortKey)) {
        candidate.latestNonEmptyBodyPart = memoBodyPart;
        candidate.latestNonEmptyBodyPartSortKey = sortKey;
      }

      const memoPrescription = getMemoPrescription(memo);
      if (memoPrescription && (!candidate.latestNonEmptyPrescriptionSortKey || sortKey > candidate.latestNonEmptyPrescriptionSortKey)) {
        candidate.latestNonEmptyPrescription = memoPrescription;
        candidate.latestNonEmptyPrescriptionSortKey = sortKey;
      }

      splitBodyParts(memoBodyPart).forEach((part) => addBodyPartToMap(candidate.bodyPartsMap, part));
      if (memoPrescription) candidate.prescriptions.add(memoPrescription);
    });

    return Array.from(candidateMap.values())
      .map((candidate) => {
        const latestContent = String(candidate.latestMemo?.content || '').trim();
        const latestDate = candidate.latestSortKey.slice(0, 10);
        const isSameDay = targetDate && latestDate === targetDate;
        const isHyphen = candidate.latestParsed?.suffixValue === '-';
        const nextText = (isHyphen || isSameDay) ? latestContent : (incrementSessionCount(latestContent) || latestContent);
        const incrementedParsed = parseSchedulerPatientText(nextText);
        const latestParsed = candidate.latestParsed;
        const latestMergeSpan = buildMergeSpanWithMemoList(
          candidate.latestMemo?.merge_span,
          getMemoListFromMergeSpan(candidate.latestMemo?.merge_span)
        );
        const lastVisit = parseInt(latestParsed?.suffixValue || '0', 10) || (latestParsed?.suffixToken === '*' ? 1 : 0);
        let nextVisit;
        if (isHyphen) {
          nextVisit = '-';
        } else if (isSameDay) {
          nextVisit = latestParsed?.suffixValue || (latestParsed?.suffixToken === '*' ? '*' : (lastVisit > 0 ? lastVisit : 1));
        } else {
          nextVisit = parseInt(incrementedParsed?.suffixValue || '0', 10) || (lastVisit > 0 ? lastVisit + 1 : 1);
        }

        const effectiveLatestBodyPart = getMemoBodyPart(candidate.latestMemo)
          || candidate.latestNonEmptyBodyPart
          || '';
        const effectiveLatestPrescription = getMemoPrescription(candidate.latestMemo)
          || candidate.latestNonEmptyPrescription
          || '';

        return {
          chartNumber: candidate.chartNumber,
          namePart: incrementedParsed?.rawName || latestParsed?.rawName || '',
          cleanName: latestParsed?.cleanName || '',
          nextText,
          nextVisit,
          lastDate: latestDate,
          prescription: effectiveLatestPrescription,
          latestPrescription: effectiveLatestPrescription,
          prescriptions: Array.from(candidate.prescriptions),
          bodyParts: Array.from(candidate.bodyPartsMap.values()),
          latestBodyPart: effectiveLatestBodyPart,
          initialBodyParts: splitBodyParts(effectiveLatestBodyPart),
          type: 'scheduler',
          doseTag: '',
          optionLabel: effectiveLatestPrescription || '최근 스케줄',
          mergeSpan: latestMergeSpan,
        };
      })
      .sort((a, b) => {
        if (a.lastDate !== b.lastDate) return b.lastDate.localeCompare(a.lastDate);
        return b.nextVisit - a.nextVisit;
      });
  }, [memos, parseSchedulerPatientText, weeks]);

  const buildSchedulerAutoText = useCallback(async (
    w, d, r, c, nextValue,
    forceOverrideSession = false,
    originalContent = undefined,
    skipDialog = false,
    preloadedData = null
  ) => {
    try {
      let rawName = normalizeSchedulerVisitSuffix(nextValue);
    if (!shouldAutoFormatSchedulerName(rawName)) return { text: rawName };

    const dayInfo = weeks[w]?.[d];
    if (!dayInfo) return { text: rawName };
    const parsedYear = dayInfo.year || (dayInfo.date instanceof Date ? dayInfo.date.getFullYear() : (dayInfo.date ? new Date(dayInfo.date).getFullYear() : undefined));
    const parsedMonth = dayInfo.month || (dayInfo.date instanceof Date ? dayInfo.date.getMonth() + 1 : (dayInfo.date ? new Date(dayInfo.date).getMonth() + 1 : undefined));
    const parsedDay = dayInfo.day || (dayInfo.date instanceof Date ? dayInfo.date.getDate() : (dayInfo.date ? new Date(dayInfo.date).getDate() : undefined));
    const config = getPrescriptionScheduleSettings(settings, parsedYear, parsedMonth);
    const configuredPrescriptionSet = new Set([
      ...(Array.isArray(config?.shockwave?.prescriptions) ? config.shockwave.prescriptions : []),
      ...(Array.isArray(config?.manualTherapy?.prescriptions) ? config.manualTherapy.prescriptions : []),
    ].map((prescription) => String(prescription || '').trim()).filter(Boolean));
    rawName = normalizeConfiguredDoseTagInContent(rawName, config.doseTags);
    const normalizeImportedPrescription = (prescription) => {
      const value = String(prescription || '').trim();
      if (!value) return '';
      return configuredPrescriptionSet.size === 0 || configuredPrescriptionSet.has(value) ? value : '';
    };
    const isConfiguredPrescription = (prescription) => {
      const value = String(prescription || '').trim();
      return !value || configuredPrescriptionSet.size === 0 || configuredPrescriptionSet.has(value);
    };
    const firstConfiguredPrescription = (...prescriptions) => (
      prescriptions.map(normalizeImportedPrescription).find(Boolean) || ''
    );
    const hasDoseTagPattern = (text) => {
      if (!text) return false;
      return has4060Pattern(text) || getConfiguredDoseTagFromContent(text, config.doseTags) !== '';
    };

    let initialPrescription = undefined;
    if (hasDoseTagPattern(rawName)) {
      rawName = normalize4060StarOrder(rawName);
      initialPrescription = getPrescriptionFromConfiguredDoseTag(settings, parsedYear, parsedMonth, rawName)
        || get4060PrescriptionFromContent(rawName)
        || undefined;
    }
    const taggedManualPrescription = initialPrescription && getManualDoseTag(initialPrescription)
      ? initialPrescription
      : '';

    let manualSession = null;
    const inputParenMatch = rawName.match(/\((\d+)\)$/);
    if (inputParenMatch) {
      manualSession = parseInt(inputParenMatch[1], 10);
    }
    const explicitVisitSuffix = getExplicitVisitSuffix(rawName);
    const explicitNoteSuffix = getNonVisitParentheticalSuffix(rawName);

    const targetDate = `${parsedYear}-${String(parsedMonth).padStart(2, '0')}-${String(parsedDay).padStart(2, '0')}`;
    const memoKey = `${w}-${d}-${r}-${c}`;
    const clearPatientMergeSpan = () => stripReservationTimeFromMergeSpan(
      buildMergeSpanWithBodyPartOptions(
        buildMergeSpanWithMemoList(memos[memoKey]?.merge_span, []),
        []
      )
    );
    const buildUnknownPatientResult = () => {
      return {
        text: markUnknownPatient(rawName),
        prescription: initialPrescription || '',
        bodyPart: '',
        mergeSpan: clearPatientMergeSpan(),
      };
    };
    const currentBodyParts = splitBodyParts(memos[memoKey]?.body_part || '');

    const previousContent = originalContent !== undefined ? String(originalContent).trim() : String(memos[memoKey]?.content || '').trim();
    const userRemovedDoseTag = hasDoseTagPattern(previousContent) && !hasDoseTagPattern(rawName);

    const contentTag = getConfiguredDoseTagFromContent(rawName, config.doseTags);
    const cleanRawNameForIdentity = contentTag
      ? stripDoseTagFromContent(rawName, contentTag)
      : strip4060FromContent(rawName);

    const parsedIdentity = parseSchedulerPatientIdentity(cleanRawNameForIdentity);
    const searchChart = parsedIdentity.patientChart ? String(parsedIdentity.patientChart).trim() : null;
    const searchName = normalizeNameForMatch(parsedIdentity.patientName) || normalizeNameForMatch(cleanRawNameForIdentity);
    const hasExplicitSearchName = Boolean(searchChart && normalizeNameForMatch(parsedIdentity.patientName));
    const matchesSearchIdentity = (chartNumber, patientName) => {
      const matchesChart = searchChart && String(chartNumber || '').trim() === searchChart;
      const normalizedPatientName = normalizeNameForMatch(patientName);
      const matchesName = searchName && normalizedPatientName === searchName;
      if (searchChart) return hasExplicitSearchName ? Boolean(matchesChart && matchesName) : Boolean(matchesChart);
      return Boolean(matchesName);
    };

    if (explicitNoteSuffix) {
      return { text: rawName };
    }

    const schedulerOptions = findSchedulerHistoryCandidates({ w, d, r, c }, cleanRawNameForIdentity, targetDate)
      .filter((option) => !userRemovedDoseTag || !hasDoseTagPattern(option.nextText));
    const applySchedulerOption = async () => {
      if (schedulerOptions.length === 0) return null;
      const sortedSchedulerOptions = sortAutoFillOptions(schedulerOptions);
      const selected = pickManualOptionForDosePrescription(sortedSchedulerOptions, taggedManualPrescription)
        || sortedSchedulerOptions[0];
      if (!selected) return { text: rawName };

      const inputHasDoseTag = hasDoseTagPattern(rawName);
      const baseMerge = searchChart ? (selected.mergeSpan || clearPatientMergeSpan()) : selected.mergeSpan;
      const finalMergeSpan = buildMergeSpanWithBodyPartOptions(baseMerge, selected.bodyParts);

      if (inputHasDoseTag) {
        return {
          text: rawName,
          prescription: firstConfiguredPrescription(taggedManualPrescription, initialPrescription) || undefined,
          bodyPart: selected.latestBodyPart || '',
          mergeSpan: finalMergeSpan,
        };
      }

      const autoPrescription = (taggedManualPrescription || initialPrescription !== undefined)
        ? firstConfiguredPrescription(taggedManualPrescription, initialPrescription)
        : (hasDoseTagPattern(selected.nextText)
          ? (normalizeImportedPrescription(selected.latestPrescription || selected.prescription) || undefined)
          : (searchChart
            ? normalizeImportedPrescription(selected.latestPrescription || selected.prescription)
            : (normalizeImportedPrescription(selected.latestPrescription || selected.prescription) || undefined)));
      const selectedPrescription = selected.latestPrescription || selected.prescription || '';
      const shouldOmitSelectedPrescription = !isConfiguredPrescription(selectedPrescription);
      const selectedText = shouldOmitSelectedPrescription
        ? normalizeSchedulerVisitSuffix(`${selected.chartNumber}/${strip4060FromContent(selected.namePart)}(1)`)
        : selected.nextText;

      return {
        text: (explicitVisitSuffix || explicitNoteSuffix) ? rawName : selectedText,
        prescription: shouldOmitSelectedPrescription ? '' : autoPrescription,
        bodyPart: selected.latestBodyPart || '',
        mergeSpan: finalMergeSpan,
      };
    };

    const manualPrescriptionSet = new Set(
      (Array.isArray(settings?.manual_therapy_prescriptions) ? settings.manual_therapy_prescriptions : [])
        .map((prescription) => String(prescription || '').trim())
        .filter(Boolean)
    );
    const isManualTherapyRecord = (record, content = '') => {
      const prescription = String(record?.prescription || '').trim();
      const patientName = String(record?.patient_name || '').trim();
      if (manualPrescriptionSet.has(prescription)) return true;
      if (/^(40|60)분$/u.test(prescription)) return true;
      return has4060Pattern(content) || has4060Pattern(patientName);
    };

    let allData = [];
    if (preloadedData) {
      const filteredShockwave = (preloadedData.shockwaveLogs || []).filter((item) => {
        if (isUnmarkedSameDaySchedulerLog(item, targetDate)) return false;
        return matchesSearchIdentity(item.chart_number, item.patient_name);
      }).map((item) => ({
        ...item,
        type: isManualTherapyRecord(item) ? 'manual' : 'shockwave',
      }));

      const filteredManual = (preloadedData.manualLogs || []).filter((item) => {
        return matchesSearchIdentity(item.chart_number, item.patient_name);
      }).map((item) => ({ ...item, type: 'manual' }));

      allData = userRemovedDoseTag
        ? filteredShockwave.filter((item) => item.type === 'shockwave')
        : [...filteredShockwave, ...filteredManual];

      if (!userRemovedDoseTag) {
        for (const s of (preloadedData.scheduleSchedules || [])) {
          try {
            const calWeeks = generateShockwaveCalendar(s.year, s.month);
            const dayInfo = calWeeks[s.week_index]?.[s.day_index];
            if (!dayInfo) continue;
            if (!shouldUseScheduleRowForPatientHistory(s, dayInfo, {
              targetDate,
              targetRowIndex: r,
              targetColIndex: c,
            })) continue;

            const content = s.content || '';
            const parsed = parseSchedulerPatientIdentity(content);
            if (!matchesSearchIdentity(parsed.patientChart, parsed.patientName)) continue;
            const dateStr = getScheduleDayDateKey(dayInfo);
            const visitSuffix = getExplicitVisitSuffix(content);
            const visitCount = visitSuffix.replace(/[()]/g, '') || '';

            allData.push({
              date: dateStr,
              patient_name: parsed.patientName || '',
              chart_number: parsed.patientChart || '',
              visit_count: visitCount,
              prescription: s.prescription || '',
              body_part: s.body_part || '',
              merge_span: s.merge_span || undefined,
              source: 'schedule',
              type: isManualTherapyRecord({ prescription: s.prescription, patient_name: parsed.patientName }, content) ? 'manual' : 'shockwave',
            });
          } catch {
            // Ignore malformed schedule rows.
          }
        }
      }
    } else {
      const shockwaveQuery = supabase.from('shockwave_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part, source, scheduler_cell_key')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(500);

      const manualQuery = supabase.from('manual_therapy_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(500);

      const scheduleQuery = supabase.from('shockwave_schedules')
        .select('id, year, month, week_index, day_index, row_index, col_index, content, prescription, body_part, merge_span')
        .neq('content', '')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1000);

      if (searchChart) {
        shockwaveQuery.eq('chart_number', searchChart);
        manualQuery.eq('chart_number', searchChart);
        scheduleQuery.ilike('content', `%${searchChart}%`);
      } else if (searchName) {
        shockwaveQuery.ilike('patient_name', `%${searchName}%`);
        manualQuery.ilike('patient_name', `%${searchName}%`);
        scheduleQuery.ilike('content', `%${searchName}%`);
      }

      const promiseTimeout = (promise, ms) => {
        let timeout = new Promise((_, reject) => {
          let id = setTimeout(() => {
            clearTimeout(id);
            reject(new Error('Supabase query timed out'));
          }, ms);
        });
        return Promise.race([promise, timeout]);
      };

      const [shockwaveRes, manualRes, scheduleRes] = await promiseTimeout(
        Promise.all([shockwaveQuery, manualQuery, scheduleQuery]),
        8000
      ).catch((err) => {
        console.warn('Supabase auto-text log query failed or timed out:', err);
        return [{ data: [] }, { data: [] }, { data: [] }];
      });

      const normalizedShockwaveData = (shockwaveRes.data || [])
        .filter((item) => !isUnmarkedSameDaySchedulerLog(item, targetDate))
        .map((item) => ({
          ...item,
          type: isManualTherapyRecord(item) ? 'manual' : 'shockwave',
        }));
      allData = userRemovedDoseTag
        ? normalizedShockwaveData.filter((item) => item.type === 'shockwave')
        : [
            ...normalizedShockwaveData,
            ...(manualRes.data || []).map((item) => ({ ...item, type: 'manual' })),
          ];

      if (!userRemovedDoseTag) {
        const scheduleData = scheduleRes.data || [];
        for (const s of scheduleData) {
          try {
            const calWeeks = generateShockwaveCalendar(s.year, s.month);
            const dayInfo = calWeeks[s.week_index]?.[s.day_index];
            if (!dayInfo) continue;
            if (!shouldUseScheduleRowForPatientHistory(s, dayInfo, {
              targetDate,
              targetRowIndex: r,
              targetColIndex: c,
            })) continue;

            const content = s.content || '';
            const parsed = parseSchedulerPatientIdentity(content);
            if (!matchesSearchIdentity(parsed.patientChart, parsed.patientName)) continue;
            const dateStr = getScheduleDayDateKey(dayInfo);

            const visitSuffix = getExplicitVisitSuffix(content);
            const visitCount = visitSuffix.replace(/[()]/g, '') || '';

            allData.push({
              date: dateStr,
              patient_name: parsed.patientName || '',
              chart_number: parsed.patientChart || '',
              visit_count: visitCount,
              prescription: s.prescription || '',
              body_part: s.body_part || '',
              merge_span: s.merge_span || undefined,
              source: 'schedule',
              type: isManualTherapyRecord({ prescription: s.prescription, patient_name: parsed.patientName }, content) ? 'manual' : 'shockwave',
            });
          } catch {
            // Ignore malformed schedule rows.
          }
        }
      }
    }

    const matches = allData.filter((item) => {
      return matchesSearchIdentity(item.chart_number, item.patient_name);
    });

    if (matches.length === 0) {
      if (searchChart) {
        return buildUnknownPatientResult();
      }

      const schedulerResult = await applySchedulerOption();
      if (schedulerResult) return schedulerResult;

      return userRemovedDoseTag
        ? {
            text: rawName,
            prescription: '',
            bodyPart: '',
            mergeSpan: clearPatientMergeSpan(),
          }
        : buildUnknownPatientResult();
    }

    matches.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
    });

    const candidateMap = new Map();
    matches.forEach((item) => {
      const chartNumber = String(item.chart_number || '').trim();
      const itemPrescriptionForMeta = getHistoryPrescription(item);
      const doseTag = item.type === 'manual' ? getManualDoseTag(itemPrescriptionForMeta) : '';
      const candidateKey = chartNumber ? `${chartNumber}__${item.type}` : `${normalizeNameForMatch(item.patient_name)}__${item.type}`;
      if (!candidateMap.has(candidateKey)) {
        candidateMap.set(candidateKey, {
          chartNumber,
          type: item.type,
          doseTag,
          latestItem: item,
          latestNonEmptyBodyPart: '',
          latestNonEmptyPrescription: '',
          latestMergeSpanWithMemoList: null,
          bodyPartsMap: new Map(),
          bodyPartVisitMap: new Map(),
          prescriptions: new Set(),
        });
      }
      const candidate = candidateMap.get(candidateKey);
      const isFresherOrRicherItem = compareHistoryItemFreshness(item, candidate.latestItem) > 0;
      if (isFresherOrRicherItem) {
        candidate.latestItem = item;
        candidate.doseTag = doseTag;
      }
      if (item.merge_span && getMemoListFromMergeSpan(item.merge_span).length > 0) {
        if (!candidate.latestMergeSpanWithMemoList || item.date >= (candidate.latestMergeSpanDate || '')) {
          candidate.latestMergeSpanWithMemoList = item.merge_span;
          candidate.latestMergeSpanDate = item.date;
        }
      }
      const itemBodyPartForMeta = getHistoryBodyPart(item);
      if (itemBodyPartForMeta) {
        splitBodyParts(itemBodyPartForMeta).forEach((part) => {
          addBodyPartToMap(candidate.bodyPartsMap, part);
          const normalizedPartKey = normalizeBodyPartKey(part);
          const rawItemVisit = String(item.visit_count || '').trim();
          const isHyphen = rawItemVisit === '-';
          const isSameDay = targetDate && item.date === targetDate;
          const itemVisit = rawItemVisit === '*' ? 1 : (parseInt(rawItemVisit, 10) || 0);
          
          let nextVisit;
          if (isHyphen) {
            nextVisit = '-';
          } else if (isSameDay) {
            nextVisit = rawItemVisit || 1;
          } else {
            nextVisit = itemVisit > 0 ? itemVisit + 1 : 1;
          }

          if (!forceOverrideSession && manualSession !== null) {
            nextVisit = manualSession;
          }

          const existingVisitInfo = candidate.bodyPartVisitMap.get(normalizedPartKey);
          if (
            !existingVisitInfo ||
            item.date > existingVisitInfo.lastDate ||
            (item.date === existingVisitInfo.lastDate && itemVisit > existingVisitInfo.lastVisit)
          ) {
            candidate.bodyPartVisitMap.set(normalizedPartKey, {
              name: part,
              lastDate: item.date || '',
              lastVisit: itemVisit,
              nextVisit,
            });
          }
        });
      }
      const itemBodyPart = itemBodyPartForMeta;
      if (
        itemBodyPart &&
        (
          !candidate.latestNonEmptyBodyPart ||
          compareHistoryItemFreshness(item, candidate.latestNonEmptyBodyPartItem) > 0
        )
      ) {
        candidate.latestNonEmptyBodyPart = itemBodyPart;
        candidate.latestNonEmptyBodyPartItem = item;
      }
      const itemPrescription = itemPrescriptionForMeta;
      if (itemPrescription) {
        candidate.prescriptions.add(itemPrescription);
        if (
          !candidate.latestNonEmptyPrescription ||
          compareHistoryItemFreshness(item, candidate.latestNonEmptyPrescriptionItem) > 0
        ) {
          candidate.latestNonEmptyPrescription = itemPrescription;
          candidate.latestNonEmptyPrescriptionItem = item;
        }
      }
    });

    const options = Array.from(candidateMap.values()).map((candidate) => {
      const item = candidate.latestItem;
      const chartNumber = candidate.chartNumber;
      const rawVisit = String(item.visit_count || '').trim();
      const isHyphen = rawVisit === '-';
      const isSameDay = targetDate && item.date === targetDate;
      const lastVisit = rawVisit === '*' ? 1 : (parseInt(rawVisit, 10) || 0);
      
      let nextVisit;
      if (isHyphen) {
        nextVisit = '-';
      } else if (isSameDay) {
        nextVisit = rawVisit || 1;
      } else {
        nextVisit = lastVisit > 0 ? lastVisit + 1 : 1;
      }

      if (!forceOverrideSession && manualSession !== null) {
        nextVisit = manualSession;
      }

      const itemPrescription = getHistoryPrescription(item);
      const isCurrentPrescription = isConfiguredPrescription(itemPrescription);
      const cleanPatientName = String(item.patient_name).replace(/\*/g, '').trim();
      let namePart = item.type === 'manual' && isCurrentPrescription
        ? buildManualNamePart(cleanPatientName, itemPrescription)
        : strip4060FromContent(cleanPatientName);
      if (userRemovedDoseTag) {
        namePart = strip4060FromContent(namePart);
      }
      const latestBodyPart = getHistoryBodyPart(item)
        || candidate.latestNonEmptyBodyPart
        || '';
      const latestPrescription = getHistoryPrescription(item)
        || candidate.latestNonEmptyPrescription
        || '';
      const prescriptions = Array.from(candidate.prescriptions);
      const bodyPartVisitMap = Object.fromEntries(candidate.bodyPartVisitMap.entries());
      const preferredBodyPart = currentBodyParts.find((part) => bodyPartVisitMap[normalizeBodyPartKey(part)]) || '';
      const preferredNextVisit = preferredBodyPart
        ? bodyPartVisitMap[normalizeBodyPartKey(preferredBodyPart)]?.nextVisit
        : null;
      const preferredLastVisit = preferredBodyPart
        ? bodyPartVisitMap[normalizeBodyPartKey(preferredBodyPart)]?.lastVisit
        : null;

      const effectiveVisit = isCurrentPrescription
        ? (preferredNextVisit || nextVisit || preferredLastVisit || lastVisit || 1)
        : 1;
      const nextText = `${chartNumber}/${namePart}(${effectiveVisit})`;

      return {
        chartNumber,
        namePart,
        cleanName: cleanPatientName,
        nextVisit,
        displayVisit: effectiveVisit,
        lastDate: item.date || '',
        prescription: latestPrescription,
        latestPrescription,
        prescriptions,
        bodyParts: Array.from(candidate.bodyPartsMap.values()),
        latestBodyPart,
        initialBodyParts: splitBodyParts(latestBodyPart),
        type: item.type,
        doseTag: isCurrentPrescription ? candidate.doseTag : '',
        isCurrentPrescription,
        mergeSpan: candidate.latestMergeSpanWithMemoList 
          ? buildMergeSpanWithMemoList(candidate.latestMergeSpanWithMemoList, getMemoListFromMergeSpan(candidate.latestMergeSpanWithMemoList)) 
          : undefined,
        bodyPartVisitMap,
        preferredBodyPart,
        preferredNextVisit,
        preferredLastVisit,
        optionLabel: getSchedulerHistoryTypeLabel({ type: item.type, doseTag: candidate.doseTag, prescription: latestPrescription }),
        nextText,
      };
    });

    if (options.length === 0) {
      const fallbackResult = {
        text: userRemovedDoseTag ? rawName : markUnknownPatient(rawName),
      };
      if (initialPrescription !== undefined) {
        fallbackResult.prescription = initialPrescription;
      }
      return fallbackResult;
    }

    const sortedOptions = sortAutoFillOptions(options);
    let selected = pickManualOptionForDosePrescription(sortedOptions, taggedManualPrescription)
      || sortedOptions[0];
    if (!selected) return { text: rawName };
    const localSchedulerOption = sortAutoFillOptions(schedulerOptions).find((option) => {
      const optionChart = String(option?.chartNumber || '').trim();
      const selectedChart = String(selected?.chartNumber || '').trim();
      if (optionChart && selectedChart) return optionChart === selectedChart;
      return normalizeNameForMatch(option?.cleanName) === normalizeNameForMatch(selected?.cleanName);
    });
    const localSchedulerOptionIsFreshEnough = localSchedulerOption && (
      !selected?.lastDate ||
      String(localSchedulerOption.lastDate || '') >= String(selected.lastDate || '')
    );
    if (localSchedulerOptionIsFreshEnough) {
      const mergedBodyParts = Array.from(new Set([
        ...(Array.isArray(localSchedulerOption.bodyParts) ? localSchedulerOption.bodyParts : []),
        ...(Array.isArray(selected.bodyParts) ? selected.bodyParts : []),
      ].filter(Boolean)));
      const mergedPrescriptions = Array.from(new Set([
        ...(Array.isArray(localSchedulerOption.prescriptions) ? localSchedulerOption.prescriptions : []),
        ...(Array.isArray(selected.prescriptions) ? selected.prescriptions : []),
      ].filter(Boolean)));
      const localPrescription = localSchedulerOption.latestPrescription || localSchedulerOption.prescription || '';
      selected = {
        ...selected,
        prescription: localPrescription || selected.prescription,
        latestPrescription: localPrescription || selected.latestPrescription,
        latestBodyPart: localSchedulerOption.latestBodyPart || selected.latestBodyPart,
        initialBodyParts: localSchedulerOption.initialBodyParts?.length ? localSchedulerOption.initialBodyParts : selected.initialBodyParts,
        bodyParts: mergedBodyParts,
        prescriptions: mergedPrescriptions,
        mergeSpan: localSchedulerOption.mergeSpan || selected.mergeSpan,
        isCurrentPrescription: selected.isCurrentPrescription && isConfiguredPrescription(localPrescription || selected.latestPrescription || selected.prescription),
      };
    }
    if (hasExplicitSearchName && normalizeNameForMatch(selected.cleanName) !== searchName) {
      return buildUnknownPatientResult();
    }

    const selectedPrescription = selected.latestPrescription || selected.prescription || '';
    const shouldOmitSelectedPrescription = !isConfiguredPrescription(selectedPrescription);
    const effectiveVisitCount = shouldOmitSelectedPrescription
      ? 1
      : (selected.preferredNextVisit || selected.nextVisit);
    const oldParsed = parseSchedulerPatientIdentity(originalContent || '');
    const isNewPatient = oldParsed.patientName !== selected.cleanName && oldParsed.patientChart !== selected.chartNumber;
    const shouldOverwriteContent = isNewPatient || Boolean(searchChart);

    const effectiveBodyPart = selected.preferredBodyPart || selected.latestBodyPart || '';
    const inheritedMergeSpan = findLatestSchedulerMemoMeta(
      { w, d, r, c },
      selected.chartNumber,
      selected.cleanName,
      { exclude4060: userRemovedDoseTag }
    );

    if (has4060Pattern(rawName) && initialPrescription !== undefined) {
      const baseMerge = searchChart
        ? (selected.mergeSpan || inheritedMergeSpan || clearPatientMergeSpan())
        : (selected.mergeSpan || inheritedMergeSpan);
      return {
        text: normalizeSchedulerVisitSuffix(rawName),
        prescription: firstConfiguredPrescription(taggedManualPrescription, initialPrescription),
        bodyPart: effectiveBodyPart,
        mergeSpan: buildMergeSpanWithBodyPartOptions(baseMerge, selected.bodyParts),
      };
    }

    let autoText = `${selected.chartNumber}/${selected.namePart}`;
    if (!selected.doseTag && !userRemovedDoseTag && !shouldOmitSelectedPrescription) {
      const pureChartInput = /^\d+$/.test(rawName.replace(/\(\d+\)$/, '').trim());
      if (!pureChartInput) {
        const inputDoseMatch = rawName.match(/(\d{2,3})(?:\(\d+\))?$/);
        if (inputDoseMatch) {
          autoText += inputDoseMatch[1];
        }
      }
    }
    autoText += explicitVisitSuffix || explicitNoteSuffix || `(${effectiveVisitCount})`;
    autoText = normalize4060StarOrder(autoText);

    const autoPrescription = (taggedManualPrescription || initialPrescription !== undefined)
      ? firstConfiguredPrescription(taggedManualPrescription, initialPrescription)
      : (userRemovedDoseTag
        ? normalizeImportedPrescription(selected.latestPrescription || selected.prescription)
        : (has4060Pattern(autoText)
          ? (normalizeImportedPrescription(selected.latestPrescription || selected.prescription) || undefined)
          : (shouldOverwriteContent
            ? normalizeImportedPrescription(selected.latestPrescription || selected.prescription)
            : (normalizeImportedPrescription(selected.latestPrescription || selected.prescription) || undefined))));
    const finalAutoPrescription = shouldOmitSelectedPrescription ? '' : autoPrescription;
    const validSelectedPrescriptions = selected.prescriptions.map(normalizeImportedPrescription).filter(Boolean);
    const needsDialog = (selected.bodyParts.length >= 2 && !selected.preferredBodyPart) || validSelectedPrescriptions.length >= 2;
    if (needsDialog) {
      if (skipDialog) {
        const defaultBodyPart = selected.preferredBodyPart || selected.bodyParts[0] || selected.latestBodyPart || '';
        const defaultPrescription = finalAutoPrescription || normalizeImportedPrescription(selected.latestPrescription || selected.prescription) || validSelectedPrescriptions[0] || '';
        const baseMerge = buildMergeSpanWithMemoList(inheritedMergeSpan, getMemoListFromMergeSpan(inheritedMergeSpan));
        return {
          text: normalizeSchedulerVisitSuffix(`${selected.chartNumber}/${selected.namePart}${explicitVisitSuffix || explicitNoteSuffix || `(${effectiveVisitCount})`}`),
          prescription: defaultPrescription,
          bodyPart: searchChart ? (defaultBodyPart || '') : defaultBodyPart,
          mergeSpan: buildMergeSpanWithBodyPartOptions(baseMerge, selected.bodyParts),
        };
      }
      try {
        const dialogResult = await showAutoFillDialog({
          chartNumber: selected.chartNumber,
          namePart: selected.namePart,
          cleanName: selected.cleanName,
          visitCount: effectiveVisitCount,
          prescription: finalAutoPrescription || '',
          bodyParts: selected.bodyParts,
          latestBodyPart: selected.latestBodyPart,
          initialBodyPart: selected.preferredBodyPart,
          bodyPartVisitMap: selected.bodyPartVisitMap,
          initialMemoList: getMemoListFromMergeSpan(inheritedMergeSpan),
          type: selected.type,
          doseTag: selected.doseTag,
          settings,
        });

        if (!dialogResult) return { text: rawName };

        return {
          text: normalizeSchedulerVisitSuffix(`${dialogResult.chartNumber}/${dialogResult.namePart}${explicitVisitSuffix || explicitNoteSuffix || `(${dialogResult.visitCount})`}`),
          prescription: dialogResult.prescription,
          bodyPart: searchChart ? (dialogResult.bodyPart || '') : dialogResult.bodyPart,
          mergeSpan: buildMergeSpanWithMemoList(inheritedMergeSpan, dialogResult.memoList),
        };
      } catch (err) {
        console.error('autoFillDialog error:', err);
      }
    }

    const baseMerge = searchChart
      ? (selected.mergeSpan || inheritedMergeSpan || clearPatientMergeSpan())
      : (selected.mergeSpan || inheritedMergeSpan);
    const finalMergeSpan = buildMergeSpanWithBodyPartOptions(baseMerge, selected.bodyParts);

    return {
      text: autoText,
      prescription: finalAutoPrescription,
      bodyPart: effectiveBodyPart,
      mergeSpan: finalMergeSpan,
    };
    } catch (err) {
      console.error('buildSchedulerAutoText crash:', err);
      return { text: normalizeSchedulerVisitSuffix(nextValue) };
    }
  }, [
    memos,
    pickManualOptionForDosePrescription,
    showAutoFillDialog,
    shouldAutoFormatSchedulerName,
    weeks,
    settings,
    findLatestSchedulerMemoMeta,
    findSchedulerHistoryCandidates,
    markUnknownPatient,
  ]);

  return { buildSchedulerAutoText };
}
