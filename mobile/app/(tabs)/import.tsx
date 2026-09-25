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
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AmbiguityBanner,
  ExtractionReview,
  ambiguousItems,
  resolveReading as resolveReadingIn,
  selectedItems,
  toggleItem,
} from '@/components/ExtractionReview';
import { showDialog } from '@/components/Dialog';
import { FilterChips, type ChipOption } from '@/components/FilterChips';
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
import type { DetectedItem, StudyMode, VocabFolder, VocabSet } from '@/data/types';
import { feedback } from '@/feedback';
import { useVocabFolders, useVocabSets } from '@/hooks/useStudyData';
import {
  colors,
  radius,
  spacing,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

/** The tier the user picks at upload time, cascading to every extracted row. */
const JLPT_TIERS: (number | null)[] = [5, 4, 3, 2, 1, null];

/** What the server calls a page confirmed without a name: "Import Sep 25". */
function defaultSetName(): string {
  const now = new Date();
  return `Import ${now.toLocaleString('en-US', { month: 'short' })} ${now.getDate()}`;
}

/** Where the confirmed words go: a new set (named, maybe filed) or one you have. */
type Destination =
  | { kind: 'new'; name: string; folderId: number | null }
  | { kind: 'existing'; setId: number | null };

/** Why an upload failed, in terms of what to do about it. */
function importErrorMessage(error: unknown): string {
  if (error instanceof api.ApiError) {
    if (error.status === 401) {
      return 'The server refused this phone. Check the API key under My profile.';
    }
    if (error.status === 413 || error.status === 504) return error.message;
    if (error.status >= 500) return 'The server had a problem reading the page. Try again in a moment.';
    return `The server answered ${error.status}. Try again, or check My profile → Connection.`;
  }
  return "Couldn't reach the server. Check your connection and try again.";
}

export default function ImportScreen() {
  const router = useRouter();
  const { data: sets, reload: reloadSets } = useVocabSets();
  const { data: folders, reload: reloadFolders } = useVocabFolders();
  const [destination, setDestination] = React.useState<Destination>({
    kind: 'new',
    name: '',
    folderId: null,
  });
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
        showDialog({
          title: 'Permission needed',
          message:
            source === 'camera'
              ? 'Allow camera access to scan a textbook page.'
              : 'Allow photo access to pick a textbook page.',
        });
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
          // One request: it returns once the page has been read.
          const result = await api.uploadVocabPhoto(uri, tier);
          setSourceId(result.sourceId);
          if (result.status === 'failed') {
            feedback.wrong();
            showDialog({
              title: "Couldn't read that page",
              message: result.detail ?? 'Try a straighter, better-lit photo of the page.',
              tone: 'error',
            });
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
      } catch (error) {
        console.warn('[import] upload failed', error);
        // Say what went wrong. This used to fall back to the bundled sample
        // rows, which made a rejected upload look like a page that had been
        // read — twelve plausible words, some "already in your deck" — while
        // the real page never reached the server.
        feedback.wrong();
        showDialog({
          title: "Couldn't import that page",
          message: importErrorMessage(error),
          tone: 'error',
        });
        setImageUri(null);
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
  const needsSet = destination.kind === 'existing' && destination.setId === null;

  const commit = React.useCallback(async () => {
    // Send the rows back, not their ids: the user may have corrected a reading
    // or resolved an ambiguity, and the edited text is the point of the
    // review step.
    const words = (n: number) => `${n} word${n === 1 ? '' : 's'}`;
    const target =
      destination.kind === 'existing'
        ? (sets?.find((s) => s.id === destination.setId)?.name ?? 'your set')
        : destination.name.trim() || defaultSetName();

    if (api.isBackendConfigured && sourceId !== null) {
      setBusy(true);
      try {
        const created = await api.confirmVocabImport(
          sourceId,
          selected,
          destination.kind === 'existing'
            ? { setId: destination.setId ?? undefined }
            : { setName: destination.name, folderId: destination.folderId },
        );
        feedback.complete();
        showDialog({
          title: 'Imported',
          message: `${words(created.length)} added to "${target}".`,
          tone: 'success',
          actions: [
            { label: 'Import more', kind: 'cancel' },
            {
              label: 'See flashcards',
              kind: 'primary',
              onPress: () =>
                router.push(
                  destination.kind === 'existing' && destination.setId !== null
                    ? `/sets/${destination.setId}`
                    : '/sets',
                ),
            },
          ],
        });
        reloadSets();
      } catch (cause) {
        feedback.wrong();
        showDialog({
          title: 'Import failed',
          message:
            cause instanceof api.ApiError && cause.status === 404
              ? 'That set or folder no longer exists. Pick another and try again.'
              : 'Those words were not saved. Try again.',
          tone: 'error',
        });
        return;
      } finally {
        setBusy(false);
      }
    } else {
      feedback.complete();
      showDialog({
        title: 'Imported',
        message: `${words(selected.length)} added to "${target}".`,
        tone: 'success',
      });
    }
    setImageUri(null);
    setItems(null);
    setSourceId(null);
    setDestination({ kind: 'new', name: '', folderId: null });
  }, [destination, reloadSets, router, selected, sets, sourceId]);

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
                  <Pressable
                    key={String(value)}
                    onPress={() => setTier(value)}
                    onPressIn={feedback.toggle}
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

            <DestinationCard
              value={destination}
              onChange={setDestination}
              sets={sets ?? []}
              folders={folders ?? []}
              onFolderCreated={reloadFolders}
            />

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
            disabled={selected.length === 0 || ambiguous.length > 0 || needsSet || busy}
            onPress={commit}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Where the page's words land, chosen before they are committed: a new set
 * with a name and a folder of your choosing, or a set you already have.
 * Leaving the name blank keeps the old default, a set named after the day.
 */
function DestinationCard({
  value,
  onChange,
  sets,
  folders,
  onFolderCreated,
}: {
  value: Destination;
  onChange: (next: Destination) => void;
  sets: VocabSet[];
  folders: VocabFolder[];
  onFolderCreated: () => void;
}) {
  const [folderDraft, setFolderDraft] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const createFolder = React.useCallback(async () => {
    const name = folderDraft?.trim();
    if (!name || creating || value.kind !== 'new') return;
    setCreating(true);
    try {
      const folder = await api.createVocabFolder(name);
      feedback.correct();
      onFolderCreated();
      onChange({ ...value, folderId: folder.id });
      setFolderDraft(null);
    } catch (cause) {
      const duplicate = cause instanceof api.ApiError && cause.status === 409;
      feedback.wrong();
      showDialog({
        title: duplicate ? 'That folder exists' : "Couldn't create the folder",
        message: duplicate
          ? `You already have a folder called "${name}". Pick it from the list.`
          : 'Check your connection and try again.',
        tone: 'error',
      });
    } finally {
      setCreating(false);
    }
  }, [creating, folderDraft, onChange, onFolderCreated, value]);

  const folderOptions: ChipOption<number>[] = [
    { key: 0, label: 'No folder' },
    ...folders.map((f) => ({ key: f.id, label: f.name })),
  ];
  const setOptions: ChipOption<number>[] = sets.map((s) => ({ key: s.id, label: s.name }));

  return (
    <Card variant="bordered" style={styles.destinationCard}>
      <SectionHeading title="Save to" />
      <View style={styles.modeRow}>
        <ModeTile
          active={value.kind === 'new'}
          title="New set"
          subtitle="name it, file it"
          onPress={() => onChange({ kind: 'new', name: '', folderId: null })}
        />
        <ModeTile
          active={value.kind === 'existing'}
          title="Existing set"
          subtitle={sets.length > 0 ? 'add to one you have' : 'none yet'}
          onPress={() => {
            if (sets.length > 0) onChange({ kind: 'existing', setId: null });
          }}
        />
      </View>

      {value.kind === 'new' ? (
        <>
          <Text style={styles.fieldLabel}>Set name</Text>
          <TextInput
            value={value.name}
            onChangeText={(name) => onChange({ ...value, name })}
            placeholder={defaultSetName()}
            placeholderTextColor={colors.inkDisabled}
            style={styles.input}
            maxLength={128}
            returnKeyType="done"
          />

          <FilterChips
            label="Folder"
            options={folderOptions}
            selected={value.folderId ?? 0}
            onSelect={(key) => onChange({ ...value, folderId: key === 0 ? null : key })}
            trailing={{ label: '+ New folder', onPress: () => setFolderDraft('') }}
          />

          {folderDraft !== null ? (
            <View style={styles.folderDraft}>
              <TextInput
                value={folderDraft}
                onChangeText={setFolderDraft}
                placeholder="Quartet I"
                placeholderTextColor={colors.inkDisabled}
                style={[styles.input, styles.folderInput]}
                maxLength={128}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={createFolder}
              />
              <ChunkyButton
                label={creating ? 'Creating…' : 'Create'}
                tone="vocabulary"
                size="small"
                chevron={false}
                disabled={!folderDraft.trim() || creating}
                onPress={createFolder}
                style={styles.folderCreate}
              />
            </View>
          ) : null}
        </>
      ) : (
        <FilterChips
          label="Add to"
          options={setOptions}
          selected={value.setId ?? -1}
          onSelect={(key) => onChange({ kind: 'existing', setId: key })}
        />
      )}
    </Card>
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
    <Pressable onPress={onPress} onPressIn={feedback.select} style={styles.modeTilePressable}>
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

  destinationCard: {
    gap: 10,
  },
  fieldLabel: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    marginBottom: -4,
  },
  input: {
    ...typeScale.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  folderDraft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  folderInput: {
    flex: 1,
  },
  folderCreate: {
    borderRadius: radius.tile,
  },

  footer: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
    backgroundColor: colors.ground,
  },
});
