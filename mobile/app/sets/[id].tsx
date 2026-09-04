/**
 * One set — browse it as notecards, or photograph more pages into it.
 *
 * This is the "Notecards" mode the study hub has always advertised. Browsing is
 * deliberately not a quiz: every word in the set is here, due or not, nothing
 * is graded, and nothing is written to the SRS. Tapping a card turns it over.
 * `/quiz` is the screen that schedules; this one is for reading a deck.
 *
 * Adding pages here rather than on the import tab is what makes a multi-page
 * import land as one named group: `importPagesIntoSet` uploads each page with
 * its position, and the words inherit the set from the page they came from.
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

import { EmptyDeckArt, OfflineArt } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, EmptyState, Overline, ProgressBar } from '@/components/ui';
import * as api from '@/data/api';
import type { VocabItem } from '@/data/types';
import { useVocabSetItems, useVocabSets } from '@/hooks/useStudyData';
import { colors, jp, radius, spacing, type as typeScale } from '@/theme/tokens';

/** The tier a page is imported at, cascading to the rows it yields. */
const DEFAULT_TIER = 3;

export default function SetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const setId = Number(id);
  const valid = Number.isFinite(setId);

  const { data: sets } = useVocabSets();
  const { data: items, loading, error, reload } = useVocabSetItems(valid ? setId : null);

  const [importing, setImporting] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);

  const set = sets?.find((candidate) => candidate.id === setId) ?? null;

  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  /**
   * Pick several pages at once and read them one after another.
   *
   * `orderedSelection` matters more than it looks: the words are stored in the
   * order their pages were read, so without it a five-page lesson comes back
   * shuffled into whatever order the gallery felt like returning.
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
      const results = await api.importPagesIntoSet(setId, uris, DEFAULT_TIER, (done, total) =>
        setProgress({ done, total }),
      );

      const failed = results.filter((result) => result.status === 'failed').length;
      const readRows = results.reduce((total, result) => total + result.items.length, 0);

      /**
       * The pages are read but nothing is in the deck yet — confirming an
       * extraction means resolving ambiguous readings, which is the import
       * tab's review list, not something to guess at here.
       */
      Alert.alert(
        failed === 0 ? 'Pages read' : `${failed} of ${uris.length} pages failed`,
        `${readRows} rows extracted. Open each page on the Import tab to check the readings and add them to the deck.`,
      );
      reload();
    } catch {
      Alert.alert(
        "Couldn't finish the import",
        'The pages that were already read are kept. Try the rest again.',
      );
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }, [reload, setId]);

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
              {progress ? `Reading page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : 'Reading pages'}
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
          <ChunkyButton
            label="Add pages"
            tone="vocabulary"
            size="small"
            onPress={addPages}
            disabled={!api.isBackendConfigured}
          />
        )}

        {!api.isBackendConfigured ? (
          <Card variant="bordered">
            <Text style={styles.noticeText}>
              Set `EXPO_PUBLIC_API_URL` in `mobile/.env` and restart with `--clear` to reach your
              deck. Sets have no fixture fallback on purpose — they are yours, not samples.
            </Text>
          </Card>
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

        {items && count === 0 && !error && !importing ? (
          <Card>
            <EmptyState
              art={<EmptyDeckArt />}
              title="Nothing in this set yet"
              body="Add pages to photograph a lesson into it. Words appear here once you confirm the readings on the Import tab."
            />
          </Card>
        ) : null}
      </ScrollView>
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

  loading: {
    paddingVertical: 28,
  },
  hint: {
    marginTop: 6,
    marginLeft: 4,
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
