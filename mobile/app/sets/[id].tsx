/**
 * One set — browse it as notecards, photograph pages into it, and confirm what
 * those pages found without leaving the screen.
 *
 * Browsing is deliberately not a quiz: every word in the set is here, due or
 * not, nothing is graded and nothing is written to the SRS. Tapping a card
 * turns it over. `/quiz` is the screen that schedules; this one is for reading
 * a deck.
 *
 * Importing here rather than on the Import tab is what makes a multi-page
 * import land as one named group: `importPagesIntoSet` uploads each page with
 * its position, the words inherit the set from the page they came from, and the
 * review below commits them — so a five-page lesson is one pass instead of five
 * round trips through another tab.
 */
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AmbiguityBanner,
  ExtractionReview,
  ambiguousItems,
  resolveReading,
  selectedItems,
  toggleItem,
} from '@/components/ExtractionReview';
import { EmptyDeckArt, OfflineArt } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  EmptyState,
  Overline,
  ProgressBar,
  SectionHeading,
} from '@/components/ui';
import * as api from '@/data/api';
import type { DetectedItem, VocabItem } from '@/data/types';
import { useVocabSetItems, useVocabSets } from '@/hooks/useStudyData';
import { colors, jp, radius, spacing, type as typeScale } from '@/theme/tokens';

/** The tier a page is imported at, cascading to every row it yields. */
const JLPT_TIERS: (number | null)[] = [5, 4, 3, 2, 1, null];

/** One read page waiting to be confirmed into the deck. */
interface PendingPage {
  sourceId: number;
  items: DetectedItem[];
}

