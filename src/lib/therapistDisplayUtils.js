export function buildDisplayTherapists(therapists, monthlyTherapists) {
  const safeTherapists = Array.isArray(therapists) ? therapists.filter(Boolean) : [];
  const monthlyConfigs = Array.isArray(monthlyTherapists) ? monthlyTherapists.filter(Boolean) : [];

  return safeTherapists.flatMap((therapist, slotIdx) => {
    const slotConfigs = monthlyConfigs
      .filter((item) => item.slot_index === slotIdx && String(item.therapist_name || '').trim())
      .sort((a, b) => (Number(a.start_day) || 1) - (Number(b.start_day) || 1));

    if (slotConfigs.length === 0) {
      const name = String(therapist?.name || `치료사 ${slotIdx + 1}`).trim();
      return [{
        ...therapist,
        key: `slot-${slotIdx}-${name || slotIdx}`,
        slotIdx,
        name,
        displayName: name,
        rangeLabel: '',
      }];
    }

    const groupedByName = new Map();
    slotConfigs.forEach((config) => {
      const name = String(config.therapist_name || '').trim();
      if (!name) return;

      const startDay = Number(config.start_day) || 1;
      const endDay = Number(config.end_day) || 31;
      const existing = groupedByName.get(name);
      if (existing) {
        existing.startDay = Math.min(existing.startDay, startDay);
        existing.endDay = Math.max(existing.endDay, endDay);
        return;
      }

      groupedByName.set(name, {
        ...therapist,
        slotIdx,
        name,
        displayName: name,
        startDay,
        endDay,
      });
    });

    const displayItems = Array.from(groupedByName.values());
    if (displayItems.length === 0) {
      const name = String(therapist?.name || `치료사 ${slotIdx + 1}`).trim();
      return [{
        ...therapist,
        key: `slot-${slotIdx}-${name || slotIdx}`,
        slotIdx,
        name,
        displayName: name,
        rangeLabel: '',
      }];
    }

    return displayItems.map((item) => ({
      ...item,
      key: `slot-${item.slotIdx}-${item.name}-${item.startDay}-${item.endDay}`,
      rangeLabel: `${item.startDay}~${item.endDay}일`,
    }));
  });
}
