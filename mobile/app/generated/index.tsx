/**
 * The question catalog — every run of the lesson worker, grouped by day.
 *
 * Two jobs. It is a history: what was written, when, and which of it you have
 * actually been shown. And it is the monitor for a worker nobody watches — the
 * header answers "is it running at all", and a run that died part-way shows
 * as "didn't finish" instead of simply never appearing.
 *
 * Runs that woke, found the queue full and stopped are counted in the header
 * rather than listed: there is one of those every time you open a set.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  agoLabel,
  groupByDay,
  RunStatusPill,
  timeLabel,
  triggerLabel,
} from '@/components/GenerationRunBits';
import { OfflineArt } from '@/components/icons';
import { Mascot } from '@/components/Mascot';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, EmptyState, Overline } from '@/components/ui';
import type { GenerationRun } from '@/data/types';
import { feedback } from '@/feedback';
import { useGenerationRuns } from '@/hooks/useStudyData';
import { colors, spacing, type as typeScale } from '@/theme/tokens';

export default function GenerationRunsScreen() {
  const router = useRouter();
  const { data, loading, error, reload } = useGenerationRuns();

  // A run may finish while you are looking at another screen.
  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  const groups = React.useMemo(
    () => groupByDay(data?.runs ?? [], (run) => run.startedAt),
    [data],
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Question catalog" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        {loading && !data ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.vocabulary} />
          </View>
        ) : null}

        {error ? (
          <Card variant="bordered" style={styles.errorCard}>
            <OfflineArt size={56} />
            <View style={styles.errorBody}>
              <Text style={styles.errorTitle}>Can&apos;t reach the server</Text>
              <Text style={styles.errorText}>
                The catalog is the server&apos;s own record of what it wrote, so it needs a
                connection.
              </Text>
            </View>
          </Card>
        ) : null}

        {data ? (
          <Card variant="bordered" style={styles.pulse}>
            <Text style={styles.pulseTitle}>
              {data.lastRunAt
                ? `Question writer last ran ${agoLabel(data.lastRunAt)}`
                : 'The question writer has not run yet'}
            </Text>
            <Text style={styles.pulseBody}>
              It runs twice a day, and again whenever you open a set or add words, topping the
              queue back up to five sets.
              {data.skippedLastWeek > 0
                ? ` ${data.skippedLastWeek} ${data.skippedLastWeek === 1 ? 'check' : 'checks'} this week found the queue already full and wrote nothing — that is normal.`
                : ''}
            </Text>
          </Card>
        ) : null}

        {groups.map((group) => (
          <View key={group.day} style={styles.group}>
            <Overline>{group.day}</Overline>
            {group.items.map((run) => (
              <RunRow key={run.id} run={run} onPress={() => router.push(`/generated/${run.id}`)} />
            ))}
          </View>
        ))}

        {data && data.runs.length === 0 && !error ? (
          <Card>
            <EmptyState
              art={<Mascot pose="idle" size={80} speed={0.6} />}
              title="Nothing written yet"
              body="Once the question writer has run, each run shows up here with every question it wrote — including the ones its checker threw out, and why."
            />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function RunRow({ run, onPress }: { run: GenerationRun; onPress: () => void }) {
  const counts = [
    `${run.verified} ${run.verified === 1 ? 'question' : 'questions'}`,
    run.rejected > 0 ? `${run.rejected} thrown out` : null,
    run.bundlesCreated > 0 ? `${run.bundlesCreated} ${run.bundlesCreated === 1 ? 'set' : 'sets'}` : null,
    run.served > 0 ? `${run.served} shown to you` : null,
  ].filter(Boolean);

  return (
    <Pressable onPress={onPress} onPressIn={feedback.select}>
      {({ pressed }) => (
        <Card variant="bordered" style={[styles.runCard, pressed ? styles.runCardPressed : null]}>
          <View style={styles.runHeader}>
            <Text style={styles.runTime}>{timeLabel(run.startedAt)}</Text>
            <Text style={styles.runTrigger} numberOfLines={1}>
              {triggerLabel(run.trigger)}
            </Text>
            <RunStatusPill status={run.status} />
            <Text style={styles.chevron}>›</Text>
          </View>
          <Text style={styles.runMeta}>{counts.join(' · ')}</Text>
          {run.reason && run.status !== 'completed' ? (
            <Text style={styles.runReason} numberOfLines={2}>
              {run.reason}
            </Text>
          ) : null}
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 12,
    paddingBottom: 24,
    gap: spacing.stack,
  },
  loading: { paddingVertical: 28 },

  pulse: { gap: 6 },
  pulseTitle: { ...typeScale.section, color: colors.ink },
  pulseBody: { ...typeScale.caption, color: colors.inkSoft, lineHeight: 17 },

  group: { gap: 8 },

  runCard: { gap: 6 },
  runCardPressed: { backgroundColor: colors.hairline },
  runHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  runTime: { ...typeScale.cardTitle, color: colors.ink },
  runTrigger: { ...typeScale.meta, color: colors.inkSoft, flex: 1 },
  chevron: { ...typeScale.cardTitle, color: colors.inkFaint },
  runMeta: { ...typeScale.meta, color: colors.inkMuted },
  runReason: { ...typeScale.metaSmall, color: colors.inkSoft, lineHeight: 16 },

  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  errorBody: { flex: 1, gap: 3 },
  errorTitle: { ...typeScale.section, color: colors.ink },
  errorText: { ...typeScale.metaSmall, color: colors.inkSoft, lineHeight: 16 },
});
