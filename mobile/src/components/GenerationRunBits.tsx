/**
 * Shared pieces of the question catalog: how a run's status, trigger and time
 * are shown. Used by the run list and the run detail, so the two never
 * describe the same run in different words.
 */
import * as React from 'react';

import { Pill } from '@/components/ui';
import type { GenerationRunStatus, QuestionStanding } from '@/data/types';
import { colors } from '@/theme/tokens';

const STATUS: Record<GenerationRunStatus, { label: string; color: string; background: string }> = {
  completed: { label: 'done', color: colors.successInk, background: colors.successTint },
  running: { label: 'running', color: colors.vocabularyInk, background: colors.vocabularyTint },
  skipped: { label: 'nothing to do', color: colors.inkMuted, background: colors.ground },
  failed: { label: 'failed', color: colors.dangerInk, background: colors.dangerTint },
  // Still marked running long after it began: the worker was killed part-way.
  stalled: { label: "didn't finish", color: colors.warningInk, background: colors.warningTint },
};

export function RunStatusPill({ status }: { status: GenerationRunStatus }) {
  const look = STATUS[status] ?? STATUS.completed;
  return <Pill label={look.label} color={look.color} background={look.background} />;
}

const STANDING: Record<QuestionStanding, { label: string; color: string; background: string }> = {
  served: { label: 'shown to you', color: colors.successInk, background: colors.successTint },
  waiting: { label: 'waiting', color: colors.vocabularyInk, background: colors.vocabularyTint },
  unbundled: { label: 'not in a set', color: colors.inkMuted, background: colors.ground },
  rejected: { label: 'rejected', color: colors.dangerInk, background: colors.dangerTint },
};

export function StandingPill({ standing }: { standing: QuestionStanding }) {
  const look = STANDING[standing] ?? STANDING.unbundled;
  return <Pill label={look.label} color={look.color} background={look.background} />;
}

/** What woke a run, in words. */
export function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'schedule':
      return 'Scheduled';
    case 'LessonBundleClaimed':
      return 'After you opened a set';
    case 'VocabConfirmed':
      return 'After you added words';
    case 'backfilled':
      return 'Before runs were recorded';
    default:
      return 'Started by hand';
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", or "Mon 28 Sep" — the heading a run is grouped under. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "7:02 AM", in the phone's own zone. */
export function timeLabel(iso: string): string {
  const date = new Date(iso);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** "4 minutes ago", "3 hours ago", "2 days ago". */
export function agoLabel(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Groups items under the day they happened, keeping their order. */
export function groupByDay<T>(items: T[], when: (item: T) => string): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayLabel(when(item));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
