/**
 * The study calendar: one square per day, weeks as columns, GitHub-style.
 *
 * Shading is by how much was reviewed, in four steps of the app's pink.
 * The steps are **quartiles of the days on screen**, not fixed thresholds, for
 * the same reason GitHub does it: a fixed "50+ is darkest" is permanently dark
 * for a heavy reviewer and permanently pale for a light one, where quartiles
 * always spread one person's own weeks across the whole ramp.
 *
 * Two states sit outside the ramp and must stay visibly different from it:
 * a day that only logged grammar is outlined in grammar's own blue (present,
 * never counted — see `CalendarDay`), and today carries a ring so it can be
 * found at a glance.
 *
 * Tapping a square names it — date and exact count — so no reading depends on
 * telling two neighbouring shades apart.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import type { CalendarDay } from '@/data/types';
import { feedback } from '@/feedback';
import { isoDate } from '@/hooks/useStudyData';
import { colors, type as typeScale } from '@/theme/tokens';

/**
 * Empty, then four steps ending on the brand pink itself (`colors.kanji`) — the
 * logo, the active tab, the primary buttons. The lighter three share its hue
 * (≈3° in OKLCH) and step evenly in lightness, 0.95 → 0.88 → 0.80 → 0.72 →
 * 0.64, so each shade reads as one notch darker than the last. `kanjiTint` is
 * not among them: it is so pale it would barely separate from an empty day.
 */
export const CALENDAR_RAMP = ['#EEEEF1', '#FCC5D1', '#FC9EB6', '#F4759A', colors.kanji] as const;

const GAP = 3;
const TARGET_CELL = 14;
const WEEKDAY_GUTTER = 24;
const MONTH_ROW = 15;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/**
 * Count → shade step, 0–4. Quartiles of the active days; with fewer than four
 * distinct counts there are no quartiles worth the name, so it falls back to a
 * share of the busiest day.
 */
export function shadeFor(counts: number[]): (count: number) => number {
  const active = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (active.length === 0) return () => 0;

  const max = active[active.length - 1];
  if (new Set(active).size < 4) {
    return (c) => (c <= 0 ? 0 : Math.max(1, Math.ceil((4 * c) / max)));
  }

  const at = (p: number) => active[Math.floor(p * (active.length - 1))];
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)];
  return (c) => (c <= 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4);
}

type Cell = { date: string; day?: CalendarDay };

