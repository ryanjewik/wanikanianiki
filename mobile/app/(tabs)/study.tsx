/**
 * Study hub: everything that is yours rather than WaniKani's.
 *
 * WaniKani's lessons and reviews, and the generated practice questions, are on
 * the home screen; this tab is the imported deck and your grammar, with the
 * sound and haptics settings at the very bottom where settings belong.
 *
 * Everything here is assembled from the existing primitives, so it stays in
 * the same system as the drawn screens.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FeedbackToggles } from '@/components/FeedbackToggles';
import { OfflineArt } from '@/components/icons';
import { RiseIn } from '@/components/motion';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, Overline, SectionHeading } from '@/components/ui';
import type { GrammarEntry } from '@/data/types';
import { feedback } from '@/feedback';
import { useFlashcardOverview, useGrammarEntries, useSync } from '@/hooks/useStudyData';
import { colors, jp, radius, spacing, type as typeScale } from '@/theme/tokens';

/** How many grammar points the Study tab lists. */
const RECENT_GRAMMAR = 5;

export default function StudyScreen() {
  const router = useRouter();
  const { data: flashcards, reload: reloadDue } = useFlashcardOverview();
  const { data: grammar, reload: reloadGrammar } = useGrammarEntries();
  const { pendingWrites, result } = useSync();

  const remaining = flashcards?.remaining ?? 0;
  // Newest first, by when each was logged.
  const recent = [...(grammar ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_GRAMMAR);
  const hasSets = (flashcards?.setCount ?? 0) > 0;
  const offline = result?.error === 'Offline';

  // Coming back from a session, the counts on the buttons are the first thing
  // read; they should already say what is left rather than what there was.
  useFocusEffect(
    React.useCallback(() => {
      reloadDue();
      reloadGrammar();
    }, [reloadDue, reloadGrammar]),
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Study"
        trailingText={pendingWrites > 0 ? `${pendingWrites} pending sync` : undefined}
        trailingColor={colors.warning}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {offline ? (
          <Card variant="bordered" style={styles.offlineCard}>
            <OfflineArt size={56} />
            <View style={styles.offlineBody}>
              <Text style={styles.offlineTitle}>You&apos;re offline</Text>
              <Text style={styles.offlineText}>
                Answers are queued and nothing is lost. They&apos;ll go up on the next sync.
              </Text>
            </View>
          </Card>
        ) : null}

        <Overline style={styles.trackLabel}>Your own deck</Overline>

        <Card variant="bordered">
          <SectionHeading
            title="Imported vocabulary"
            trailing="Manage ›"
            trailingColor={colors.vocabulary}
            onPressTrailing={() => router.push('/sets')}
          />
          <Text style={styles.trackBlurb}>
            Words you photographed from a textbook, studied a set at a time as two-sided
            flashcards: one card shows the Japanese and asks for the meaning, the other asks you
            to write the Japanese. You type the answer rather than flipping the card, so it can
            tell whether you actually knew it.
          </Text>
          <Text style={styles.trackBlurb}>
            A card you get right stays out of its set until you reset the set, like Quizlet.
            Kept separate from your WaniKani queue, so the two never disagree about a word.
          </Text>
          <View style={styles.deckActions}>
            <ChunkyButton
              label="Flashcards"
              tone="vocabulary"
              size="small"
              onPress={() => router.push('/sets')}
              style={styles.deckButton}
            />
            <ChunkyButton
              label={remaining > 0 ? `Vocab practice (${remaining})` : 'Vocab practice'}
              tone="neutral"
              size="small"
              disabled={!hasSets}
              onPress={() => router.push('/quiz')}
              style={styles.deckButton}
            />
          </View>
        </Card>

        <Overline style={styles.trackLabel}>Grammar</Overline>

        <Card variant="bordered">
          <SectionHeading
            title="Most recent grammar points"
            trailing="See all ›"
            trailingColor={colors.radical}
            onPressTrailing={() => router.push('/grammar')}
          />
          {recent.length > 0 ? (
            <View style={styles.grammarList}>
              {recent.map((entry) => (
                <GrammarRow
                  key={entry.id}
                  entry={entry}
                  onPress={() => router.push(`/grammar/${entry.id}`)}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.trackBlurb}>
              Nothing logged yet. Type a pattern the moment it comes up in class and fill it in
              later.
            </Text>
          )}
          <View style={styles.deckActions}>
            <ChunkyButton
              label="Log a point"
              tone="radical"
              size="small"
              onPress={() => router.push('/grammar')}
              style={styles.deckButton}
            />
          </View>
        </Card>
        <Overline style={[styles.trackLabel, styles.settingsLabel]}>How it feels</Overline>

        <RiseIn delay={60}>
          <Card variant="bordered">
            <FeedbackToggles />
          </Card>
        </RiseIn>

      </ScrollView>
    </View>
  );
}

/** One logged point: the pattern, what it means (or that it still needs filling in), when. */
function GrammarRow({ entry, onPress }: { entry: GrammarEntry; onPress: () => void }) {
  const detail = entry.senseLabel || entry.meaning || 'Not filled in yet';
  return (
    <Pressable onPress={onPress} onPressIn={feedback.select}>
      {({ pressed }) => (
        <View style={[styles.grammarRow, pressed && styles.grammarRowPressed]}>
          <View style={styles.grammarBody}>
            <Text style={styles.grammarPattern} numberOfLines={1}>
              {entry.pattern}
            </Text>
            <Text style={styles.grammarDetail} numberOfLines={1}>
              {detail}
            </Text>
          </View>
          <Text style={styles.grammarDate}>{shortDate(entry.learnedOn)}</Text>
          <Text style={styles.grammarChevron}>›</Text>
        </View>
      )}
    </Pressable>
  );
}

/** "Sep 25" from "2026-09-25", without a timezone shifting the day. */
function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 12,
    paddingBottom: 20,
    gap: spacing.stack,
  },

  trackLabel: {
    marginTop: 6,
    marginLeft: 4,
  },
  settingsLabel: {
    marginTop: 18,
  },

  offlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  offlineBody: {
    flex: 1,
    gap: 3,
  },
  offlineTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  offlineText: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    lineHeight: 16,
  },


  grammarList: {
    marginBottom: 12,
  },
  grammarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  grammarRowPressed: {
    opacity: 0.6,
  },
  grammarBody: {
    flex: 1,
    gap: 2,
  },
  grammarPattern: {
    ...jp.row,
    fontSize: 17,
    color: colors.ink,
  },
  grammarDetail: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },
  grammarDate: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },
  grammarChevron: {
    ...typeScale.cardTitle,
    color: colors.inkFaint,
  },
  trackBlurb: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 18,
    marginBottom: 12,
  },
  deckActions: {
    flexDirection: 'row',
    gap: 8,
  },
  deckButton: {
    flex: 1,
    borderRadius: radius.tile,
  },
});