export default function SetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const setId = Number(id);
  const valid = Number.isFinite(setId);

  const { data: sets } = useVocabSets();
  const { data: items, loading, error, reload } = useVocabSetItems(valid ? setId : null);

  const [tier, setTier] = React.useState<number | null>(3);
  const [importing, setImporting] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [pages, setPages] = React.useState<PendingPage[]>([]);
  const [confirming, setConfirming] = React.useState(false);

  const set = sets?.find((candidate) => candidate.id === setId) ?? null;

  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  /**
   * Pick several pages at once and read them one after another.
   *
   * `orderedSelection` matters more than it looks: pages are uploaded with
   * their index as `position`, so without it a five-page lesson is imported in
   * whatever order the gallery felt like returning.
   */
  const addPages = React.useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to add pages to this set.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      orderedSelection: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;

    const uris = picked.assets.map((asset) => asset.uri);
    setImporting(true);
    setProgress({ done: 0, total: uris.length });

    try {
      const results = await api.importPagesIntoSet(setId, uris, tier, (done, total) =>
        setProgress({ done, total }),
      );

      // A page that failed to read has no rows to review; say how many rather
      // than dropping them silently.
      const failed = results.filter((result) => result.status === 'failed');
      const read = results.filter((result) => result.status === 'processed' && result.items.length > 0);

      setPages((previous) => [
        ...previous,
        ...read.map((result) => ({ sourceId: result.sourceId, items: result.items })),
      ]);

      if (failed.length > 0) {
        Alert.alert(
          `${failed.length} of ${uris.length} pages couldn't be read`,
          failed[0].detail ?? 'Try a straighter, better-lit photo of those pages.',
        );
      } else if (read.length === 0) {
        Alert.alert('Nothing found', 'Those pages had no vocabulary rows on them.');
      }
      reload();
    } catch {
      Alert.alert(
        "Couldn't finish the import",
        'Pages that were already read are kept below. Try the rest again.',
      );
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }, [reload, setId, tier]);

  const togglePageItem = React.useCallback((sourceId: number, key: string) => {
    setPages((previous) =>
      previous.map((page) =>
        page.sourceId === sourceId ? { ...page, items: toggleItem(page.items, key) } : page,
      ),
    );
  }, []);

  const resolvePageReading = React.useCallback(
    (sourceId: number, key: string, reading: string) => {
      setPages((previous) =>
        previous.map((page) =>
          page.sourceId === sourceId
            ? { ...page, items: resolveReading(page.items, key, reading) }
            : page,
        ),
      );
    },
    [],
  );

  const pendingAmbiguous = pages.reduce(
    (total, page) => total + ambiguousItems(page.items).length,
    0,
  );
  const pendingSelected = pages.reduce(
    (total, page) => total + selectedItems(page.items).length,
    0,
  );

  /**
   * Commit every reviewed page.
   *
   * One call per page because confirm is keyed on the source: the server ties
   * the words back to the photo they came from, which is what makes a row
   * traceable to its page later. Sequential so a failure names the page it
   * happened on rather than losing that in a race.
   */
  const confirmPages = React.useCallback(async () => {
    if (pendingSelected === 0 || pendingAmbiguous > 0 || confirming) return;
    setConfirming(true);

    let added = 0;
    const stuck: PendingPage[] = [];

    for (const page of pages) {
      const keep = selectedItems(page.items);
      if (keep.length === 0) continue;
      try {
        const created = await api.confirmVocabImport(page.sourceId, keep);
        added += created.length;
      } catch {
        // Keep the page under review rather than dropping the user's edits —
        // resolving those readings again would be the whole job twice.
        stuck.push(page);
      }
    }

    setPages(stuck);
    setConfirming(false);
    reload();

    Alert.alert(
      stuck.length === 0 ? 'Added to your deck' : 'Partly added',
      stuck.length === 0
        ? `${added} word${added === 1 ? '' : 's'} added to ${set?.name ?? 'this set'}.`
        : `${added} added. ${stuck.length} page${stuck.length === 1 ? '' : 's'} didn't save and are still below.`,
    );
  }, [confirming, pages, pendingAmbiguous, pendingSelected, reload, set]);

  if (!valid) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Set" showBack />
        <View style={styles.content}>
          <Card>
            <EmptyState art={<EmptyDeckArt />} title="No such set" body="That set no longer exists." />
          </Card>
        </View>
      </View>
    );
  }

  const count = items?.length ?? 0;
  const reviewing = pages.length > 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={set?.name ?? 'Set'}
        showBack
        trailingText={count > 0 ? `${count} ${count === 1 ? 'word' : 'words'}` : undefined}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {importing ? (
          <Card variant="bordered" style={styles.progressCard}>
            <Text style={styles.progressTitle}>
              {progress
                ? `Reading page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                : 'Reading pages'}
            </Text>
            <ProgressBar
              progress={progress && progress.total > 0 ? progress.done / progress.total : 0}
              color={colors.vocabulary}
            />
            <Text style={styles.progressNote}>
              Each page is a vision call taking tens of seconds. Leaving this screen cancels the
              pages that have not started.
            </Text>
          </Card>
        ) : (
          <>
            {!reviewing ? (
              <Card variant="bordered">
                <SectionHeading title="Tag new pages as" />
                <View style={styles.tierRow}>
                  {JLPT_TIERS.map((value) => (
                    <Pressable
                      key={String(value)}
                      onPress={() => setTier(value)}
                      style={styles.tierPressable}
                    >
                      <View style={[styles.tierChip, tier === value && styles.tierChipActive]}>
                        <Text style={[styles.tierLabel, tier === value && styles.tierLabelActive]}>
                          {value === null ? 'None' : `N${value}`}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </Card>
            ) : null}

            <ChunkyButton
              label={reviewing ? 'Add more pages' : 'Add pages'}
              tone="vocabulary"
              size="small"
              onPress={addPages}
              disabled={!api.isBackendConfigured || confirming}
            />
          </>
        )}

        {!api.isBackendConfigured ? (
          <Card variant="bordered">
            <Text style={styles.noticeText}>
              Set EXPO_PUBLIC_API_URL in mobile/.env and restart with --clear to reach your deck.
              Sets have no fixture fallback on purpose — they are yours, not samples.
            </Text>
          </Card>
        ) : null}

        {reviewing ? (
          <>
            <Overline style={styles.hint}>
              {pages.length === 1 ? 'Page to confirm' : `${pages.length} pages to confirm`}
            </Overline>
            <AmbiguityBanner count={pendingAmbiguous} />
            {pages.map((page, index) => (
              <ExtractionReview
                key={page.sourceId}
                items={page.items}
                title={pages.length === 1 ? 'Detected items' : `Page ${index + 1}`}
                onToggle={(key) => togglePageItem(page.sourceId, key)}
                onResolve={(key, reading) => resolvePageReading(page.sourceId, key, reading)}
              />
            ))}
          </>
        ) : null}

        {loading && !items ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.vocabulary} />
          </View>
        ) : null}

        {error ? (
          <Card variant="bordered" style={styles.errorCard}>
            <OfflineArt size={56} />
            <View style={styles.errorBody}>
              <Text style={styles.errorTitle}>Can&apos;t reach your deck</Text>
              <Text style={styles.errorText}>
                Browsing a set reads from the server. Nothing has been lost.
              </Text>
            </View>
          </Card>
        ) : null}

        {count > 0 ? (
          <>
            <Overline style={styles.hint}>Tap a card to turn it over</Overline>
            {items?.map((item) => (
              <Notecard key={item.id} item={item} />
            ))}

            <ChunkyButton
              label="Quiz me on what's due"
              tone="neutral"
              size="small"
              onPress={() => router.push('/quiz')}
              style={styles.quizButton}
            />
            <Text style={styles.quizNote}>
              The quiz draws every card that is due across your whole deck, not only this set.
            </Text>
          </>
        ) : null}

        {items && count === 0 && !error && !importing && !reviewing ? (
          <Card>
            <EmptyState
              art={<EmptyDeckArt />}
              title="Nothing in this set yet"
              body="Add pages to photograph a lesson into it. The words appear here once you confirm what the pages found."
            />
          </Card>
        ) : null}
      </ScrollView>

      {reviewing ? (
        <View style={styles.footer}>
          <ChunkyButton
            label={
              confirming
                ? 'Adding…'
                : `Add ${pendingSelected} word${pendingSelected === 1 ? '' : 's'}`
            }
            tone="vocabulary"
            disabled={pendingSelected === 0 || pendingAmbiguous > 0 || confirming}
            onPress={confirmPages}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One word, front and back.
 *
 * The front is the Japanese and the back is the meaning, matching the
 * recognition card — the direction you are in when reading a textbook page.
 * Production is the harder direction and belongs to the quiz, where an answer
 * is actually graded.
 */
function Notecard({ item }: { item: VocabItem }) {
  const [flipped, setFlipped] = React.useState(false);

  return (
    <Pressable onPress={() => setFlipped((previous) => !previous)}>
      {({ pressed }) => (
        <Card
          variant="bordered"
          style={[styles.notecard, pressed ? styles.notecardPressed : null]}
        >
          {flipped ? (
            <View style={styles.faceBack}>
              <Text style={styles.english}>{item.english}</Text>
              <Text style={styles.reading}>{item.furiganaOnly}</Text>
            </View>
          ) : (
            <View style={styles.faceFront}>
              <Text style={styles.word}>{item.kanjiFurigana}</Text>
              {item.usageContext ? (
                <Text style={styles.usage}>{item.usageContext}</Text>
              ) : null}
            </View>
          )}

          <View style={styles.notecardFooter}>
            <Text style={styles.footerMeta}>
              {item.jlptLevel ? `N${item.jlptLevel}` : 'Unsorted'}
              {item.isUserEdited ? ' · edited' : ''}
            </Text>
            <Text style={styles.footerHint}>{flipped ? 'Front' : 'Back'}</Text>
          </View>
        </Card>
      )}
    </Pressable>
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
    paddingBottom: 24,
    gap: spacing.stack,
  },
  footer: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 10,
    paddingBottom: 22,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  loading: {
    paddingVertical: 28,
  },
  hint: {
    marginTop: 6,
    marginLeft: 4,
  },

  tierRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 4,
  },
  tierPressable: {
    flex: 1,
  },
  tierChip: {
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radius.chip,
    paddingVertical: 7,
    alignItems: 'center',
  },
  tierChipActive: {
    backgroundColor: colors.vocabularyTint,
    borderColor: colors.vocabulary,
  },
  tierLabel: {
    ...typeScale.captionBold,
    color: colors.inkSoft,
  },
  tierLabelActive: {
    color: colors.vocabularyInk,
  },

  progressCard: {
    gap: 9,
  },
  progressTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  progressNote: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    lineHeight: 16,
  },
  noticeText: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 18,
  },

  notecard: {
    minHeight: 108,
    justifyContent: 'space-between',
    gap: 10,
  },
  notecardPressed: {
    backgroundColor: colors.hairline,
  },
  faceFront: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  faceBack: {
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
  },
  word: {
    ...jp.row,
    fontSize: 30,
    color: colors.ink,
    textAlign: 'center',
  },
  usage: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },
  english: {
    ...typeScale.cardTitle,
    color: colors.ink,
    textAlign: 'center',
  },
  reading: {
    ...jp.reading,
    color: colors.vocabularyInk,
  },
  notecardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 8,
  },
  footerMeta: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },
  footerHint: {
    ...typeScale.metaSmall,
    color: colors.inkDisabled,
  },

  quizButton: {
    borderRadius: radius.tile,
    marginTop: 4,
  },
  quizNote: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    textAlign: 'center',
    lineHeight: 16,
  },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  errorBody: {
    flex: 1,
    gap: 3,
  },
  errorTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  errorText: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    lineHeight: 16,
  },
});
