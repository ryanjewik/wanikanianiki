/**
 * Study hub.
 *
 * The one screen not drawn in the artboards — the tab bar needs a destination,
 * and the design doc is explicit that WaniKani content and AI-generated
 * content are separate study tracks rather than one blended queue. This is
 * where that separation becomes visible: two sections, never a merged list.
 *
 * Everything here is assembled from the existing primitives, so it stays in
 * the same system as the drawn screens.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FeedbackToggles } from '@/components/FeedbackToggles';
import { AllCaughtUpArt, NothingDueArt, OfflineArt } from '@/components/icons';
import { Mascot } from '@/components/Mascot';
import { RiseIn } from '@/components/motion';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  EmptyState,
  Overline,
  QueueCard,
  SectionHeading,
} from '@/components/ui';
import { formatDueIn } from '@/data/sync';
import {
  useDashboard,
  useDueFlashcards,
  useLessonQueue,
  usePracticeQueue,
  useReviewQueue,
  useSync,
} from '@/hooks/useStudyData';
import {
  colors,
  radius,
  spacing,
  type as typeScale,
} from '@/theme/tokens';

export default function StudyScreen() {
  const router = useRouter();
  const { data: dashboard } = useDashboard();
  const { data: lessons } = useLessonQueue();
  const { data: reviews } = useReviewQueue();
  const { data: dueCards } = useDueFlashcards();
  const { data: practice } = usePracticeQueue();
  const { pendingWrites, result } = useSync();

  const lessonCount = lessons?.length ?? 0;
  const reviewCount = reviews?.length ?? 0;
  const dueCardCount = dueCards?.length ?? 0;
  const offline = result?.error === 'Offline';

  /**
   * WaniKani decides what unlocks next server-side, so a long offline stretch
   * eventually exhausts whatever was cached — worth saying out loud before the
   * queue simply goes empty.
   */
  const backlogLow = offline && lessonCount > 0 && lessonCount <= 5;

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

        {backlogLow ? (
          <Card variant="bordered" style={styles.warningCard}>
            <Text style={styles.warningText}>
              Running low on lessons. New ones only unlock once you&apos;re back online — reconnect
              to get more.
            </Text>
          </Card>
        ) : null}

        <Overline style={styles.trackLabel}>WaniKani track</Overline>

        {reviewCount > 0 ? (
          <QueueCard
            title="Reviews"
            count={reviewCount}
            tone="radical"
            blurb="Items whose interval has come due."
            cta="Start Reviews"
            art={<Mascot pose="walk" size={80} speed={0.7} />}
            onPress={() => router.push('/review')}
          />
        ) : (
          <Card>
            <EmptyState
              art={dashboard?.lastSyncedAt ? <NothingDueArt /> : <AllCaughtUpArt />}
              title="Nothing due yet"
              body={
                dashboard
                  ? `Next reviews ${formatDueIn(dashboard.lastSyncedAt)}.`
                  : 'Nothing left in the queue.'
              }
            />
          </Card>
        )}

        {lessonCount > 0 ? (
          <QueueCard
            title="Lessons"
            count={lessonCount}
            tone="kanji"
            blurb="New radicals, kanji and words unlocked for you."
            cta="Start Lessons"
            art={<Mascot pose="wave" size={80} speed={0.7} />}
            onPress={() => router.push('/lesson')}
          />
        ) : (
          <Card>
            <EmptyState
              art={<AllCaughtUpArt />}
              title="All caught up"
              body="Nothing left in the lesson queue. Reviews unlock the next batch."
            />
          </Card>
        )}

        <Overline style={styles.trackLabel}>Your own deck</Overline>

        <Card variant="bordered">
          <SectionHeading
            title="Imported vocabulary"
            trailing={dueCardCount > 0 ? `${dueCardCount} due ›` : 'Manage ›'}
            trailingColor={colors.vocabulary}
          />
          <Text style={styles.trackBlurb}>
            Words you photographed from a textbook. These run on their own SM-2 schedule, kept
            separate from the WaniKani queue above so the two never disagree about the same word.
          </Text>
          <View style={styles.deckActions}>
            <ChunkyButton
              label="Notecards"
              tone="vocabulary"
              size="small"
              onPress={() => router.push('/sets')}
              style={styles.deckButton}
            />
            <ChunkyButton
              label={dueCardCount > 0 ? `Quiz me (${dueCardCount})` : 'Quiz me'}
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

        <Overline style={styles.trackLabel}>How it feels</Overline>

        <RiseIn delay={60}>
          <Card variant="bordered">
            <FeedbackToggles />
          </Card>
        </RiseIn>

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
  warningCard: {
    backgroundColor: colors.warningTint,
    borderColor: colors.warningBorder,
  },
  warningText: {
    ...typeScale.caption,
    color: colors.warningInkDeep,
    lineHeight: 18,
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
