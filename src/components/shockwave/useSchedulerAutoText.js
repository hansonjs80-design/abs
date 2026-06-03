import { useCallback } from 'react';
import { generateShockwaveCalendar } from '../../lib/calendarUtils';
import { incrementSessionCount, normalizeNameForMatch } from '../../lib/memoParser';
import { supabase } from '../../lib/supabaseClient';
import {
  get4060PrescriptionFromContent,
  has4060Pattern,
  normalize4060StarOrder,
  strip4060FromContent,
} from '../../lib/schedulerContentFormat';
import {
  addBodyPartToMap,
  buildManualNamePart,
  buildMergeSpanWithBodyPartOptions,
  buildMergeSpanWithMemoList,
  buildSchedulerMemoSortKey,
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

export default function useSchedulerAutoText({
  memos,
  weeks,
  settings,
  setChartSelector,
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

  const pickChartOption = useCallback((options, rawName) => {
    if (!Array.isArray(options) || options.length === 0) return Promise.resolve(null);
    const getOptionSortValue = (option) => {
      const dateValue = String(option?.lastDate || '');
      const visitValue = Number.parseInt(option?.nextVisit || '0', 10) || 0;
      return `${dateValue}-${String(visitValue).padStart(4, '0')}`;
    };
    const distinctCharts = new Set(options.map((option) => String(option.chartNumber || '').trim()).filter(Boolean));
    const distinctTreatmentTypes = new Set(
      options
        .map((option) => option.type)
        .filter((type) => type === 'shockwave' || type === 'manual')
    );
    const shouldShowSelector = distinctCharts.size > 1 || distinctTreatmentTypes.size > 1;
    if (!shouldShowSelector) return Promise.resolve(options[0]);

    const chartOptions = Array.from(
      options.reduce((map, option) => {
        const chartNumber = String(option.chartNumber || '').trim();
        const typeKey = option.type === 'manual' || option.type === 'shockwave' ? option.type : 'default';
        const optionKey = `${chartNumber}__${typeKey}`;
        const existing = map.get(optionKey);
        if (chartNumber && (!existing || getOptionSortValue(option) > getOptionSortValue(existing))) {
          map.set(optionKey, option);
        }
        return map;
      }, new Map()).values()
    ).sort((a, b) => getOptionSortValue(b).localeCompare(getOptionSortValue(a)));

    return new Promise((resolve) => {
      setChartSelector({
        options: chartOptions,
        rawName,
        resolve,
      });
    });
  }, [setChartSelector]);

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
      if (!memo?.content) return;
      if (memoKey === targetMemoKey) return;
      const sortKey = buildSchedulerMemoSortKey(memoKey, weeks);
      const sortDate = sortKey?.slice(0, 10) || '';
      if (!sortKey) return;
      if (targetDate) {
        if (sortDate > targetDate) return;
      } else if (currentSortKey && sortKey >= currentSortKey) {
        return;
      }

      const parsed = parseSchedulerPatientText(memo.content);
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

      const memoBodyPart = String(memo.body_part || '').trim();
      if (memoBodyPart && (!candidate.latestNonEmptyBodyPartSortKey || sortKey > candidate.latestNonEmptyBodyPartSortKey)) {
        candidate.latestNonEmptyBodyPart = memoBodyPart;
        candidate.latestNonEmptyBodyPartSortKey = sortKey;
      }

      splitBodyParts(memo.body_part || '').forEach((part) => addBodyPartToMap(candidate.bodyPartsMap, part));
      if (memo.prescription) candidate.prescriptions.add(memo.prescription);
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

        const effectiveLatestBodyPart = String(candidate.latestMemo?.body_part || '').trim()
          || candidate.latestNonEmptyBodyPart
          || '';

        return {
          chartNumber: candidate.chartNumber,
          namePart: incrementedParsed?.rawName || latestParsed?.rawName || '',
          cleanName: latestParsed?.cleanName || '',
          nextText,
          nextVisit,
          lastDate: latestDate,
          prescription: candidate.latestMemo?.prescription || '',
          prescriptions: Array.from(candidate.prescriptions),
          bodyParts: Array.from(candidate.bodyPartsMap.values()),
          latestBodyPart: effectiveLatestBodyPart,
          initialBodyParts: splitBodyParts(effectiveLatestBodyPart),
          type: 'scheduler',
          doseTag: '',
          optionLabel: candidate.latestMemo?.prescription || '최근 스케줄',
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
    let rawName = normalizeSchedulerVisitSuffix(nextValue);
    if (!shouldAutoFormatSchedulerName(rawName)) return { text: rawName };

    let initialPrescription = undefined;
    if (has4060Pattern(rawName)) {
      rawName = normalize4060StarOrder(rawName);
      initialPrescription = get4060PrescriptionFromContent(rawName) || undefined;
    }

    let manualSession = null;
    const inputParenMatch = rawName.match(/\((\d+)\)$/);
    if (inputParenMatch) {
      manualSession = parseInt(inputParenMatch[1], 10);
    }
    const explicitVisitSuffix = getExplicitVisitSuffix(rawName);
    const explicitNoteSuffix = getNonVisitParentheticalSuffix(rawName);

    const dayInfo = weeks[w]?.[d];
    if (!dayInfo) return { text: rawName };
    const targetDate = `${dayInfo.year}-${String(dayInfo.month).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
    const memoKey = `${w}-${d}-${r}-${c}`;
    const clearPatientMergeSpan = () => stripReservationTimeFromMergeSpan(
      buildMergeSpanWithBodyPartOptions(
        buildMergeSpanWithMemoList(memos[memoKey]?.merge_span, []),
        []
      )
    );
    const currentBodyParts = splitBodyParts(memos[memoKey]?.body_part || '');

    const previousContent = originalContent !== undefined ? String(originalContent).trim() : String(memos[memoKey]?.content || '').trim();
    const userRemovedDoseTag = has4060Pattern(previousContent) && !has4060Pattern(rawName);
    const parsedIdentity = parseSchedulerPatientIdentity(rawName);
    const searchChart = parsedIdentity.patientChart ? String(parsedIdentity.patientChart).trim() : null;
    const searchName = normalizeNameForMatch(parsedIdentity.patientName) || normalizeNameForMatch(rawName);
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

    const schedulerOptions = findSchedulerHistoryCandidates({ w, d, r, c }, rawName, targetDate)
      .filter((option) => !userRemovedDoseTag || !has4060Pattern(option.nextText));
    const applySchedulerOption = async () => {
      if (schedulerOptions.length === 0) return null;
      const selected = (schedulerOptions.length === 1 || skipDialog)
        ? schedulerOptions[0]
        : await pickChartOption(schedulerOptions, rawName);
      if (!selected) return { text: rawName };

      const inputHas4060 = has4060Pattern(rawName);
      const baseMerge = searchChart ? (selected.mergeSpan || clearPatientMergeSpan()) : selected.mergeSpan;
      const finalMergeSpan = buildMergeSpanWithBodyPartOptions(baseMerge, selected.bodyParts);

      if (inputHas4060 && !has4060Pattern(selected.nextText)) {
        return {
          text: rawName,
          prescription: initialPrescription || undefined,
          bodyPart: searchChart ? (selected.latestBodyPart || '') : (selected.latestBodyPart || undefined),
          mergeSpan: finalMergeSpan,
        };
      }

      const autoPrescription = initialPrescription !== undefined
        ? initialPrescription
        : (has4060Pattern(selected.nextText)
          ? undefined
          : (searchChart ? (selected.prescription || '') : (selected.prescription || undefined)));

      return {
        text: (explicitVisitSuffix || explicitNoteSuffix) ? rawName : selected.nextText,
        prescription: autoPrescription,
        bodyPart: searchChart ? (selected.latestBodyPart || '') : (selected.latestBodyPart || undefined),
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
        const filteredSchedules = (preloadedData.scheduleSchedules || []).filter((s) => {
          const content = s.content || '';
          const parsed = parseSchedulerPatientIdentity(content);
          return matchesSearchIdentity(parsed.patientChart, parsed.patientName);
        });

        const seenLogDates = new Set(allData.map((item) => item.date));
        for (const s of filteredSchedules) {
          try {
            const calWeeks = generateShockwaveCalendar(s.year, s.month);
            const dayInfo = calWeeks[s.week_index]?.[s.day_index];
            if (!dayInfo) continue;
            const dd = dayInfo.date;
            const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;

            if (dateStr > targetDate) continue;
            if (seenLogDates.has(dateStr)) continue;

            const content = s.content || '';
            const parsed = parseSchedulerPatientIdentity(content);
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
              type: isManualTherapyRecord({ prescription: s.prescription, patient_name: parsed.patientName }, content) ? 'manual' : 'shockwave',
            });
            seenLogDates.add(dateStr);
          } catch {
            // Ignore malformed schedule rows.
          }
        }
      }
    } else {
      const shockwaveQuery = supabase.from('shockwave_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(500);

      const manualQuery = supabase.from('manual_therapy_patient_logs')
        .select('patient_name, chart_number, visit_count, date, prescription, body_part')
        .lte('date', targetDate)
        .order('date', { ascending: false })
        .limit(500);

      const scheduleQuery = supabase.from('shockwave_schedules')
        .select('id, year, month, week_index, day_index, content, prescription, body_part, merge_span')
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

      const [shockwaveRes, manualRes, scheduleRes] = await Promise.all([shockwaveQuery, manualQuery, scheduleQuery]);

      const normalizedShockwaveData = (shockwaveRes.data || []).map((item) => ({
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
        const seenLogDates = new Set(allData.map((item) => item.date));

        for (const s of scheduleData) {
          try {
            const calWeeks = generateShockwaveCalendar(s.year, s.month);
            const dayInfo = calWeeks[s.week_index]?.[s.day_index];
            if (!dayInfo) continue;
            const dd = dayInfo.date;
            const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;

            if (dateStr > targetDate) continue;
            if (seenLogDates.has(dateStr)) continue;

            const content = s.content || '';
            const parsed = parseSchedulerPatientIdentity(content);
            if (!matchesSearchIdentity(parsed.patientChart, parsed.patientName)) continue;

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
              type: isManualTherapyRecord({ prescription: s.prescription, patient_name: parsed.patientName }, content) ? 'manual' : 'shockwave',
            });
            seenLogDates.add(dateStr);
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
        return {
          text: markUnknownPatient(rawName),
          prescription: initialPrescription || '',
          bodyPart: '',
          mergeSpan: clearPatientMergeSpan(),
        };
      }

      const schedulerResult = await applySchedulerOption();
      if (schedulerResult) return schedulerResult;

      return userRemovedDoseTag
        ? {
            text: rawName,
            prescription: initialPrescription || '',
            bodyPart: '',
            mergeSpan: clearPatientMergeSpan(),
          }
        : { text: rawName, prescription: initialPrescription };
    }

    matches.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (parseInt(b.visit_count || '0', 10) || 0) - (parseInt(a.visit_count || '0', 10) || 0);
    });

    const candidateMap = new Map();
    matches.forEach((item) => {
      const chartNumber = String(item.chart_number || '').trim();
      const doseTag = item.type === 'manual' ? getManualDoseTag(item.prescription) : '';
      const candidateKey = chartNumber ? `${chartNumber}__${item.type}` : `${normalizeNameForMatch(item.patient_name)}__${item.type}`;
      if (!candidateMap.has(candidateKey)) {
        candidateMap.set(candidateKey, {
          chartNumber,
          type: item.type,
          doseTag,
          latestItem: item,
          latestNonEmptyBodyPart: '',
          latestMergeSpanWithMemoList: null,
          bodyPartsMap: new Map(),
          bodyPartVisitMap: new Map(),
          prescriptions: new Set(),
        });
      }
      const candidate = candidateMap.get(candidateKey);
      const itemVisit = parseInt(item.visit_count || '0', 10) || 0;
      const latestVisit = parseInt(candidate.latestItem?.visit_count || '0', 10) || 0;
      if (
        !candidate.latestItem ||
        item.date > candidate.latestItem.date ||
        (item.date === candidate.latestItem.date && itemVisit > latestVisit)
      ) {
        candidate.latestItem = item;
        candidate.doseTag = doseTag;
      }
      if (item.merge_span && getMemoListFromMergeSpan(item.merge_span).length > 0) {
        if (!candidate.latestMergeSpanWithMemoList || item.date >= (candidate.latestMergeSpanDate || '')) {
          candidate.latestMergeSpanWithMemoList = item.merge_span;
          candidate.latestMergeSpanDate = item.date;
        }
      }
      if (item.body_part) {
        splitBodyParts(item.body_part).forEach((part) => {
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
      const itemBodyPart = String(item.body_part || '').trim();
      if (itemBodyPart && !candidate.latestNonEmptyBodyPart) {
        candidate.latestNonEmptyBodyPart = itemBodyPart;
      }
      if (item.prescription) {
        candidate.prescriptions.add(item.prescription);
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

      const cleanPatientName = String(item.patient_name).replace(/\*/g, '').trim();
      let namePart = item.type === 'manual'
        ? buildManualNamePart(cleanPatientName, item.prescription)
        : cleanPatientName;
      if (userRemovedDoseTag) {
        namePart = strip4060FromContent(namePart);
      }
      const latestBodyPart = String(item.body_part || '').trim()
        || candidate.latestNonEmptyBodyPart
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

      return {
        chartNumber,
        namePart,
        cleanName: cleanPatientName,
        nextVisit,
        displayVisit: preferredLastVisit || lastVisit || nextVisit,
        lastDate: item.date || '',
        prescription: item.prescription || '',
        prescriptions,
        bodyParts: Array.from(candidate.bodyPartsMap.values()),
        latestBodyPart,
        initialBodyParts: splitBodyParts(latestBodyPart),
        type: item.type,
        doseTag: candidate.doseTag,
        mergeSpan: candidate.latestMergeSpanWithMemoList 
          ? buildMergeSpanWithMemoList(candidate.latestMergeSpanWithMemoList, getMemoListFromMergeSpan(candidate.latestMergeSpanWithMemoList)) 
          : undefined,
        bodyPartVisitMap,
        preferredBodyPart,
        preferredNextVisit,
        preferredLastVisit,
        optionLabel: getSchedulerHistoryTypeLabel({ type: item.type, doseTag: candidate.doseTag, prescription: item.prescription }),
      };
    });

    if (options.length === 0) return { text: rawName };

    const selected = (options.length === 1 || skipDialog)
      ? options[0]
      : await pickChartOption(options, rawName);
    if (!selected) return { text: rawName };
    if (hasExplicitSearchName && normalizeNameForMatch(selected.cleanName) !== searchName) {
      return {
        text: markUnknownPatient(rawName),
        prescription: initialPrescription || '',
        bodyPart: '',
        mergeSpan: clearPatientMergeSpan(),
      };
    }

    const effectiveVisitCount = selected.preferredNextVisit || selected.nextVisit;
    const oldParsed = parseSchedulerPatientIdentity(originalContent || '');
    const isNewPatient = oldParsed.patientName !== selected.cleanName && oldParsed.patientChart !== selected.chartNumber;
    const shouldOverwriteContent = isNewPatient || Boolean(searchChart);

    const effectiveBodyPart = shouldOverwriteContent
      ? (selected.preferredBodyPart || selected.latestBodyPart || '')
      : (selected.preferredBodyPart || selected.latestBodyPart || undefined);

    let autoText = `${selected.chartNumber}/${selected.namePart}`;
    if (!selected.doseTag && !userRemovedDoseTag) {
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

    const autoPrescription = initialPrescription !== undefined
      ? initialPrescription
      : (userRemovedDoseTag
        ? (selected.prescription || '')
        : (has4060Pattern(autoText) ? undefined : (shouldOverwriteContent ? (selected.prescription || '') : (selected.prescription || undefined))));
    const inheritedMergeSpan = findLatestSchedulerMemoMeta(
      { w, d, r, c },
      selected.chartNumber,
      selected.cleanName,
      { exclude4060: userRemovedDoseTag }
    );
    const needsDialog = (selected.bodyParts.length >= 2 && !selected.preferredBodyPart) || selected.prescriptions.length >= 2;
    if (needsDialog) {
      if (skipDialog) {
        const defaultBodyPart = selected.preferredBodyPart || selected.bodyParts[0] || selected.latestBodyPart || '';
        const defaultPrescription = autoPrescription || selected.prescription || selected.prescriptions[0] || '';
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
          prescription: autoPrescription || '',
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

    const baseMerge = searchChart ? (selected.mergeSpan || clearPatientMergeSpan()) : selected.mergeSpan;
    const finalMergeSpan = buildMergeSpanWithBodyPartOptions(baseMerge, selected.bodyParts);

    return {
      text: autoText,
      prescription: autoPrescription,
      bodyPart: effectiveBodyPart,
      mergeSpan: finalMergeSpan,
    };
  }, [
    memos,
    pickChartOption,
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
