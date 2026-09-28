/**
 * One run of the question writer, and every question it wrote.
 *
 * Rejected questions are listed too, with the checker's reason — that is the
 * part only this screen can show, and a run of similar reasons is the first
 * sign the writer has drifted. Each question says where it stands: shown to
 * you, waiting in a set you have not opened, verified but left out of a set,
 * or rejected.
 *
 * Read-only. Nothing here can be answered; a question is only ever practised
 * from inside a set.
 */
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FuriganaText } from '@/components/Furigana';
import {
  dayLabel,
  RunStatusPill,
  StandingPill,
  timeLabel,
  triggerLabel,
} from '@/components/GenerationRunBits';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, Pill, StatTile } from '@/components/ui';
import {
  type CatalogQuestion,
  CHOICE_TYPES,
  QUESTION_TYPE_LABELS,
  type QuestionStanding,
} from '@/data/types';
import { feedback } from '@/feedback';
import { useGenerationRun } from '@/hooks/useStudyData';
import { colors, jp, spacing, type as typeScale } from '@/theme/tokens';

type Filter = 'all' | QuestionStanding;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'served', label: 'Shown' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'rejected', label: 'Rejected' },
];

export default function GenerationRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const runId = Number(id);
  const { data, loading, error, reload } = useGenerationRun(runId);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [showFurigana, setShowFurigana] = React.useState(true);

  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  const questions = React.useMemo(
    () => (data?.questions ?? []).filter((q) => filter === 'all' || q.standing === filter),
    [data, filter],
  );

  const run = data?.run;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={run ? `${dayLabel(run.startedAt)}, ${timeLabel(run.startedAt)}` : 'Run'}
        showBack
      />

      <ScrollView contentContainerStyle={styles.content}>
        {loading && !data ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.vocabulary} />
          </View>
        ) : null}

        {error ? (
          <Card variant="bordered">
            <Text style={styles.errorText}>Couldn&apos;t load this run. Check your connection.</Text>
          </Card>
        ) : null}

        {run ? (
          <Card variant="bordered" style={styles.summary}>
            <View style={styles.summaryHead}>
              <Text style={styles.summaryTrigger}>{triggerLabel(run.trigger)}</Text>
              <RunStatusPill status={run.status} />
            </View>
            <View style={styles.stats}>
              <StatTile value={run.verified} label="kept" tone="success" />
              <StatTile value={run.rejected} label="thrown out" tone="danger" />
              <StatTile value={run.served} label="shown to you" tone="radical" />
            </View>
            <Text style={styles.summaryNote}>
              {run.drafted} drafted · {run.bundlesCreated}{' '}
              {run.bundlesCreated === 1 ? 'set' : 'sets'} made · {run.bundlesWaiting} already
              waiting when it started
            </Text>
            {run.reason ? <Text style={styles.summaryReason}>{run.reason}</Text> : null}
            {run.rejected > (data?.questions.filter((q) => !q.verified).length ?? 0) ? (
              // Malformed drafts and word-for-word repeats are dropped before the
              // checker sees them, so they have no row to list.
              <Text style={styles.summaryNote}>
                Malformed drafts and exact repeats are counted as thrown out but not kept, so
                not every one is listed below.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {data && data.questions.length > 0 ? (
          <View style={styles.toolbar}>
            <View style={styles.filters}>
              {FILTERS.map(({ key, label }) => (
                <Pressable
                  key={key}
                  onPress={() => {
                    feedback.select();
                    setFilter(key);
                  }}
                  style={[styles.filter, filter === key && styles.filterOn]}
                >
                  <Text style={[styles.filterText, filter === key && styles.filterTextOn]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => {
                feedback.toggle();
                setShowFurigana((on) => !on);
              }}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: showFurigana }}
              accessibilityLabel="Show readings"
            >
              <Text style={styles.furiganaToggle}>
                {showFurigana ? 'ふりがな ON' : 'ふりがな OFF'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {questions.map((question) => (
          <QuestionCard key={question.id} question={question} showFurigana={showFurigana} />
        ))}

        {data && questions.length === 0 ? (
          <Text style={styles.none}>
            {data.questions.length === 0
              ? 'This run kept no questions.'
              : 'None in this group.'}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function QuestionCard({
  question,
  showFurigana,
}: {
  question: CatalogQuestion;
  showFurigana: boolean;
}) {
  const { payload } = question;
  const furigana = payload.furigana;

  return (
    <Card variant="bordered" style={styles.question}>
      <View style={styles.questionHead}>
        <Pill
          label={QUESTION_TYPE_LABELS[question.type] ?? question.type}
          color={colors.inkMuted}
          background={colors.ground}
        />
        <StandingPill standing={question.standing} />
      </View>

      <FuriganaText
        text={payload.prompt}
        furigana={furigana}
        show={showFurigana}
        style={styles.prompt}
      />

      {CHOICE_TYPES.has(question.type) && payload.choices ? (
        <View style={styles.choices}>
          {payload.choices.map((choice) => (
            <View
              key={choice}
              style={[styles.choice, choice === payload.answer && styles.choiceRight]}
            >
              <FuriganaText
                text={choice}
                furigana={furigana}
                show={showFurigana}
                style={styles.choiceText}
              />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.answer}>Answer: {payload.answer}</Text>
      )}

      {payload.tiles ? (
        <Text style={styles.tiles}>Tiles: {payload.tiles.join(' / ')}</Text>
      ) : null}

      {question.verifierNote ? (
        <Text style={styles.note}>Checker: {question.verifierNote}</Text>
      ) : null}
    </Card>
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
  errorText: { ...typeScale.caption, color: colors.inkSoft },

  summary: { gap: 10 },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTrigger: { ...typeScale.section, color: colors.ink, flex: 1 },
  stats: { flexDirection: 'row', gap: 8 },
  summaryNote: { ...typeScale.metaSmall, color: colors.inkSoft, lineHeight: 16 },
  summaryReason: { ...typeScale.metaSmall, color: colors.warningInk, lineHeight: 16 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  filters: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  filter: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
  filterOn: { borderColor: colors.vocabulary, backgroundColor: colors.vocabularyTint },
  filterText: { ...typeScale.metaSmall, color: colors.inkSoft },
  filterTextOn: { color: colors.vocabularyInk },
  furiganaToggle: { ...typeScale.metaSmall, color: colors.vocabularyInk, letterSpacing: 0.3 },

  question: { gap: 8 },
  questionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  prompt: { ...jp.row, color: colors.ink, lineHeight: 30 },
  choices: { gap: 6 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  choiceRight: { borderColor: colors.success, backgroundColor: colors.successTint },
  choiceText: { ...typeScale.body, color: colors.ink },
  answer: { ...typeScale.caption, color: colors.successInk },
  tiles: { ...typeScale.metaSmall, color: colors.inkSoft },
  note: { ...typeScale.metaSmall, color: colors.dangerInk, lineHeight: 16 },
  none: { ...typeScale.caption, color: colors.inkSoft, textAlign: 'center', paddingVertical: 20 },
});
