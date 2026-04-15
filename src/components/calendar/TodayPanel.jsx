import { useMemo } from 'react';
import { Calendar as CalIcon } from 'lucide-react';
import { useSchedule } from '../../contexts/ScheduleContext';
import { formatTodayScheduleItem, computeMemoFontColor } from '../../lib/memoParser';
import { getTodayKST, isSameDate } from '../../lib/calendarUtils';
import { WEEKDAYS_FULL } from '../../lib/constants';

export default function TodayPanel() {
  const { staffMemos, currentYear, currentMonth } = useSchedule();
  const today = getTodayKST();
  const dow = today.getDay();

  const todayItems = useMemo(() => {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const d = today.getDate();
    const items = [];

    for (let slot = 0; slot < 6; slot++) {
      const key = `${y}-${m}-${d}-${slot}`;
      const memo = staffMemos[key];
      if (!memo?.content) continue;

      const formatted = formatTodayScheduleItem(memo.content, dow);
      if (formatted) {
        const color = computeMemoFontColor(memo.content);
        items.push({ text: formatted, color });
      }
    }
    return items;
  }, [staffMemos, today, dow]);

  const dateLabel = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 ${WEEKDAYS_FULL[dow]}`;

  return (
    <div className="today-panel">
      <div className="today-panel-header">
        <CalIcon size={24} strokeWidth={2.4} />
        {dateLabel}
      </div>
      <div className="today-panel-body">
        {todayItems.length > 0 ? (
          todayItems.map((item, i) => {
            let dotColor = 'var(--text-tertiary)';
            if (item.color === '#3c78d8') dotColor = 'var(--memo-night)';
            else if (item.color === '#9900ff') dotColor = 'var(--memo-off)';
            else if (item.color === '#40a417') dotColor = 'var(--memo-leave)';
            else if (item.color === '#ff6d01') dotColor = 'var(--memo-attend)';
            else if (item.color === '#ff0000') dotColor = 'var(--memo-special)';

            return (
              <div key={i} className="today-panel-item" style={{ color: item.color || 'inherit' }}>
                <span className="today-panel-dot" style={{ background: dotColor }} />
                {item.text}
              </div>
            );
          })
        ) : (
          <div className="today-panel-empty">오늘 등록된 일정이 없습니다</div>
        )}
      </div>
    </div>
  );
}
