import React, { useMemo } from 'react';

/**
 * The years, with their weight.
 *
 * A library of six years is not six equal years — there is the summer
 * everything was photographed and the winter nothing was. The bar behind each
 * year says which was which, so choosing where to start is a glance rather
 * than a guess, and the months of the chosen year open underneath it.
 *
 * Counts come from the summary, which the server produces in one grouped
 * query over the whole library. Nothing here loads a photograph.
 */

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export default function TimelineRail({ months, year, month, onPick }) {
  const years = useMemo(() => {
    const byYear = new Map();
    (months || []).forEach(({ month: key, count }) => {
      const [y, m] = key.split('-').map(Number);
      if (!byYear.has(y)) byYear.set(y, { year: y, total: 0, months: new Map() });
      const entry = byYear.get(y);
      entry.total += count;
      entry.months.set(m, (entry.months.get(m) || 0) + count);
    });
    return [...byYear.values()].sort((a, b) => b.year - a.year);
  }, [months]);

  const heaviest = years.reduce((max, y) => Math.max(max, y.total), 0) || 1;

  if (!years.length) return null;

  return (
    <nav className="gal-rail" aria-label="연도별 보기">
      <button
        type="button"
        className={`gal-rail-all ${!year ? 'is-on' : ''}`}
        onClick={() => onPick({ year: null, month: null })}
      >
        전체
      </button>

      {years.map((entry) => {
        const isOpen = year === entry.year;
        const monthsOfYear = [...entry.months.entries()].sort((a, b) => b[0] - a[0]);
        const busiest = Math.max(...entry.months.values(), 1);
        return (
          <div key={entry.year} className={`gal-rail-year ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="gal-rail-year-btn"
              onClick={() => onPick({ year: isOpen ? null : entry.year, month: null })}
              title={`${entry.year}년 · ${entry.total.toLocaleString()}장`}
            >
              <span className="gal-rail-bar" style={{ width: `${Math.max(8, (entry.total / heaviest) * 100)}%` }} />
              <span className="gal-rail-year-label">{entry.year}</span>
              <span className="gal-rail-year-count">{entry.total.toLocaleString()}</span>
            </button>

            {isOpen && (
              <div className="gal-rail-months">
                {monthsOfYear.map(([m, count]) => (
                  <button
                    key={m}
                    type="button"
                    className={`gal-rail-month ${month === m ? 'is-on' : ''}`}
                    onClick={() => onPick({ year: entry.year, month: month === m ? null : m })}
                    title={`${entry.year}년 ${MONTH_NAMES[m - 1]} · ${count.toLocaleString()}장`}
                  >
                    <span
                      className="gal-rail-month-fill"
                      style={{ opacity: 0.18 + 0.62 * (count / busiest) }}
                    />
                    <span>{MONTH_NAMES[m - 1]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
