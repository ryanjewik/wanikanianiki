/**
 * Your sets — the deck browser's front door.
 *
 * A set is how a person organises their own deck: "Quartet I, Lesson 1", "N3
 * verbs". The backend has had sets since the flashcard migration, but nothing
 * in the app ever named one, which made multi-page import unreachable — pages
 * could only ever land loose in the deck.
 *
 * Sets are named here and filled on the detail screen, because naming a group
 * and photographing into it are separate moments: you know what the lesson is
 * called before you have the pages open.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EmptyDeckArt, OfflineArt } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, EmptyState, InlineButton, Pill } from '@/components/ui';
import * as api from '@/data/api';
import type { VocabSet } from '@/data/types';
import { useVocabSets } from '@/hooks/useStudyData';
import { colors, radius, spacing, type as typeScale } from '@/theme/tokens';

/** Matches the backend's `vocab_sets.name` column, so a long name fails here. */
const NAME_MAX_LENGTH = 128;

export default function SetsScreen() {
  const router = useRouter();
  const { data: sets, loading, error, reload } = useVocabSets();

  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  /**
   * Counts change while you are away — a page finishes reading, or an import
   * lands on the detail screen — so the list re-reads whenever it comes back
   * into view rather than only on first mount.
   */
  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  const trimmed = name.trim();

  const createSet = React.useCallback(async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const created = await api.createVocabSet(trimmed);
      setName('');
      setNaming(false);
      // Straight into the new set: it is empty, and adding pages is the only
      // thing you can do next.
      router.push(`/sets/${created.id}`);
    } catch (cause) {
      // 409 is the one failure worth naming precisely — the constraint is on
      // (user, name), so the fix is a different name rather than a retry.
      const duplicate = cause instanceof api.ApiError && cause.status === 409;
      Alert.alert(
        duplicate ? 'That name is taken' : "Couldn't create the set",
        duplicate
          ? `You already have a set called "${trimmed}".`
          : 'Check that the app can reach your backend, then try again.',
      );
    } finally {
      setSaving(false);
    }
  }, [router, saving, trimmed]);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Your sets"
        showBack
        trailingText={sets && sets.length > 0 ? `${sets.length} sets` : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {naming ? (
          <Card variant="bordered" style={styles.namingCard}>
            <Text style={styles.namingLabel}>Name this set</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Quartet I, Lesson 1"
              placeholderTextColor={colors.inkDisabled}
              style={styles.input}
              maxLength={NAME_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={createSet}
            />
            <View style={styles.namingActions}>
              <InlineButton
                label="Cancel"
                emphasis="quiet"
                onPress={() => {
                  setNaming(false);
                  setName('');
                }}
              />
              <ChunkyButton
                label={saving ? 'Creating…' : 'Create'}
                tone="vocabulary"
                size="small"
                disabled={!trimmed || saving}
                onPress={createSet}
                style={styles.createButton}
              />
            </View>
          </Card>
        ) : (
          <ChunkyButton
            label="New set"
            tone="vocabulary"
            size="small"
            onPress={() => setNaming(true)}
          />
        )}

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

        {sets?.map((set) => (
          <SetRow key={set.id} set={set} onPress={() => router.push(`/sets/${set.id}`)} />
        ))}

        {sets && sets.length === 0 && !error ? (
          <Card>
            <EmptyState
              art={<EmptyDeckArt />}
              title="No sets yet"
              body="A set groups the pages of one lesson together, so a five-page import lands as one deck instead of thirty loose words."
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
    <Pressable onPress={onPress}>
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
    paddingHorizontal: 18,
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
