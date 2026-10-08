/**
 * The streak reminder: a nudge in the evening on a day nothing has been
 * studied yet.
 *
 * Entirely on the phone -- no push server. The next week of evenings is
 * scheduled ahead, one notification each, skipping today once something has
 * been studied, and the whole set is rescheduled whenever the app opens or an
 * answer is given. Scheduling a week rather than one evening is what makes
 * "every once in a while" true: if the app is not opened for days, a reminder
 * still comes each evening, and they stop after a week rather than nagging
 * forever.
 *
 * Best-effort like the sound engine: `expo-notifications` is native, so a
 * build without it -- or a refused permission -- leaves this quiet rather than
 * throwing.
 */
import { Platform } from 'react-native';

import { getPref, setPref } from '@/data/db';

let Notifications: typeof import('expo-notifications') | null = null;
try {
  Notifications = require('expo-notifications');
} catch {
  // No native module in this build.
}

/** Hour of the evening the reminder comes, local time. */
const REMINDER_HOUR = 19;
/** How many evenings ahead are scheduled. */
const DAYS_AHEAD = 7;
const CHANNEL = 'streak-reminders';
const ID_PREFIX = 'streak-reminder-';

const PREF_ENABLED = 'reminders_enabled';
const PREF_STUDIED_ON = 'last_study_date';
const PREF_STREAK = 'streak_days';
const PREF_ASKED = 'reminders_permission_asked';

/** "2026-10-08" in local time -- the day the streak counts in. */
function localDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function remindersEnabled(): Promise<boolean> {
  return (await getPref(PREF_ENABLED).catch(() => null)) !== '0';
}

/**
 * Asks once, on Android 13+ and iOS, for permission to notify. Asked the first
 * time the app has a streak worth protecting rather than on first launch, so
 * the request comes with an obvious reason.
 */
async function ensurePermission(): Promise<boolean> {
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if ((await getPref(PREF_ASKED).catch(() => null)) === '1' && !current.canAskAgain) return false;
  await setPref(PREF_ASKED, '1').catch(() => undefined);
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function ensureChannel(): Promise<void> {
  if (!Notifications || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Streak reminders',
    description: 'An evening nudge on days you have not studied yet.',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function cancelScheduled(): Promise<void> {
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(ID_PREFIX))
      .map((n) => Notifications!.cancelScheduledNotificationAsync(n.identifier)),
  );
}

function message(streak: number, daysMissed: number): { title: string; body: string } {
  if (streak > 0 && daysMissed === 0) {
    return {
      title: `Keep your ${streak}-day streak going`,
      body: 'A few reviews or one lesson keeps it alive. 🐊',
    };
  }
  return {
    title: 'A little Japanese today?',
    body: 'Your reviews and lessons are waiting — five minutes is enough. 🐊',
  };
}

/**
 * Replaces the scheduled reminders with a fresh week of them.
 *
 * `streakDays` is the current streak, used for the wording; whether today is
 * already done comes from the last day an answer was given on this phone, or
 * `studiedToday` when the caller knows better (the dashboard's own week).
 */
export async function rescheduleReminders(
  options: { streakDays?: number; studiedToday?: boolean } = {},
): Promise<void> {
  if (!Notifications) return;
  try {
    if (options.streakDays !== undefined) {
      await setPref(PREF_STREAK, String(options.streakDays));
    }
    await cancelScheduled();
    if (!(await remindersEnabled())) return;
    if (!(await ensurePermission())) return;
    await ensureChannel();

    const today = localDay();
    const studiedToday =
      options.studiedToday || (await getPref(PREF_STUDIED_ON).catch(() => null)) === today;
    const streak = Number((await getPref(PREF_STREAK).catch(() => null)) ?? 0) || 0;
    const now = new Date();

    for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
      if (offset === 0 && studiedToday) continue;
      const at = new Date(now);
      at.setDate(now.getDate() + offset);
      at.setHours(REMINDER_HOUR, 0, 0, 0);
      if (at <= now) continue;

      // Days already missed by that evening. While none are, the streak is
      // still there to keep; after one, it has ended, and the wording stops
      // promising it.
      const missed = studiedToday ? offset - 1 : offset;
      const { title, body } = message(streak, missed);
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${localDay(at)}`,
        content: { title, body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: CHANNEL,
        },
      });
    }
  } catch {
    // A reminder is a nicety; never let it break the screen that asked.
  }
}

/** Something was studied: no reminder tonight. */
export async function markStudiedToday(): Promise<void> {
  const today = localDay();
  if ((await getPref(PREF_STUDIED_ON).catch(() => null)) === today) return;
  await setPref(PREF_STUDIED_ON, today).catch(() => undefined);
  await rescheduleReminders({ studiedToday: true });
}

/** The switch in "How it feels". Off cancels everything scheduled. */
export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  await setPref(PREF_ENABLED, enabled ? '1' : '0').catch(() => undefined);
  await rescheduleReminders();
}

export const remindersAvailable = Notifications !== null;
