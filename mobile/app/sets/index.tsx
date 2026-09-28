/**
 * Your sets — the deck browser's front door.
 *
 * A set is how a person organises their own deck: "Quartet I, Lesson 1", "N3
 * verbs". Every import lands in one — a page photographed into a set joins it,
 * and a page from the Import tab gets a set of its own — and sets can be filed
 * into folders (one level: "Quartet I" holding its lessons) and tagged with a
 * JLPT tier. The chips at the top filter by both. Each set shows how many of
 * its flashcards you know; flashcards are studied a set at a time.
 *
 * Sets are named here and filled on the detail screen, because naming a group
 * and photographing into it are separate moments: you know what the lesson is
 * called before you have the pages open.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showDialog } from '@/components/Dialog';
import { FilterChips, type ChipOption } from '@/components/FilterChips';
import { EmptyDeckArt, OfflineArt } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  EmptyState,
  InlineButton,
  Overline,
  Pill,
  ProgressBar,
} from '@/components/ui';
import * as api from '@/data/api';
import type { VocabFolder, VocabSet } from '@/data/types';
import { feedback } from '@/feedback';
import { useVocabFolders, useVocabSets } from '@/hooks/useStudyData';
import { colors, radius, spacing, type as typeScale } from '@/theme/tokens';

/** Matches the backend's name columns, so a long name fails here first. */
const NAME_MAX_LENGTH = 128;

type FolderFilter = 'all' | 'unfiled' | number;
type JlptFilter = 'all' | number;

/** What the naming card is for: a new set, a new folder, or renaming one. */
type Naming = { kind: 'set' } | { kind: 'folder' } | { kind: 'rename'; folder: VocabFolder };

const JLPT_TIERS = [5, 4, 3, 2, 1] as const;

