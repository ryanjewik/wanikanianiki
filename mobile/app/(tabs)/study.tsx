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

import { AllCaughtUpArt, NothingDueArt, OfflineArt } from '@/components/icons';
import { Mascot } from '@/components/Mascot';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  CountBadge,
  EmptyState,
  Overline,
  SectionHeading,
} from '@/components/ui';
import { formatDueIn } from '@/data/sync';
import {
  useDashboard,
  useDueFlashcards,
  useLessonQueue,
  useReviewQueue,
  useSync,
} from '@/hooks/useStudyData';
import {
  colors,
  radius,
  spacing,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

export default function StudyScreen() {
  const router = useRouter();
  const { data: dashboard } = useDashboard();
  const { data: lessons } = useLessonQueue();
  const { data: reviews } = useReviewQueue();
  const { data: dueCards } = useDueFlashcards();
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
            pose="walk"
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
            pose="wave"
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

function QueueCard({
  title,
  count,
  tone,
  blurb,
  cta,
  pose,
  onPress,
}: {
  title: string;
  count: number;
  tone: 'kanji' | 'radical';
  blurb: string;
  cta: string;
  pose: 'wave' | 'walk';
  onPress: () => void;
}) {
  const palette = subjectPalette[tone];

  return (
    <Card style={styles.queueCard}>
      <View style={[styles.artSlot, { backgroundColor: palette.tint }]}>
        <Mascot pose={pose} size={80} speed={0.7} />
      </View>
      <View style={styles.queueBody}>
        <View style={styles.queueTitleRow}>
          <Text style={styles.queueTitle}>{title}</Text>
          <CountBadge count={count} color={palette.solid} />
        </View>
        <Text style={styles.blurb}>{blurb}</Text>
        <ChunkyButton label={cta} tone="neutral" size="small" onPress={onPress} style={styles.queueCta} />
      </View>
    </Card>
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

  queueCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
  },
  artSlot: {
    width: 80,
    height: 80,
    borderRadius: radius.art,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueBody: {
    flex: 1,
    gap: 7,
  },
  queueTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queueTitle: {
    ...typeScale.cardTitle,
    color: colors.ink,
  },
  blurb: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  queueCta: {
    borderRadius: radius.tile,
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
