/**
 * One grammar point — fill it in, check it, keep it.
 *
 * The screen is built around a single rule the backend already enforces:
 * nothing generated is yours until you say so. `enriched` stays false until the
 * PATCH that sets it, and until then everything on this screen is presented as
 * a draft — banner, tinted ground, and a Confirm button that is the only way
 * out of that state. Showing generated text the same way as confirmed text
 * would quietly turn a plausible guess into something you rehearse.
 *
 * Enrichment has three outcomes and they are not variations of each other:
 *
 * - It filled the point in. Check it and confirm.
 * - It did not recognise the pattern. That is a typo, not a retry — pressing
 *   the button again asks the same question and gets the same answer, so the
 *   offer is to edit the pattern.
 * - The pattern has several senses and none was named. `～ものだ` is four points
 *   wearing one string; picking one for you would end with a point that tests a
 *   sense the class never covered. So the senses are listed and you choose.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
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

import { OfflineArt } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  InlineButton,
  Overline,
  Pill,
  TextButton,
} from '@/components/ui';
import * as api from '@/data/api';
import type { GrammarEntry } from '@/data/types';
import { useGrammarEntry } from '@/hooks/useStudyData';
import { colors, jp, radius, spacing, type as typeScale } from '@/theme/tokens';

/**
 * Why enrichment failed, in words worth showing.
 *
 * Three of these are not "try again". A missing key means the feature is off
 * server-side and pressing the button forever will not turn it on; a 502 is an
 * upstream failure whose message the backend deliberately wrote to be read by
 * the person who pressed the button; and a timeout is a client-side abort — the
 * request is held open rather than polled, so it surfaces as an `AbortError`
 * from `fetch` rather than as any HTTP status.
 */
function describeEnrichFailure(cause: unknown): [string, string] {
  if (cause instanceof Error && cause.name === 'AbortError') {
    return [
      'That took too long',
      'The answer is waited for rather than polled, so a slow one gives up. Try once more.',
    ];
  }
  if (cause instanceof api.ApiError) {
    const detail =
      cause.body && typeof cause.body === 'object' && 'detail' in cause.body
        ? (cause.body as { detail?: unknown }).detail
        : undefined;
    const message = typeof detail === 'string' ? detail : null;

    if (cause.status === 503) {
      return [
        'Filling in is switched off',
        message ?? 'The server has no Anthropic key configured, so it cannot fill this in.',
      ];
    }
    if (cause.status === 502 && message) return ['Could not fill it in', message];
  }
  return [
    'Could not fill it in',
    'Check that the app can reach your backend, then try again.',
  ];
}