export default function SetsScreen() {
  const router = useRouter();
  const { data: sets, loading, error, reload } = useVocabSets();
  const { data: folders, reload: reloadFolders } = useVocabFolders();

  const [naming, setNaming] = React.useState<Naming | null>(null);
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [folderFilter, setFolderFilter] = React.useState<FolderFilter>('all');
  const [jlptFilter, setJlptFilter] = React.useState<JlptFilter>('all');

  /**
   * Counts change while you are away — a page finishes reading, or an import
   * lands on the detail screen — so the list re-reads whenever it comes back
   * into view rather than only on first mount.
   */
  useFocusEffect(
    React.useCallback(() => {
      reload();
      reloadFolders();
    }, [reload, reloadFolders]),
  );

  const trimmed = name.trim();

  const closeNaming = React.useCallback(() => {
    setNaming(null);
    setName('');
  }, []);

  const submitName = React.useCallback(async () => {
    if (!naming || !trimmed || saving) return;
    setSaving(true);
    try {
      if (naming.kind === 'set') {
        const created = await api.createVocabSet(trimmed);
        // A set made while a folder is showing belongs in that folder.
        if (typeof folderFilter === 'number') {
          await api.updateVocabSet(created.id, { folderId: folderFilter });
        }
        closeNaming();
        // Straight into the new set: it is empty, and adding pages is the only
        // thing you can do next.
        router.push(`/sets/${created.id}`);
      } else if (naming.kind === 'folder') {
        const created = await api.createVocabFolder(trimmed);
        closeNaming();
        feedback.correct();
        reloadFolders();
        setFolderFilter(created.id);
      } else {
        await api.renameVocabFolder(naming.folder.id, trimmed);
        closeNaming();
        feedback.correct();
        reloadFolders();
        showDialog({
          title: 'Folder renamed',
          message: `"${naming.folder.name}" is now "${trimmed}".`,
          tone: 'success',
        });
      }
    } catch (cause) {
      // 409 is the one failure worth naming precisely — names are unique per
      // user, so the fix is a different name rather than a retry.
      const duplicate = cause instanceof api.ApiError && cause.status === 409;
      const noun = naming.kind === 'set' ? 'set' : 'folder';
      feedback.wrong();
      showDialog({
        title: duplicate ? 'That name is taken' : `Couldn't save the ${noun}`,
        message: duplicate
          ? `You already have a ${noun} called "${trimmed}".`
          : 'Check that the app can reach your backend, then try again.',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [closeNaming, folderFilter, naming, reloadFolders, router, saving, trimmed]);

  const renameFolder = React.useCallback((folder: VocabFolder) => {
    setName(folder.name);
    setNaming({ kind: 'rename', folder });
  }, []);

  /** Asks first; the folder goes but its sets stay, unfiled. */
  const deleteFolder = React.useCallback(
    (folder: VocabFolder) => {
      const count = (sets ?? []).filter((s) => s.folderId === folder.id).length;
      showDialog({
        title: `Delete "${folder.name}"?`,
        message:
          count > 0
            ? `Its ${count} ${count === 1 ? 'set stays' : 'sets stay'}, just unfiled. No words are deleted.`
            : 'It is empty, so nothing else changes.',
        tone: 'confirm',
        actions: [
          { label: 'Keep it', kind: 'cancel' },
          {
            label: 'Delete folder',
            kind: 'destructive',
            onPress: async () => {
              try {
                await api.deleteVocabFolder(folder.id);
                feedback.back();
                if (folderFilter === folder.id) setFolderFilter('all');
                reloadFolders();
                reload();
              } catch {
                feedback.wrong();
                showDialog({
                  title: "Couldn't delete the folder",
                  message: 'Check your connection and try again.',
                  tone: 'error',
                });
              }
            },
          },
        ],
      });
    },
    [folderFilter, reload, reloadFolders, sets],
  );

  /** Long-press on a folder chip: the same two actions, as a menu. */
  const manageFolder = React.useCallback(
    (key: FolderFilter) => {
      const folder = folders?.find((f) => f.id === key);
      if (!folder) return;
      feedback.toggle();
      showDialog({
        title: folder.name,
        message: 'Rename this folder, or delete it. Deleting keeps its sets.',
        actions: [
          { label: 'Rename', kind: 'primary', onPress: () => renameFolder(folder) },
          { label: 'Delete folder', kind: 'destructive', onPress: () => deleteFolder(folder) },
          { label: 'Cancel', kind: 'cancel' },
        ],
      });
    },
    [deleteFolder, folders, renameFolder],
  );

  const selectedFolder =
    typeof folderFilter === 'number' ? (folders?.find((f) => f.id === folderFilter) ?? null) : null;

  const folderOptions: ChipOption<FolderFilter>[] = [
    { key: 'all', label: 'All' },
    { key: 'unfiled', label: 'Unfiled' },
    ...(folders ?? []).map((f) => ({ key: f.id as FolderFilter, label: f.name })),
  ];
  const jlptOptions: ChipOption<JlptFilter>[] = [
    { key: 'all', label: 'All levels' },
    ...JLPT_TIERS.map((n) => ({ key: n as JlptFilter, label: `N${n}` })),
  ];

  const visible = (sets ?? []).filter(
    (set) =>
      (folderFilter === 'all' ||
        (folderFilter === 'unfiled' ? set.folderId === null : set.folderId === folderFilter)) &&
      (jlptFilter === 'all' || set.jlptLevel === jlptFilter),
  );

  // Grouped by folder when showing everything; one flat list otherwise.
  const sections: { title: string | null; sets: VocabSet[] }[] =
    folderFilter === 'all'
      ? [
          ...(folders ?? []).map((f) => ({
            title: f.name,
            sets: visible.filter((s) => s.folderId === f.id),
          })),
          {
            title: folders && folders.length > 0 ? 'Unfiled' : null,
            sets: visible.filter((s) => s.folderId === null),
          },
        ].filter((section) => section.sets.length > 0)
      : [{ title: null, sets: visible }];

  const namingTitle =
    naming?.kind === 'set'
      ? 'Name this set'
      : naming?.kind === 'folder'
        ? 'Name this folder'
        : 'Rename folder';

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Flashcards"
        showBack
        trailingText={sets && sets.length > 0 ? `${sets.length} sets` : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {naming ? (
          <Card variant="bordered" style={styles.namingCard}>
            <Text style={styles.namingLabel}>{namingTitle}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={naming.kind === 'set' ? 'Quartet I, Lesson 1' : 'Quartet I'}
              placeholderTextColor={colors.inkDisabled}
              style={styles.input}
              maxLength={NAME_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitName}
            />
            <View style={styles.namingActions}>
              <InlineButton label="Cancel" emphasis="quiet" onPress={closeNaming} />
              <ChunkyButton
                label={saving ? 'Saving…' : naming.kind === 'rename' ? 'Rename' : 'Create'}
                tone="vocabulary"
                size="small"
                chevron={false}
                disabled={!trimmed || saving}
                onPress={submitName}
                style={styles.createButton}
              />
            </View>
          </Card>
        ) : (
          <ChunkyButton
            label="New set"
            tone="vocabulary"
            size="small"
            onPress={() => setNaming({ kind: 'set' })}
          />
        )}

        {sets && sets.length > 0 ? (
          <Card variant="bordered" style={styles.filterCard}>
            <FilterChips
              label="Folder"
              options={folderOptions}
              selected={folderFilter}
              onSelect={setFolderFilter}
              onLongPress={manageFolder}
              trailing={{ label: '+ Folder', onPress: () => setNaming({ kind: 'folder' }) }}
            />
            {selectedFolder ? (
              <View style={styles.folderActions}>
                <ChunkyButton
                  label="✎  Rename folder"
                  tone="neutral"
                  size="small"
                  chevron={false}
                  onPress={() => renameFolder(selectedFolder)}
                  style={styles.folderButton}
                />
                <ChunkyButton
                  label="Delete folder"
                  tone="neutral"
                  size="small"
                  chevron={false}
                  onPress={() => deleteFolder(selectedFolder)}
                  style={styles.folderButton}
                />
              </View>
            ) : null}
            <FilterChips
              label="JLPT level"
              options={jlptOptions}
              selected={jlptFilter}
              onSelect={setJlptFilter}
            />
          </Card>
        ) : null}

        {loading && !sets ? (
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
                Sets live on the server, so this list needs a connection. Your words are safe.
              </Text>
            </View>
          </Card>
        ) : null}

        {sections.map((section) => (
          <View key={section.title ?? 'all'} style={styles.section}>
            {section.title ? <Overline style={styles.sectionTitle}>{section.title}</Overline> : null}
            {section.sets.map((set) => (
              <SetRow key={set.id} set={set} onPress={() => router.push(`/sets/${set.id}`)} />
            ))}
          </View>
        ))}

        {sets && sets.length > 0 && visible.length === 0 ? (
          <Card>
            <Text style={styles.noMatch}>No sets match these filters.</Text>
          </Card>
        ) : null}

        {sets && sets.length === 0 && !error ? (
          <Card>
            <EmptyState
              art={<EmptyDeckArt />}
              title="No sets yet"
              body="A set groups the pages of one lesson together, so a five-page import lands as one deck instead of thirty loose words. Pages imported from the Import tab get a set of their own."
            />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SetRow({ set, onPress }: { set: VocabSet; onPress: () => void }) {
  /**
   * "5 pages, 2 still reading" is the state that matters during a multi-page
   * import, and it comes from the pages' own statuses rather than a progress
   * field, so it stays true even if the app was closed mid-import.
   */
  const pageNote =
    set.pageCount > 0
      ? `${set.pageCount} ${set.pageCount === 1 ? 'page' : 'pages'}`
      : null;

  return (
    <Pressable onPress={onPress} onPressIn={feedback.select}>
      {({ pressed }) => (
        <Card variant="bordered" style={[styles.setCard, pressed ? styles.setCardPressed : null]}>
          <View style={styles.setHeader}>
            <Text style={styles.setName} numberOfLines={1}>
              {set.name}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>

          <View style={styles.setMetaRow}>
            <Text style={styles.setMeta}>
              {set.itemCount} {set.itemCount === 1 ? 'word' : 'words'}
              {pageNote ? ` · ${pageNote}` : ''}
            </Text>

            {set.jlptLevel ? (
              <Pill
                label={`N${set.jlptLevel}`}
                color={colors.radicalInk}
                background={colors.radicalTint}
              />
            ) : null}
            {set.pagesPending > 0 ? (
              <Pill
                label={`${set.pagesPending} reading`}
                color={colors.warningInk}
                background={colors.warningTint}
              />
            ) : null}
            {set.pagesFailed > 0 ? (
              <Pill
                label={`${set.pagesFailed} failed`}
                color={colors.dangerInk}
                background={colors.dangerTint}
              />
            ) : null}
          </View>

          {set.cardCount > 0 ? (
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <ProgressBar
                  progress={set.knownCount / set.cardCount}
                  color={set.knownCount >= set.cardCount ? colors.success : colors.vocabulary}
                />
              </View>
              <Text style={styles.progressText}>
                {set.knownCount >= set.cardCount
                  ? 'Complete'
                  : `${set.knownCount}/${set.cardCount} known`}
              </Text>
            </View>
          ) : null}

          {set.description ? (
            <Text style={styles.setDescription} numberOfLines={2}>
              {set.description}
            </Text>
          ) : null}
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

  namingCard: {
    gap: 10,
  },
  namingLabel: {
    ...typeScale.section,
    color: colors.ink,
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
  namingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  createButton: {
    borderRadius: radius.tile,
  },

  filterCard: {
    gap: 12,
  },
  folderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  folderButton: {
    flex: 1,
    borderRadius: radius.tile,
  },
  section: {
    gap: spacing.stack,
  },
  sectionTitle: {
    marginTop: 6,
  },
  noMatch: {
    ...typeScale.caption,
    color: colors.inkSoft,
    textAlign: 'center',
  },

  setCard: {
    gap: 7,
  },
  setCardPressed: {
    backgroundColor: colors.hairline,
  },
  setHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setName: {
    ...typeScale.cardTitle,
    color: colors.ink,
    flex: 1,
  },
  chevron: {
    ...typeScale.cardTitle,
    color: colors.inkFaint,
  },
  setMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  setMeta: {
    ...typeScale.meta,
    color: colors.inkSoft,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    flex: 1,
  },
  progressText: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },
  setDescription: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 17,
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
