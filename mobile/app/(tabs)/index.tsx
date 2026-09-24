/**
 * Dashboard — artboard 3b.
 *
 * Two action cards at the top, then read-only progress. The art slots on the
 * action cards hold the Crabigator: a waving pose for lessons, a walking one
 * for reviews.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot, MascotBanner } from '@/components/Mascot';
import { AnimatedSessionProgress, GrowBar, RiseIn } from '@/components/motion';
import { ProfileAvatar, ScreenHeader } from '@/components/ScreenHeader';
import { Card, QueueCard, SectionHeading } from '@/components/ui';
import { isBackendConfigured } from '@/data/api';
import { useAuthStatus } from '@/data/credentials';
import { formatSyncedAgo } from '@/data/sync';
import type {
  ActivityDay,
  Counted,
  DayActivity,
  JlptCoverage,
  SubjectType,
} from '@/data/types';
import {
  useActivityStrip,
  useDashboard,
  useJlptCoverage,
  usePracticeQueue,
  useSync,
} from '@/hooks/useStudyData';
import {
  colors,
  jp,
  radius,
  spacing,
  srsStages,
  stageVocabularies,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

export default function DashboardScreen() {
  const router = useRouter();
  const { data, reload } = useDashboard();
  const { data: strip } = useActivityStrip();
  const { data: practice } = usePracticeQueue();
  const { data: jlpt } = useJlptCoverage();
  const { syncing, refresh } = useSync();
  const auth = useAuthStatus();

  // Everything on screen was loaded while the server was refusing this phone,
  // so it is fallback data. Once a key is accepted, load the real thing — but
  // only after a refusal, not on every launch's first `ok`. A flag rather than
  // the previous value: saving a key passes through `unknown` on the way.
  const wasRefused = React.useRef(false);
  React.useEffect(() => {
    if (auth === 'missing' || auth === 'rejected') wasRefused.current = true;
    else if (auth === 'ok' && wasRefused.current) {
      wasRefused.current = false;
      reload();
    }
  }, [auth, reload]);

  const onRefresh = React.useCallback(async () => {
    await refresh();
    reload();
  }, [refresh, reload]);

  if (!data) return <View style={styles.screen} />;

  const { levelProgress: level } = data;
  const syncedLabel = formatSyncedAgo(data.lastSyncedAt);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        branded
        title="KANJI WORKSHOP"
        trailing={<ProfileAvatar onPress={() => router.push('/profile')} />}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={onRefresh} />}
      >
        {/* The engraved scene, bled to the screen edges.

            The rest of the app is flat colour on a light ground; this is dense
            monochrome hatching. They do not blend, and are not meant to — the
            band reads as a window onto the world the mascot lives in, and the
            cards below read as the interface on top of it. Keeping it short
            and edge-to-edge is what makes it a horizon rather than a picture
            someone dropped into a card. */}
        <MascotBanner variant="wide" height={76} style={styles.banner} />

        {/* Refused, not offline. Both leave the dashboard on cached data and
            look the same from here, so without this a missing key would pass
            for a bad connection — and waiting never fixes a missing key. */}
        {auth === 'missing' || auth === 'rejected' ? (
          <Pressable onPress={() => router.push('/profile')}>
            <Card variant="bordered" style={styles.authCard}>
              <Text style={styles.authTitle}>
                {auth === 'missing' ? 'Connect this phone' : 'The server refused this phone'}
              </Text>
              <Text style={styles.authBody}>
                {auth === 'missing'
                  ? 'Your server asks for an API key. Enter it once and it stays on this phone. ›'
                  : 'The saved API key no longer matches the server. Enter the current one. ›'}
              </Text>
            </Card>
          </Pressable>
        ) : null}

        {/* A short stagger, and only down the first few cards. Past about six
            a cascade stops reading as choreography and starts reading as the
            screen being slow to draw. */}
        <RiseIn>
          <QueueCard
            title="Today's Lessons"
            count={data.lessonCount}
            tone="kanji"
            blurb="Learn something new."
            cta="Start Lessons"
            art={<Mascot pose="wave" size={80} speed={0.7} />}
            disabled={data.lessonCount === 0}
            onPress={() => router.push('/lesson')}
          />
        </RiseIn>

        <RiseIn delay={55}>
          <QueueCard
            title="Reviews"
            count={data.reviewCount}
            tone="radical"
            blurb="Do your Reviews to unlock new Lessons."
            cta="Start Reviews"
            art={<Mascot pose="walk" size={80} speed={0.7} />}
            disabled={data.reviewCount === 0}
            onPress={() => router.push('/review')}
          />
        </RiseIn>

        {/* The third track, and the one that was previously invisible from
            here: generated practice had no presence on the home screen at all,
            so the only way to find it was to already know it existed. */}
        <RiseIn delay={110}>
          <QueueCard
            title="Practice Questions"
            count={practice?.questions ?? 0}
            tone="vocabulary"
            blurb={
              practice && practice.questions > 0
                ? 'Written for you from the words you are studying.'
                : 'Nothing written yet — these are generated twice a day.'
            }
            cta="Start Practice"
            art={<Mascot pose="idle" size={80} speed={0.6} lively />}
            disabled={!practice || practice.questions === 0}
            onPress={() => router.push('/lesson-bundle')}
          />
        </RiseIn>

        <RiseIn delay={165}>
          <StreakCard streak={data.streak} strip={strip} />
        </RiseIn>

        <Card>
          <SectionHeading
            title="Level Progress"
            trailing={`Level ${level.level} ›`}
            onPressTrailing={() => router.push('/items')}
          />
          <View style={styles.countRow}>
            <CountTile type="radical" label="Radicals" counted={level.radicals} />
            <CountTile type="kanji" label="Kanji" counted={level.kanji} />
            <CountTile type="vocabulary" label="Vocab" counted={level.vocabulary} />
          </View>
          <Text style={styles.footnote}>
            <Text style={styles.footnoteStrong}>
              {level.kanjiRemainingToLevelUp} more kanji
            </Text>{' '}
            to level up.
          </Text>
        </Card>

        {/* Rendered whenever a server is configured, even when it cannot be
            reached. Returning null on failure is what made a stale backend
            look like a missing feature — the card was simply absent, with
            nothing anywhere to say why. */}
        {isBackendConfigured ? <JlptCard coverage={jlpt} /> : null}

        <SpreadCard spread={data.stageSpread} />

        <View style={styles.syncRow}>
          <View
            style={[
              styles.syncDot,
              { backgroundColor: syncedLabel ? colors.success : colors.inkDisabled },
            ]}
          />
          <Text style={styles.syncText}>{syncedLabel ?? 'Not synced yet'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The seven days the dashboard payload carries, in the shape the strip wants.
 * Used only when `/api/activity` could not be reached — it has no notion of a
 * grammar-only day, so those simply read as empty.
 */
function fromWeek(week: DayActivity[]): ActivityDay[] {
  return week.map((day) => ({
    label: day.label.slice(0, 1),
    isToday: day.isToday,
    studied: day.intensity > 0,
    grammarOnly: false,
  }));
}

function StreakCard({
  streak,
  strip,
}: {
  streak: { days: number; best: number; week: DayActivity[] };
  strip: ActivityDay[] | null;
}) {
  const days = strip ?? fromWeek(streak.week);
  const anyGrammarOnly = days.some((day) => day.grammarOnly);

  return (
    <Card>
      <View style={styles.streakHead}>
        <View style={styles.streakTitleRow}>
          <Text style={styles.sectionSmall}>Study Streak</Text>
          <Text style={styles.streakDays}>{streak.days}日</Text>
        </View>
        <Text style={styles.meta}>best {streak.best}</Text>
      </View>

      <View style={styles.weekRow}>
        {days.map((day, i) => (
          <View key={i} style={styles.dayColumn}>
            <Text style={[styles.dayLabel, day.isToday && styles.dayLabelToday]}>{day.label}</Text>
            <View
              style={[
                styles.dayBar,
                day.studied
                  ? { backgroundColor: colors.warning }
                  : day.grammarOnly
                    ? styles.dayBarGrammar
                    : day.isToday
                      ? styles.dayBarToday
                      : { backgroundColor: colors.border },
              ]}
            />
          </View>
        ))}
      </View>

      {anyGrammarOnly ? (
        <Text style={styles.stripNote}>Outlined days logged grammar — not counted.</Text>
      ) : null}
    </Card>
  );
}

function CountTile({
  type,
  label,
  counted,
}: {
  type: SubjectType;
  label: string;
  counted: Counted;
}) {
  const palette = subjectPalette[type];
  return (
    <View style={styles.countTile}>
      <View style={styles.countTileHead}>
        <View style={[styles.glyphTile, { backgroundColor: palette.solid }]}>
          <Text style={styles.glyphTileText}>{palette.glyph}</Text>
        </View>
        <Text style={styles.countTileLabel}>{label}</Text>
      </View>
      <Text style={styles.countTileValue}>
        {counted.passed}/{counted.total}
      </Text>
    </View>
  );
}

/**
 * Kanji coverage per JLPT tier.
 *
 * **Coverage, not readiness**, and the footnote says so. The exam also tests
 * grammar and listening, neither of which this app can see, so a full N5 bar
 * means every N5 kanji is passed — not that you would pass N5. Overstating
 * that is the one way this card could do harm.
 *
 * Two-tone: solid is passed in WaniKani's sense, amber is unlocked but not yet
 * passed. Without the second band a tier you are halfway through reads as
 * untouched, which is the most discouraging possible way to draw it.
 */
function JlptCard({ coverage }: { coverage: JlptCoverage | null }) {
  // Still loading, or the server could not be reached. Said out loud rather
  // than drawn as a row of zeroes, which would read as having forgotten
  // everything, and rather than hidden, which reads as not existing.
  if (!coverage?.tracked) {
    return (
      <Card>
        <SectionHeading title="JLPT Kanji Coverage" />
        <Text style={styles.jlptNote}>
          {coverage
            ? 'Not available — your server could not be reached. Coverage is counted there, against the full JLPT kanji lists.'
            : 'Counting…'}
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeading title="JLPT Kanji Coverage" />
      <View style={styles.jlptRows}>
        {coverage.tiers.map((tier) => (
          <View key={tier.level} style={styles.jlptRow}>
            <Text style={styles.jlptLabel}>N{tier.level}</Text>
            <View style={styles.jlptTrack}>
              <AnimatedSessionProgress
                correct={tier.passed}
                incorrect={tier.started}
                total={tier.total}
                height={7}
                correctColor={colors.kanji}
                incorrectColor={colors.warningSoft}
                trackColor={colors.border}
              />
            </View>
            <Text style={styles.jlptCount}>
              {tier.passed}/{tier.total}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.jlptNote}>
        Kanji only, and coverage rather than readiness — the exam also tests
        grammar and listening. Amber is unlocked but not yet passed.
      </Text>
    </Card>
  );
}

/** Item counts per stage bucket. Bars are scaled against the tallest column. */
function SpreadCard({ spread }: { spread: number[] }) {
  const peak = Math.max(1, ...spread);
  const names = stageVocabularies.Botanical;

  return (
    <Card>
      <SectionHeading title="Active Item Spread" trailing="Details ›" />
      <View style={styles.spreadChart}>
        {spread.map((value, index) => (
          <GrowBar
            key={index}
            vertical
            // Floored so an empty bucket still reads as a bucket rather than
            // vanishing from the chart.
            fraction={Math.max(0.04, value / peak)}
            color={srsStages[index].color}
            delay={index * 60}
            style={styles.spreadBar}
          />
        ))}
      </View>
      <View style={styles.spreadLabels}>
        {names.map((name) => (
          <Text key={name} style={styles.spreadLabel} numberOfLines={1}>
            {name}
          </Text>
        ))}
      </View>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 4,
  },
  authCard: {
    backgroundColor: colors.warningRow,
    borderColor: colors.warningBorder,
    gap: 4,
    marginBottom: 6,
  },
  authTitle: {
    ...typeScale.section,
    color: colors.warningInkDeep,
  },
  authBody: {
    ...typeScale.caption,
    color: colors.warningInkDeep,
    lineHeight: 17,
  },
  banner: {
    // Cancels the page gutter so the horizon runs the full width. A scene
    // inset by 14px on each side reads as a picture of a landscape; one that
    // touches both edges reads as the landscape.
    marginHorizontal: -spacing.gutter,
    marginBottom: 2,
  },


  streakHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  streakTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
  },
  sectionSmall: {
    ...typeScale.sectionSmall,
    color: colors.ink,
  },
  streakDays: {
    fontFamily: typeScale.stat.fontFamily,
    fontSize: 19,
    color: colors.warning,
  },
  meta: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 5,
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  dayLabel: {
    fontFamily: typeScale.meta.fontFamily,
    fontSize: 9.5,
    color: colors.inkFaint,
  },
  dayLabelToday: {
    color: colors.ink,
  },
  dayBar: {
    width: '100%',
    height: 26,
    borderRadius: 7,
  },
  dayBarToday: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.inkDisabled,
  },
  /** Hollow, in the streak's own hue: present on the strip, absent from the count. */
  dayBarGrammar: {
    backgroundColor: colors.warningTint,
    borderWidth: 1.5,
    borderColor: colors.warningBorder,
  },
  stripNote: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
    marginTop: 8,
  },

  countRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countTile: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 6,
  },
  countTileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  glyphTile: {
    width: 19,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphTileText: {
    fontFamily: jp.icon.fontFamily,
    fontSize: 11,
    color: colors.onSolid,
  },
  countTileLabel: {
    ...typeScale.meta,
    color: colors.ink,
  },
  countTileValue: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 15,
    color: colors.ink,
  },
  footnote: {
    marginTop: 10,
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  footnoteStrong: {
    fontFamily: typeScale.section.fontFamily,
    color: colors.ink,
  },

  jlptRows: {
    gap: 7,
  },
  jlptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jlptLabel: {
    width: 24,
    ...typeScale.meta,
    color: colors.inkMuted,
  },
  jlptTrack: {
    flex: 1,
  },
  jlptCount: {
    width: 58,
    textAlign: 'right',
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },
  jlptNote: {
    marginTop: 9,
    ...typeScale.metaSmall,
    color: colors.inkFaint,
    lineHeight: 15,
  },

  spreadChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    height: 38,
  },
  spreadBar: {
    flex: 1,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  spreadLabels: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 7,
  },
  spreadLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: typeScale.meta.fontFamily,
    fontSize: 9,
    color: colors.inkFaint,
  },

  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 6,
    paddingTop: 9,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  syncText: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },
});
