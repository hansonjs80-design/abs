const today = new Date();
const weeks = [
  // Week 4 of April
  [
    { date: new Date('2026-04-27T00:00:00Z') },
    { date: new Date('2026-04-28T00:00:00Z') },
    { date: new Date('2026-04-29T00:00:00Z') },
    { date: new Date('2026-04-30T00:00:00Z') },
    { date: new Date('2026-05-01T00:00:00Z') },
    { date: new Date('2026-05-02T00:00:00Z') }
  ]
];

const idx = weeks.findIndex(weekDays => {
  if (!weekDays || weekDays.length === 0) return false;
  const mondayDate = new Date(weekDays[0].date);
  mondayDate.setHours(0, 0, 0, 0);
  const sundayDate = new Date(mondayDate);
  sundayDate.setDate(mondayDate.getDate() + 6);
  sundayDate.setHours(23, 59, 59, 999);
  return today >= mondayDate && today <= sundayDate;
});
console.log("Found index:", idx);