export function ActivityCalendar({ days }: { days: CalendarDay[] }) {
  const [width, setWidth] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);

  const onLayout = React.useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.floor(event.nativeEvent.layout.width));
  }, []);

  const byDate = React.useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const lastDate = days.length > 0 ? days[days.length - 1].date : isoDate(new Date());

  // As many whole weeks as fit, with the cells stretched a little to fill the
  // width exactly rather than leaving a ragged gap on the right.
  const available = Math.max(0, width - WEEKDAY_GUTTER);
  const weeks = Math.max(1, Math.floor((available + GAP) / (TARGET_CELL + GAP)));
  const cell = width > 0 ? (available - GAP * (weeks - 1)) / weeks : TARGET_CELL;

  const columns = React.useMemo(() => {
    const end = parseDate(lastDate);
    const start = new Date(end);
    start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);

    const out: Cell[][] = [];
    for (let w = 0; w < weeks; w += 1) {
      const column: Cell[] = [];
      for (let d = 0; d < 7; d += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const iso = isoDate(date);
        if (iso > lastDate) break; // the rest of this week has not happened
        column.push({ date: iso, day: byDate.get(iso) });
      }
      out.push(column);
    }
    return out;
  }, [byDate, lastDate, weeks]);

  const visible = columns.flat();
  const shade = shadeFor(visible.map((c) => c.day?.count ?? 0));
  const total = visible.reduce((sum, c) => sum + (c.day?.count ?? 0), 0);
  const earliest = days.length > 0 ? days[0].date : lastDate;

  const monthLabels = columns.flatMap((column, i) => {
    if (i === 0 || column.length === 0 || columns[i - 1].length === 0) return [];
    const month = parseDate(column[0].date).getMonth();
    const previous = parseDate(columns[i - 1][0].date).getMonth();
    return month === previous ? [] : [{ i, label: MONTHS[month] }];
  });

  const picked = selected ? byDate.get(selected) : undefined;

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <>
          <View style={{ height: MONTH_ROW }}>
            {monthLabels.map(({ i, label }) => (
              <Text
                key={i}
                style={[styles.axisText, styles.month, { left: WEEKDAY_GUTTER + i * (cell + GAP) }]}
              >
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.body}>
            <View style={[styles.weekdays, { width: WEEKDAY_GUTTER, gap: GAP }]}>
              {WEEKDAYS.map((name, d) => (
                <Text key={name} style={[styles.axisText, { height: cell, lineHeight: cell }]}>
                  {d % 2 === 1 ? name : ''}
                </Text>
              ))}
            </View>

            <View style={[styles.grid, { gap: GAP }]}>
              {columns.map((column, w) => (
                <View key={w} style={{ gap: GAP }}>
                  {column.map(({ date, day }) => {
                    // Before the data starts is unknown, not empty — offline, only
                    // the last week is known, and blank squares would claim the
                    // rest of the half-year went unstudied.
                    if (date < earliest) return <View key={date} style={{ width: cell, height: cell }} />;

                    const count = day?.count ?? 0;
                    const isToday = date === lastDate;
                    return (
                      <Pressable
                        key={date}
                        hitSlop={1}
                        onPress={() => {
                          feedback.tap();
                          setSelected((current) => (current === date ? null : date));
                        }}
                        accessibilityLabel={describe(date, day)}
                        style={[
                          styles.cell,
                          { width: cell, height: cell },
                          count > 0
                            ? { backgroundColor: CALENDAR_RAMP[shade(count)] }
                            : day?.grammarOnly
                              ? styles.cellGrammar
                              : { backgroundColor: CALENDAR_RAMP[0] },
                          isToday && styles.cellToday,
                          selected === date && styles.cellSelected,
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.caption} numberOfLines={1}>
              {selected
                ? describe(selected, picked)
                : `${total.toLocaleString()} reviews in ${weeks} weeks`}
            </Text>
            <View style={styles.legend}>
              <Text style={styles.axisText}>Less</Text>
              {CALENDAR_RAMP.map((color) => (
                <View key={color} style={[styles.legendCell, { backgroundColor: color }]} />
              ))}
              <Text style={styles.axisText}>More</Text>
            </View>
          </View>
        </>
      ) : (
        <View style={{ height: MONTH_ROW + 7 * TARGET_CELL + 6 * GAP + 24 }} />
      )}
    </View>
  );
}

/** "Tue, Sep 16 · 42 reviews" — what a tapped square says, and its screen-reader label. */
function describe(date: string, day: CalendarDay | undefined): string {
  const d = parseDate(date);
  const when = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const count = day?.count ?? 0;
  if (count > 0) return `${when} · ${count} ${count === 1 ? 'review' : 'reviews'}`;
  if (day?.grammarOnly) return `${when} · grammar logged, not counted`;
  return `${when} · no reviews`;
}

const styles = StyleSheet.create({
  body: {
    flexDirection: 'row',
  },
  weekdays: {
    flexDirection: 'column',
  },
  grid: {
    flexDirection: 'row',
  },
  axisText: {
    fontFamily: typeScale.meta.fontFamily,
    fontSize: 9.5,
    color: colors.inkFaint,
  },
  month: {
    position: 'absolute',
    top: 0,
  },
  cell: {
    borderRadius: 3,
  },
  /**
   * Hollow, in grammar's blue — the colour of the grammar screens — so it
   * reads as "grammar happened" rather than as a pale shade of studying.
   */
  cellGrammar: {
    backgroundColor: colors.radicalTint,
    borderWidth: 1.5,
    borderColor: colors.radical,
  },
  cellToday: {
    borderWidth: 1.5,
    borderColor: colors.inkMuted,
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: colors.ink,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  caption: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    flexShrink: 1,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
});
