/**
 * What has not reached the server yet, and why.
 *
 * Opened from the "N pending sync" note on the Study tab. Lessons and reviews
 * are queued on the phone and sent to WaniKani through the server; when one
 * keeps failing, the only outward sign used to be that number, and the error
 * behind it was thrown away. Every failed attempt now records what the server
 * (or WaniKani, through it) said, and this lists it.
 *
 * Two groups: writes still being retried, and writes the server refused for
 * good and that were set aside. A set-aside write can be put back in the queue.
 */
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, InlineButton, Overline, Pill } from '@/components/ui';
import { API_BASE_URL } from '@/data/api';
import { listOutbox, requeueWrite, type OutboxEntry } from '@/data/db';
import { syncNow, type SyncResult } from '@/data/sync';
import { feedback } from '@/feedback';
import { colors, spacing, type as typeScale } from '@/theme/tokens';

const TYPE_LABELS: Record<string, string> = {
  start_assignment: 'Lesson finished',
  submit_review: 'Review answered',
  answer_flashcard: 'Flashcard answered',
  answer_event: 'Answer log',
};

export default function SyncStatusScreen() {
  const [entries, setEntries] = React.useState<OutboxEntry[] | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [result, setResult] = React.useState<SyncResult | null>(null);

  const load = React.useCallback(async () => {
    setEntries(await listOutbox());
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  const sendNow = React.useCallback(async () => {
    feedback.tap();
    setSyncing(true);
    try {
      setResult(await syncNow());
    } finally {
      setSyncing(false);
      await load();
    }
  }, [load]);

  const queued = (entries ?? []).filter((e) => !e.failedAt);
  const setAside = (entries ?? []).filter((e) => e.failedAt);
  // The log of every answer is not study progress; it goes up in batches and
  // is listed last so it does not bury the lessons and reviews.
  const studyQueued = queued.filter((e) => e.type !== 'answer_event');
  const logQueued = queued.filter((e) => e.type === 'answer_event');

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Sync" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        <Card variant="bordered" style={styles.summary}>
          <Text style={styles.summaryTitle}>
            {entries === null
              ? 'Reading the queue…'
              : queued.length === 0
                ? 'Everything has been sent'
                : `${queued.length} waiting to send`}
          </Text>
          <Text style={styles.summaryBody}>
            Server: {API_BASE_URL ? hostOf(API_BASE_URL) : 'none configured'}
          </Text>
          {result ? (
            <Text style={[styles.summaryBody, !result.ok && styles.errorText]}>
              Last try: {result.ok ? `sent ${result.writesReplayed}` : result.error ?? 'failed'}
            </Text>
          ) : null}
          <ChunkyButton
            label={syncing ? 'Sending…' : 'Try sending now'}
            tone="kanji"
            size="small"
            disabled={syncing}
            onPress={sendNow}
          />
        </Card>

        {entries === null ? <ActivityIndicator color={colors.kanji} /> : null}

        {studyQueued.length > 0 ? (
          <View style={styles.group}>
            <Overline>Waiting to send</Overline>
            {studyQueued.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </View>
        ) : null}

        {setAside.length > 0 ? (
          <View style={styles.group}>
            <Overline>Refused, set aside</Overline>
            {setAside.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onRequeue={async () => {
                  feedback.tap();
                  await requeueWrite(entry.id);
                  await load();
                }}
              />
            ))}
          </View>
        ) : null}

        {logQueued.length > 0 ? (
          <View style={styles.group}>
            <Overline>Answer log</Overline>
            <Card variant="bordered">
              <Text style={styles.summaryBody}>
                {logQueued.length} answer {logQueued.length === 1 ? 'record' : 'records'} waiting
                {logQueued[0].lastError ? ` — last error: ${logQueued[0].lastError}` : ''}
              </Text>
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function EntryCard({ entry, onRequeue }: { entry: OutboxEntry; onRequeue?: () => void }) {
  const payload = safeParse(entry.payload);
  const what =
    payload && typeof payload.assignmentId === 'number'
      ? `assignment ${payload.assignmentId}`
      : payload && typeof payload.srsStateId === 'number'
        ? `card ${payload.srsStateId}`
        : null;

  return (
    <Card variant="bordered" style={styles.entry}>
      <View style={styles.entryHead}>
        <Text style={styles.entryTitle}>{TYPE_LABELS[entry.type] ?? entry.type}</Text>
        {entry.attempts > 0 ? (
          <Pill
            label={`${entry.attempts} ${entry.attempts === 1 ? 'try' : 'tries'}`}
            color={colors.warningInk}
            background={colors.warningTint}
          />
        ) : null}
      </View>
      <Text style={styles.entryMeta}>
        {what ? `${what} · ` : ''}queued {agoLabel(entry.createdAt)}
        {entry.lastAttemptAt ? ` · last tried ${agoLabel(entry.lastAttemptAt)}` : ''}
      </Text>
      {entry.lastError ? (
        <Text style={styles.errorText} selectable>
          {entry.lastError}
        </Text>
      ) : (
        <Text style={styles.entryMeta}>Not tried yet</Text>
      )}
      {onRequeue ? <InlineButton label="Try again" onPress={onRequeue} /> : null}
    </Card>
  );
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

function agoLabel(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 12,
    paddingBottom: 24,
    gap: spacing.stack,
  },
  summary: { gap: 8 },
  summaryTitle: { ...typeScale.section, color: colors.ink },
  summaryBody: { ...typeScale.caption, color: colors.inkSoft },
  group: { gap: 8 },
  entry: { gap: 5 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  entryTitle: { ...typeScale.cardTitle, color: colors.ink, flex: 1 },
  entryMeta: { ...typeScale.metaSmall, color: colors.inkSoft },
  errorText: { ...typeScale.metaSmall, color: colors.dangerInk, lineHeight: 16 },
});
