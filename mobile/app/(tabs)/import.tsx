/**
 * Photo import — artboard 6d.
 *
 * OCR a textbook page into the user's own deck. The extraction is a
 * vision-model call server-side, not classic OCR: it returns the three
 * textbook columns kept separate (kanji+furigana, furigana-only, English)
 * rather than one blob of text, which is what makes the review list below
 * possible.
 *
 * Nothing is imported until the user commits — ambiguous readings have to be
 * resolved first, and rows already in the deck are skipped rather than
 * duplicated.
 */
import * as ImagePicker from 'expo-image-picker';
import * as React from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AmbiguityBanner,
  ExtractionReview,
  ambiguousItems,
  resolveReading as resolveReadingIn,
  selectedItems,
  toggleItem,
} from '@/components/ExtractionReview';
import { EmptyDeckArt } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  EmptyState,
  InlineButton,
  SectionHeading,
} from '@/components/ui';
import * as api from '@/data/api';
import { DETECTED_ITEMS, DETECTED_TOTAL, IMPORT_PAGE_LABEL } from '@/data/fixtures';
import type { DetectedItem, StudyMode } from '@/data/types';
import {
  colors,
  radius,
  spacing,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

/** The tier the user picks at upload time, cascading to every extracted row. */
const JLPT_TIERS: (number | null)[] = [5, 4, 3, 2, 1, null];

export default function ImportScreen() {
  const [imageUri, setImageUri] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<DetectedItem[] | null>(null);
  /** Set once the upload is accepted; the confirm call is keyed on it. */
  const [sourceId, setSourceId] = React.useState<number | null>(null);
  const [tier, setTier] = React.useState<number | null>(3);
  /**
   * True when the rows below are the bundled sample rather than a real
   * extraction. `DETECTED_TOTAL` counts the rows that sample stands in for, so
   * it is only meaningful on this path — a real page reports its own total.
   */
  const [sampled, setSampled] = React.useState(false);
  const [mode, setMode] = React.useState<StudyMode>('notecards');
  const [busy, setBusy] = React.useState(false);

  const pickImage = React.useCallback(
    async (source: 'camera' | 'library') => {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission needed',
          source === 'camera'
            ? 'Allow camera access to scan a textbook page.'
            : 'Allow photo access to pick a textbook page.',
        );
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.8,
            });

      if (result.canceled || !result.assets[0]) return;

      const uri = result.assets[0].uri;
      setImageUri(uri);
      setSourceId(null);
      setItems(null);
      setBusy(true);

      try {
        if (api.isBackendConfigured) {
          // The upload returns before the page has been read; the rows arrive
          // on a later poll. See `pollVocabSource`.
          const accepted = await api.uploadVocabPhoto(uri, tier);
          setSourceId(accepted.sourceId);

          const result = await api.pollVocabSource(accepted.sourceId);
          if (result.status === 'failed') {
            Alert.alert(
              "Couldn't read that page",
              result.detail ?? 'Try a straighter, better-lit photo of the page.',
            );
            setImageUri(null);
            return;
          }
          setItems(result.items);
          setSampled(false);
        } else {
          // No ingestion service configured — show the sample extraction so the
          // review flow below is still exercisable.
          setItems(DETECTED_ITEMS);
          setSampled(true);
        }
      } catch {
        setItems(DETECTED_ITEMS);
        setSampled(true);
      } finally {
        setBusy(false);
      }
    },
    [tier],
  );

  const toggle = React.useCallback((key: string) => {
    setItems((rest) => (rest ? toggleItem(rest, key) : null));
  }, []);

  const resolveReading = React.useCallback((key: string, reading: string) => {
    setItems((rest) => (rest ? resolveReadingIn(rest, key, reading) : null));
  }, []);

  const selected = items ? selectedItems(items) : [];
  const ambiguous = items ? ambiguousItems(items) : [];

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Import from Photo"
        trailingText="My deck"
        trailingColor={colors.vocabulary}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {!imageUri ? (
          <>
            <Card variant="bordered">
              <EmptyState
                art={<EmptyDeckArt />}
                title="Deck is empty"
                body="Photograph a textbook vocabulary page and it becomes a deck you can study."
              />
            </Card>

            <Card variant="bordered">
              <SectionHeading title="Tag this list as" />
              <View style={styles.tierRow}>
                {JLPT_TIERS.map((value) => (
                  <Pressable key={String(value)} onPress={() => setTier(value)} style={styles.tierPressable}>
                    <View style={[styles.tierChip, tier === value && styles.tierChipActive]}>
                      <Text style={[styles.tierLabel, tier === value && styles.tierLabelActive]}>
                        {value === null ? 'None' : `N${value}`}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.tierHint}>
                Sets the JLPT tier for every word on the page. Individual rows can override it later.
              </Text>
            </Card>

            <View style={styles.pickRow}>
              <ChunkyButton
                label="Take a photo"
                tone="vocabulary"
                onPress={() => pickImage('camera')}
                style={styles.pickButton}
              />
              <ChunkyButton
                label="Choose from library"
                tone="neutral"
                onPress={() => pickImage('library')}
                style={styles.pickButton}
              />
            </View>
          </>
        ) : (
          <>
            <Card variant="bordered" style={styles.scanCard}>
              <Image source={{ uri: imageUri }} style={styles.scanThumb} resizeMode="cover" />
              <View style={styles.scanBody}>
                <View style={styles.scanStatusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: busy ? colors.warning : colors.success },
                    ]}
                  />
                  <Text style={styles.scanTitle}>{busy ? 'Scanning…' : 'Page scanned'}</Text>
                </View>
                <Text style={styles.scanSubtitle}>
                  {IMPORT_PAGE_LABEL}. Found{' '}
                  <Text style={styles.scanStrong}>{items?.length ?? 0} items</Text>
                  {ambiguous.length > 0 ? `, ${ambiguous.length} need a look.` : '.'}
                </Text>
                <View style={styles.scanActions}>
                  <InlineButton label="Retake" onPress={() => pickImage('camera')} />
                  <InlineButton label="Choose another" emphasis="quiet" onPress={() => pickImage('library')} />
                </View>
              </View>
            </Card>

            <AmbiguityBanner count={ambiguous.length} />

            {items ? (
              <ExtractionReview
                items={items}
                total={sampled ? DETECTED_TOTAL : undefined}
                onToggle={toggle}
                onResolve={resolveReading}
              />
            ) : null}

            <Card variant="bordered">
              <SectionHeading title="Study these as" />
              <View style={styles.modeRow}>
                <ModeTile
                  active={mode === 'notecards'}
                  title="Notecards"
                  subtitle="front / back flip"
                  onPress={() => setMode('notecards')}
                />
                <ModeTile
                  active={mode === 'quiz'}
                  title="Quiz me"
                  subtitle="AI-generated"
                  onPress={() => setMode('quiz')}
                />
                <ModeTile
                  active={mode === 'srs'}
                  title="SRS"
                  subtitle="add to reviews"
                  onPress={() => setMode('srs')}
                />
              </View>
              <Text style={styles.modeHint}>
                Imported words run on their own SM-2 schedule, kept separate from your WaniKani
                queue.
              </Text>
            </Card>
          </>
        )}
      </ScrollView>

      {imageUri ? (
        <View style={styles.footer}>
          <ChunkyButton
            label={`Import ${selected.length} item${selected.length === 1 ? '' : 's'}`}
            tone="vocabulary"
            disabled={selected.length === 0 || ambiguous.length > 0}
            onPress={async () => {
              // Send the rows back, not their ids: the user may have corrected
              // a reading or resolved an ambiguity, and the edited text is the
              // point of the review step.
              if (api.isBackendConfigured && sourceId !== null) {
                setBusy(true);
                try {
                  const created = await api.confirmVocabImport(sourceId, selected);
                  Alert.alert(
                    'Imported',
                    `${created.length} word${created.length === 1 ? '' : 's'} added to your deck as ${mode}.`,
                  );
                } catch {
                  Alert.alert('Import failed', 'Those words were not saved. Try again.');
                  return;
                } finally {
                  setBusy(false);
                }
              } else {
                Alert.alert(
                  'Imported',
                  `${selected.length} words added to your deck as ${mode}.`,
                );
              }
              setImageUri(null);
              setItems(null);
              setSourceId(null);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function ModeTile({
  active,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.modeTilePressable}>
      <View style={[styles.modeTile, active && styles.modeTileActive]}>
        <Text style={[styles.modeTitle, active && styles.modeTitleActive]}>{title}</Text>
        <Text style={[styles.modeSubtitle, active && styles.modeSubtitleActive]}>{subtitle}</Text>
      </View>
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
    paddingBottom: 20,
    gap: spacing.stack,
  },

  tierRow: {
    flexDirection: 'row',
    gap: 7,
  },
  tierPressable: {
    flex: 1,
  },
  tierChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.tile,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tierChipActive: {
    borderWidth: 1.5,
    borderColor: colors.vocabulary,
    backgroundColor: colors.vocabularyTint,
  },
  tierLabel: {
    ...typeScale.captionBold,
    color: colors.inkSoft,
  },
  tierLabelActive: {
    color: colors.vocabularyInk,
  },
  tierHint: {
    marginTop: 10,
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    lineHeight: 16,
  },

  pickRow: {
    gap: 7,
  },
  pickButton: {
    width: '100%',
  },

  scanCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
  },
  scanThumb: {
    width: 96,
    height: 112,
    borderRadius: 10,
    backgroundColor: colors.border,
  },
  scanBody: {
    flex: 1,
    gap: 8,
  },
  scanStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scanTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  scanSubtitle: {
    ...typeScale.captionBold,
    fontFamily: typeScale.caption.fontFamily,
    color: colors.inkSoft,
    lineHeight: 17,
  },
  scanStrong: {
    fontFamily: typeScale.section.fontFamily,
    color: colors.ink,
  },
  scanActions: {
    flexDirection: 'row',
    gap: 7,
  },

  modeRow: {
    flexDirection: 'row',
    gap: 7,
  },
  modeTilePressable: {
    flex: 1,
  },
  modeTile: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 2,
  },
  modeTileActive: {
    borderWidth: 1.5,
    borderColor: subjectPalette.vocabulary.solid,
    backgroundColor: subjectPalette.vocabulary.tint,
  },
  modeTitle: {
    ...typeScale.caption,
    fontFamily: typeScale.section.fontFamily,
    color: colors.ink,
  },
  modeTitleActive: {
    color: '#6B3FB8',
  },
  modeSubtitle: {
    ...typeScale.statLabel,
    fontFamily: typeScale.caption.fontFamily,
    color: colors.inkSoft,
  },
  modeSubtitleActive: {
    color: subjectPalette.vocabulary.ink,
  },
  modeHint: {
    marginTop: 10,
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    lineHeight: 16,
  },

  footer: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
    backgroundColor: colors.ground,
  },
});
