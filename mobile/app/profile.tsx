/**
 * My profile — who is studying, how it is going, and how this phone is set up.
 *
 * Reached from the crabigator avatar on the dashboard, and from the banner the
 * dashboard shows when the server turns this phone away. Three parts, in the
 * order they get looked at:
 *
 * - **You.** The WaniKani username and level, and the streak — read-only,
 *   because WaniKani owns them; there is nothing here to set that would not be
 *   overwritten by the next sync.
 * - **How it feels.** The sound and haptics switches. The same card sits on the
 *   study hub, where people meet it; here is where they look for it later.
 * - **Connection.** The server and the API key. The key is pasted once, saved
 *   to secure storage and tested straight away: a key that is saved but wrong
 *   would otherwise look exactly like being offline. It is never shown back.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FeedbackToggles } from '@/components/FeedbackToggles';
import { MascotAvatar } from '@/components/Mascot';
import { showDialog } from '@/components/Dialog';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, InlineButton, Overline, StatTile } from '@/components/ui';
import { API_BASE_URL, checkConnection, isBackendConfigured } from '@/data/api';
import { clearApiKey, getApiKey, saveApiKey, useAuthStatus } from '@/data/credentials';
import { formatSyncedAgo, syncNow } from '@/data/sync';
import { feedback } from '@/feedback';
import { useDashboard } from '@/hooks/useStudyData';
import { colors, radius, spacing, type as typeScale } from '@/theme/tokens';

type Check = 'idle' | 'checking' | 'ok' | 'unauthorized' | 'unreachable';

const CHECK_TEXT: Record<Exclude<Check, 'idle' | 'checking'>, string> = {
  ok: 'Connected. The server accepted this phone.',
  unauthorized: 'The server refused this key. Check it matches API_KEY on the server.',
  unreachable: "Couldn't reach the server. The key is saved — try again when you're online.",
};

export default function ProfileScreen() {
  const auth = useAuthStatus();
  const { data: dashboard, reload } = useDashboard();
  const [hasKey, setHasKey] = React.useState<boolean | null>(null);
  const [draft, setDraft] = React.useState('');
  const [check, setCheck] = React.useState<Check>('idle');

  React.useEffect(() => {
    void getApiKey().then((key) => setHasKey(Boolean(key)));
  }, []);

  const test = React.useCallback(async () => {
    setCheck('checking');
    const result = await checkConnection();
    setCheck(result);
    if (result === 'ok') {
      feedback.correct();
      // Anything queued while the phone was locked out goes now, rather than
      // waiting for the next pull-to-refresh — and the card above re-reads,
      // since it was drawn from whatever could be loaded without the key.
      void syncNow().then(reload);
    } else {
      feedback.wrong();
    }
  }, [reload]);

  const save = React.useCallback(async () => {
    const key = draft.trim();
    if (!key) return;
    try {
      await saveApiKey(key);
    } catch {
      showDialog({
        title: 'Could not save the key',
        message: 'Secure storage is unavailable on this device.',
        tone: 'error',
      });
      return;
    }
    setDraft('');
    setHasKey(true);
    await test();
  }, [draft, test]);

  const forget = React.useCallback(() => {
    showDialog({
      title: 'Forget this key?',
      message: 'The app will stop reaching the server until a key is entered again.',
      tone: 'confirm',
      actions: [
        { label: 'Cancel', kind: 'cancel' },
        {
          label: 'Forget',
          kind: 'destructive',
          onPress: async () => {
            await clearApiKey();
            setHasKey(false);
            setCheck('idle');
          },
        },
      ],
    });
  }, []);

  const verdict = check === 'idle' || check === 'checking' ? null : check;

  const user = dashboard?.user;
  const synced = formatSyncedAgo(dashboard?.lastSyncedAt ?? null);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="My profile" showBack />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.hero}>
          <MascotAvatar size={84} style={styles.heroAvatar} />
          <Text style={styles.name} numberOfLines={1}>
            {user?.username ?? 'Studying'}
          </Text>
          <Text style={styles.subtitle}>
            {user ? `Level ${user.level}` : 'Level unknown'}
            {dashboard ? ` · ${dashboard.levelProgress.daysAtLevel} days at this level` : ''}
          </Text>

          {dashboard ? (
            <View style={styles.stats}>
              <StatTile value={`${dashboard.streak.days}日`} label="streak" tone="kanji" />
              <StatTile value={`${dashboard.streak.best}日`} label="best streak" />
              <StatTile value={dashboard.reviewCount} label="reviews due" />
            </View>
          ) : null}

          {synced ? <Text style={styles.synced}>{synced}</Text> : null}
        </Card>

        <Overline style={styles.overline}>How it feels</Overline>
        <Card variant="bordered">
          <FeedbackToggles />
        </Card>

        <Overline style={styles.overline}>Connection</Overline>
        <Card variant="bordered" style={styles.card}>
          <Text style={styles.label}>Server</Text>
          <Text style={styles.value} selectable>
            {isBackendConfigured ? API_BASE_URL : 'None set — the app is showing sample data.'}
          </Text>
        </Card>

        <Card variant="bordered" style={styles.card}>
          <Text style={styles.label}>API key</Text>
          <Text style={styles.hint}>
            {hasKey
              ? 'A key is saved on this phone. Paste a new one to replace it.'
              : 'Paste the API_KEY your server was set up with. It is kept in this phone’s secure storage and sent with every request.'}
          </Text>

          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={hasKey ? '••••••••••••' : 'Paste the key'}
            placeholderTextColor={colors.inkDisabled}
            style={styles.input}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="done"
            onSubmitEditing={save}
          />

          <View style={styles.actions}>
            <ChunkyButton
              label={check === 'checking' ? 'Checking…' : 'Save and test'}
              tone="kanji"
              size="small"
              chevron={false}
              disabled={!draft.trim() || check === 'checking'}
              onPress={save}
              style={styles.button}
            />
            {hasKey ? <InlineButton label="Test" onPress={test} /> : null}
            {hasKey ? <InlineButton label="Forget" emphasis="quiet" onPress={forget} /> : null}
          </View>

          {verdict ? (
            <Text style={[styles.result, verdict === 'ok' ? styles.resultOk : styles.resultBad]}>
              {CHECK_TEXT[verdict]}
            </Text>
          ) : auth === 'rejected' || auth === 'missing' ? (
            <Text style={[styles.result, styles.resultBad]}>
              {auth === 'missing'
                ? 'The server asks for a key and this phone has none.'
                : 'The server refused the key saved on this phone.'}
            </Text>
          ) : null}
        </Card>
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
    paddingBottom: 24,
    gap: spacing.stack,
  },
  hero: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 18,
  },
  heroAvatar: {
    borderWidth: 2,
    borderColor: colors.ink,
    marginBottom: 6,
  },
  name: {
    ...typeScale.title,
    color: colors.ink,
  },
  subtitle: {
    ...typeScale.body,
    color: colors.inkSoft,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 12,
  },
  synced: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
    marginTop: 8,
  },
  overline: {
    marginTop: 8,
  },
  card: {
    gap: 8,
  },
  label: {
    ...typeScale.section,
    color: colors.ink,
  },
  value: {
    ...typeScale.body,
    color: colors.inkMuted,
  },
  hint: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 17,
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  button: {
    borderRadius: radius.tile,
    paddingHorizontal: 18,
  },
  result: {
    ...typeScale.caption,
    lineHeight: 17,
  },
  resultOk: {
    color: colors.successInk,
  },
  resultBad: {
    color: colors.dangerInk,
  },
});