export default function GrammarDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const entryId = Number(id);

  const { data: loaded, loading, error, reload } = useGrammarEntry(
    Number.isFinite(entryId) ? entryId : null,
  );

  /**
   * The row is edited in several ways on this screen, so it is held locally
   * once loaded. Every mutation returns the updated row, which means the
   * screen never has to re-fetch to show what it just did.
   */
  const [entry, setEntry] = React.useState<GrammarEntry | null>(null);
  React.useEffect(() => {
    if (loaded) setEntry(loaded);
  }, [loaded]);

  const [working, setWorking] = React.useState(false);
  /** Senses offered by the last enrichment that refused to pick one. */
  const [senses, setSenses] = React.useState<string[]>([]);
  const [editingNote, setEditingNote] = React.useState(false);
  const [note, setNote] = React.useState('');

  const enrich = React.useCallback(async () => {
    if (!entry || working) return;
    setWorking(true);
    setSenses([]);
    try {
      const result = await api.enrichGrammarEntry(entry.id);
      setEntry(result.entry);

      if (result.applied) return;

      if (result.unrecognised) {
        Alert.alert(
          'Not a pattern it recognises',
          `"${entry.pattern}" did not come back as a grammar point. That is usually a typo — correcting the pattern is more likely to help than asking again.`,
        );
        return;
      }
      if (result.otherSenses.length > 0) {
        // Rendered below rather than shown in an alert: choosing is the next
        // step, and the senses are too long to read in a system dialog.
        setSenses(result.otherSenses);
      }
    } catch (cause) {
      const [title, message] = describeEnrichFailure(cause);
      Alert.alert(title, message);
    } finally {
      setWorking(false);
    }
  }, [entry, working]);

  /** Name the sense, then ask again now that the question is unambiguous. */
  const chooseSense = React.useCallback(
    async (sense: string) => {
      if (!entry || working) return;
      setWorking(true);
      try {
        const named = await api.updateGrammarEntry(entry.id, { senseLabel: sense });
        setEntry(named);
        setSenses([]);
        const result = await api.enrichGrammarEntry(named.id);
        setEntry(result.entry);
        if (!result.applied && result.otherSenses.length > 0) setSenses(result.otherSenses);
      } catch (cause) {
        // The uniqueness rule is (pattern, sense), so this is the one case
        // where the fix is to go to the entry you already have.
        const duplicate = cause instanceof api.ApiError && cause.status === 409;
        Alert.alert(
          duplicate ? 'You already have that sense' : 'Could not set the sense',
          duplicate
            ? `"${entry.pattern}" is already logged under "${sense}".`
            : 'Check that the app can reach your backend, then try again.',
        );
      } finally {
        setWorking(false);
      }
    },
    [entry, working],
  );

  const confirm = React.useCallback(async () => {
    if (!entry || working) return;
    setWorking(true);
    try {
      setEntry(await api.updateGrammarEntry(entry.id, { enriched: true }));
    } catch {
      Alert.alert('Could not confirm', 'Check your connection, then try again.');
    } finally {
      setWorking(false);
    }
  }, [entry, working]);

  const saveNote = React.useCallback(async () => {
    if (!entry || working) return;
    setWorking(true);
    try {
      const trimmed = note.trim();
      setEntry(await api.updateGrammarEntry(entry.id, { note: trimmed || null }));
      setEditingNote(false);
    } catch {
      Alert.alert('Could not save that note', 'Check your connection, then try again.');
    } finally {
      setWorking(false);
    }
  }, [entry, note, working]);

  const remove = React.useCallback(() => {
    if (!entry) return;
    Alert.alert(
      'Delete this point?',
      `"${entry.pattern}" and its example sentences go for good. The day stays on your calendar only if something else happened on it.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteGrammarEntry(entry.id);
              router.back();
            } catch {
              Alert.alert('Could not delete it', 'Check your connection, then try again.');
            }
          },
        },
      ],
    );
  }, [entry, router]);

  if (loading && !entry) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Grammar" showBack />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.radical} />
        </View>
      </View>
    );
  }

  if (error || !entry) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Grammar" showBack />
        <View style={styles.content}>
          <Card variant="bordered" style={styles.errorCard}>
            <OfflineArt size={56} />
            <View style={styles.errorBody}>
              <Text style={styles.errorTitle}>Can&apos;t reach this point</Text>
              <Text style={styles.errorText}>
                Grammar lives on the server. Nothing you logged is lost.
              </Text>
            </View>
          </Card>
          <InlineButton label="Try again" onPress={reload} />
        </View>
      </View>
    );
  }

  const filled = Boolean(entry.meaning);
  const draft = filled && !entry.enriched;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Grammar"
        showBack
        trailingText={entry.enriched ? 'Confirmed' : undefined}
        trailingColor={colors.successInk}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card variant="bordered" style={styles.headCard}>
          <Text style={styles.pattern}>{entry.pattern}</Text>
          <View style={styles.headMeta}>
            <Text style={styles.date}>Logged {entry.learnedOn}</Text>
            {entry.senseLabel ? (
              <Pill
                label={entry.senseLabel}
                color={colors.radicalInk}
                background={colors.radicalTint}
              />
            ) : null}
            {entry.jlptLevel ? (
              <Pill
                label={`N${entry.jlptLevel}`}
                color={colors.inkSoft}
                background={colors.hairline}
              />
            ) : null}
            {entry.style ? (
              <Pill
                label={entry.style}
                color={colors.inkSoft}
                background={colors.hairline}
              />
            ) : null}
          </View>
        </Card>

        {senses.length > 0 ? (
          <Card variant="bordered" style={styles.senseCard}>
            <Text style={styles.senseTitle}>Which sense do you mean?</Text>
            <Text style={styles.senseBody}>
              This pattern covers several points. Naming one keeps the answer to the sense your
              class actually covered.
            </Text>
            {senses.map((sense) => (
              <Pressable key={sense} onPress={() => chooseSense(sense)} disabled={working}>
                {({ pressed }) => (
                  <View style={[styles.senseRow, pressed ? styles.senseRowPressed : null]}>
                    <Text style={styles.senseRowText}>{sense}</Text>
                    <Text style={styles.chevron}>›</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </Card>
        ) : null}

        {draft ? (
          <Card variant="bordered" style={styles.draftBanner}>
            <Text style={styles.draftText}>
              Filled in for you, not yet checked. Read it before confirming — it is not used as
              context anywhere until you do.
            </Text>
          </Card>
        ) : null}

        {filled ? (
          <Card variant="bordered" style={draft ? styles.draftCard : undefined}>
            <Overline style={styles.overline}>Meaning</Overline>
            <Text style={styles.body}>{entry.meaning}</Text>

            {entry.formation ? (
              <>
                <Overline style={styles.overline}>Formation</Overline>
                <Text style={styles.body}>{entry.formation}</Text>
              </>
            ) : null}
          </Card>
        ) : (
          <Card variant="bordered" style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing filled in yet</Text>
            <Text style={styles.emptyBody}>
              The pattern is all you logged. Ask for the meaning, formation, register and a
              couple of example sentences — then check them before they count.
            </Text>
          </Card>
        )}

        {entry.examples.length > 0 ? (
          <Card variant="bordered" style={draft ? styles.draftCard : undefined}>
            <Overline style={styles.overline}>Examples</Overline>
            {entry.examples.map((example, index) => (
              <View
                key={`${example.japanese}-${index}`}
                style={[styles.example, index > 0 ? styles.exampleDivided : null]}
              >
                <Text style={styles.japanese}>{example.japanese}</Text>
                {example.english ? (
                  <Text style={styles.english}>{example.english}</Text>
                ) : null}
                {example.isUserSupplied ? (
                  <Text style={styles.yours}>Yours</Text>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        <Card variant="bordered">
          <View style={styles.noteHead}>
            <Overline style={styles.overline}>Your note</Overline>
            {!editingNote ? (
              <TextButton
                label={entry.note ? 'Edit' : 'Add'}
                onPress={() => {
                  setNote(entry.note ?? '');
                  setEditingNote(true);
                }}
              />
            ) : null}
          </View>

          {editingNote ? (
            <View style={styles.noteEditor}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Where it came up, what tripped you on it…"
                placeholderTextColor={colors.inkDisabled}
                style={styles.noteInput}
                multiline
                autoFocus
              />
              <View style={styles.noteActions}>
                <InlineButton
                  label="Cancel"
                  emphasis="quiet"
                  onPress={() => setEditingNote(false)}
                />
                <InlineButton label={working ? 'Saving…' : 'Save'} onPress={saveNote} />
              </View>
            </View>
          ) : (
            <Text style={entry.note ? styles.body : styles.noteEmpty}>
              {entry.note ?? 'Nothing yet. Your own context never gets overwritten by enrichment.'}
            </Text>
          )}
        </Card>

        <View style={styles.actions}>
          {draft ? (
            <ChunkyButton
              label={working ? 'Confirming…' : 'Looks right — confirm'}
              tone="radical"
              chevron={false}
              disabled={working}
              onPress={confirm}
            />
          ) : null}

          {!filled ? (
            <ChunkyButton
              label={working ? 'Filling it in…' : 'Fill this in'}
              tone="radical"
              chevron={false}
              disabled={working}
              onPress={enrich}
            />
          ) : null}

          {filled ? (
            <InlineButton
              label={working ? 'Working…' : 'Ask again'}
              emphasis="quiet"
              onPress={enrich}
            />
          ) : null}

          <TextButton label="Delete this point" color={colors.dangerInk} onPress={remove} />
        </View>
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
    paddingBottom: 32,
    gap: spacing.stack,
  },
  loading: {
    paddingVertical: 40,
  },

  headCard: {
    gap: 8,
  },
  pattern: {
    ...jp.answer,
    color: colors.ink,
  },
  headMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  date: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },

  draftBanner: {
    backgroundColor: colors.warningRow,
    borderColor: colors.warningBorder,
  },
  draftText: {
    ...typeScale.caption,
    color: colors.warningInkDeep,
    lineHeight: 17,
  },
  draftCard: {
    borderColor: colors.warningBorder,
  },

  overline: {
    color: colors.inkFaint,
    marginBottom: 4,
  },
  body: {
    ...typeScale.bodyLoose,
    color: colors.inkMuted,
    marginBottom: 8,
  },

  emptyCard: {
    gap: 5,
  },
  emptyTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  emptyBody: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 17,
  },

  senseCard: {
    gap: 7,
    borderColor: colors.radicalTint,
    backgroundColor: colors.surface,
  },
  senseTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  senseBody: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 17,
    marginBottom: 2,
  },
  senseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: radius.control,
    backgroundColor: colors.radicalTint,
  },
  senseRowPressed: {
    opacity: 0.65,
  },
  senseRowText: {
    ...typeScale.caption,
    color: colors.radicalInk,
    flex: 1,
    lineHeight: 17,
  },
  chevron: {
    ...typeScale.cardTitle,
    color: colors.radicalInk,
  },

  example: {
    gap: 3,
    paddingVertical: 8,
  },
  exampleDivided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  japanese: {
    ...jp.reading,
    color: colors.ink,
    lineHeight: 30,
  },
  english: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 17,
  },
  yours: {
    ...typeScale.metaSmall,
    color: colors.radicalInk,
  },

  noteHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteEmpty: {
    ...typeScale.caption,
    color: colors.inkFaint,
    lineHeight: 17,
  },
  noteEditor: {
    gap: 9,
  },
  noteInput: {
    ...typeScale.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 74,
    textAlignVertical: 'top',
    backgroundColor: colors.surface,
  },
  noteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },

  actions: {
    gap: 12,
    alignItems: 'center',
    paddingTop: 4,
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
