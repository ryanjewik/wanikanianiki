/**
 * Study hub: everything that is yours rather than WaniKani's.
 *
 * WaniKani's lessons and reviews are on the home screen and only there; this
 * tab is the imported deck, generated practice and grammar, with the sound
 * and haptics settings at the very bottom where settings belong.
 *
 * Everything here is assembled from the existing primitives, so it stays in
 * the same system as the drawn screens.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FeedbackToggles } from '@/components/FeedbackToggles';
import { OfflineArt } from '@/components/icons';
import { Mascot } from '@/components/Mascot';
import { RiseIn } from '@/components/motion';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, Overline, QueueCard, SectionHeading } from '@/components/ui';
import { useDueFlashcards, usePracticeQueue, useSync } from '@/hooks/useStudyData';
import {
  colors,
  radius,
  spacing,
  type as typeScale,
} from '@/theme/tokens';

export default function StudyScreen() {
  const router = useRouter();
  const { data: dueCards, reload: reloadDue } = useDueFlashcards();
  const { data: practice, reload: reloadPractice } = usePracticeQueue();
  const { pendingWrites, result } = useSync();

  const dueCardCount = dueCards?.length ?? 0;
  const offline = result?.error === 'Offline';

  // Coming back from a session, the counts on the buttons are the first thing
  // read; they should already say what is left rather than what there was.
  useFocusEffect(
    React.useCallback(() => {
      reloadDue();
      reloadPractice();
    }, [reloadDue, reloadPractice]),
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
            trailing={dueCardCount > 0 ? `${dueCardCount} due ›` : 'Manage ›'}
            trailingColor={colors.vocabulary}
            onPressTrailing={() => router.push(dueCardCount > 0 ? '/quiz' : '/sets')}
          />
          <Text style={styles.trackBlurb}>
            Words you photographed from a textbook, studied as two-sided flashcards: each word
            becomes one card that shows you the Japanese and asks for the meaning, and another
            that asks you to produce the Japanese. You type the answer rather than flipping it
            over, so the card can tell whether you actually knew it.
          </Text>
          <Text style={styles.trackBlurb}>
            They run on their own SM-2 schedule, kept separate from your WaniKani queue so the
            two never disagree about the same word.
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
              label={dueCardCount > 0 ? `Vocab practice (${dueCardCount})` : 'Vocab practice'}
              tone="neutral"
              size="small"
              disabled={dueCardCount === 0}
              onPress={() => router.push('/quiz')}
              style={styles.deckButton}
            />
          </View>
        </Card>

        <Overline style={styles.trackLabel}>Generated practice</Overline>

        <QueueCard
          title="Practice Questions"
          count={practice?.questions ?? 0}
          tone="vocabulary"
          blurb={
            practice && practice.questions > 0
              ? `${practice.bundles} ${practice.bundles === 1 ? 'set' : 'sets'} written for you, from words across both decks.`
              : 'Nothing written yet. These are generated twice a day from what you are studying.'
          }
          cta="Start Practice"
          art={<Mascot pose="idle" size={80} speed={0.6} lively />}
          disabled={!practice || practice.questions === 0}
          onPress={() => router.push('/lesson-bundle')}
        />

        <Card variant="bordered">
          <Text style={styles.trackBlurb}>
            Not WaniKani lessons. These are questions written ahead of time —
            multiple choice, fill-in-the-blank, sentence building — drawn from
            words across both decks above and any grammar you have confirmed. A
            WaniKani lesson teaches you something new; this asks you about what
            you have already met.
          </Text>
          <Text style={styles.trackBlurb}>
            Answering advances every word the question tested, except
            WaniKani-owned words — those stay on WaniKani&apos;s own schedule, so
            practising them here counts as practice and nothing more.
          </Text>
        </Card>

        <Overline style={styles.trackLabel}>Grammar</Overline>

        <Card variant="bordered">
          <SectionHeading
            title="Points you have logged"
            trailing="Open ›"
            trailingColor={colors.radical}
            onPressTrailing={() => router.push('/grammar')}
          />
          <Text style={styles.trackBlurb}>
            Type the pattern the moment it comes up in class and fill it in later. Logging is
            deliberately not studying — a point you write down shows on the calendar without
            touching your streak.
          </Text>
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
