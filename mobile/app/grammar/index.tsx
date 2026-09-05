/**
 * Your grammar — the log, and the one field it takes to add to it.
 *
 * The whole premise is that logging costs eight characters. You type
 * `～てからでないと` and stop; the meaning, formation, register and examples are
 * something a model fills in afterwards and you confirm. Asking for a meaning
 * here — a meaning you would have to look up — would defeat logging it at all,
 * so the composer is one input and a date the device already knows.
 *
 * Re-logging a point you already have reopens it rather than adding a second
 * calendar mark, which is why a duplicate is a navigation rather than an error.
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
import { Card, ChunkyButton, EmptyState, Pill } from '@/components/ui';
import * as api from '@/data/api';
import type { GrammarEntry } from '@/data/types';
import { useGrammarEntries } from '@/hooks/useStudyData';
import { colors, jp, radius, spacing, type as typeScale } from '@/theme/tokens';

/** Matches `grammar_entries.pattern`, so an over-long one fails here first. */
const PATTERN_MAX_LENGTH = 128;

/**
 * The day this goes on the calendar, in the device's own zone.
 *
 * Deliberately not `toISOString()`, which converts to UTC first and files an
 * evening in the Americas under tomorrow — the exact mistake `services/dates.py`
 * exists to prevent on the server side. The phone already knows which day it is
 * for the person holding it.
 */
export function todayForDevice(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function GrammarScreen() {
  const router = useRouter();
  const { data: entries, loading, error, reload } = useGrammarEntries();

  const [pattern, setPattern] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  // An entry gets confirmed or deleted on the detail screen, so the list
  // re-reads on the way back rather than only on first mount.
  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  const trimmed = pattern.trim();

  const logPoint = React.useCallback(async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const created = await api.createGrammarEntry({
        pattern: trimmed,
        learnedOn: todayForDevice(),
      });
      setPattern('');
      // Straight to the point just logged: it is empty until it is filled in,
      // and filling it in is the only thing you can do next.
      router.push(`/grammar/${created.id}`);
    } catch {
      Alert.alert(
        'Could not log that',
        'Check that the app can reach your backend, then try again.',
      );
    } finally {
      setSaving(false);
    }
  }, [router, saving, trimmed]);

  const unchecked = entries?.filter((e) => !e.enriched && e.meaning).length ?? 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Your grammar"
        showBack
        trailingText={entries && entries.length > 0 ? `${entries.length} points` : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card variant="bordered" style={styles.composer}>
          <Text style={styles.composerLabel}>Log a point</Text>
          <TextInput
            value={pattern}
            onChangeText={setPattern}
            placeholder="～てからでないと"
            placeholderTextColor={colors.inkDisabled}
            style={styles.input}
            maxLength={PATTERN_MAX_LENGTH}
            returnKeyType="done"
            onSubmitEditing={logPoint}
            autoCorrect={false}
          />
          <View style={styles.composerFoot}>
            <Text style={styles.composerHint}>
              The pattern is enough. Everything else gets filled in for you to check.
            </Text>
            <ChunkyButton
              label={saving ? 'Logging…' : 'Log'}
              tone="radical"
              size="small"
              chevron={false}
              disabled={!trimmed || saving}
              onPress={logPoint}
              style={styles.logButton}
            />
          </View>
        </Card>

        {unchecked > 0 ? (
          <Card variant="bordered" style={styles.noticeCard}>
            <Text style={styles.noticeText}>
              {unchecked} {unchecked === 1 ? 'point is' : 'points are'} filled in but unchecked.
              Nothing generated is used as context until you confirm it.
            </Text>
          </Card>
        ) : null}

        {loading && !entries ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.radical} />
          </View>
        ) : null}

        {error ? (
          <Card variant="bordered" style={styles.errorCard}>
            <OfflineArt size={56} />
            <View style={styles.errorBody}>
              <Text style={styles.errorTitle}>Can&apos;t reach your grammar</Text>
              <Text style={styles.errorText}>
                Points live on the server, so this list needs a connection. Nothing you logged is
                lost.
              </Text>
            </View>
          </Card>
        ) : null}

        {entries?.map((entry) => (
          <GrammarRow
            key={entry.id}
            entry={entry}
            onPress={() => router.push(`/grammar/${entry.id}`)}
          />
        ))}

        {entries && entries.length === 0 && !error ? (
          <Card>
            <EmptyState
              art={<EmptyDeckArt />}
              title="Nothing logged yet"
              body="Type a pattern the moment it comes up in class. Logging is not studying — a point you write down shows on the calendar without touching your streak."
            />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function GrammarRow({ entry, onPress }: { entry: GrammarEntry; onPress: () => void }) {
  /**
   * Three states worth distinguishing, and only three: nothing filled in yet,
   * filled in but unchecked, and confirmed. The middle one is the one that
   * matters — unconfirmed text must never read as an answer.
   */
  const status = !entry.meaning ? 'empty' : entry.enriched ? 'confirmed' : 'unchecked';

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <Card variant="bordered" style={[styles.row, pressed ? styles.rowPressed : null]}>
          <View style={styles.rowHeader}>
            <Text style={styles.pattern} numberOfLines={1}>
              {entry.pattern}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>

          {entry.senseLabel ? (
            <Text style={styles.sense} numberOfLines={1}>
              {entry.senseLabel}
            </Text>
          ) : null}

          {entry.meaning ? (
            <Text style={styles.meaning} numberOfLines={2}>
              {entry.meaning}
            </Text>
          ) : null}

          <View style={styles.rowMeta}>
            <Text style={styles.date}>{entry.learnedOn}</Text>
            {entry.jlptLevel ? (
              <Pill
                label={`N${entry.jlptLevel}`}
                color={colors.radicalInk}
                background={colors.radicalTint}
              />
            ) : null}
            {status === 'unchecked' ? (
              <Pill
                label="Needs a check"
                color={colors.warningInk}
                background={colors.warningTint}
              />
            ) : null}
            {status === 'empty' ? (
              <Pill label="Not filled in" color={colors.inkSoft} background={colors.hairline} />
            ) : null}
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

  composer: {
    gap: 10,
  },
  composerLabel: {
    ...typeScale.section,
    color: colors.ink,
  },
  input: {
    ...jp.answer,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  composerFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  composerHint: {
    ...typeScale.caption,
    color: colors.inkSoft,
    flex: 1,
    lineHeight: 16,
  },
  logButton: {
    borderRadius: radius.tile,
    paddingHorizontal: 20,
  },

  noticeCard: {
    backgroundColor: colors.warningRow,
    borderColor: colors.warningBorder,
  },
  noticeText: {
    ...typeScale.caption,
    color: colors.warningInkDeep,
    lineHeight: 17,
  },

  row: {
    gap: 6,
  },
  rowPressed: {
    backgroundColor: colors.hairline,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pattern: {
    ...jp.row,
    color: colors.ink,
    flex: 1,
  },
  chevron: {
    ...typeScale.cardTitle,
    color: colors.inkFaint,
  },
  sense: {
    ...typeScale.metaSmall,
    color: colors.radicalInk,
  },
  meaning: {
    ...typeScale.caption,
    color: colors.inkMuted,
    lineHeight: 17,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  date: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
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
