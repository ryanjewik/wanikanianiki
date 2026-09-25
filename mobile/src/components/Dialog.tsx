/**
 * The app's own dialog, in place of the system alert.
 *
 * `Alert.alert` draws Android's stock grey box: a different font, flat text
 * buttons, none of the app's colour — the one moment every screen stopped
 * looking like this app was the moment it had something to tell you. This is
 * the same card, type and chunky buttons as everything else, with the
 * Crabigator reacting to good or bad news.
 *
 * Called like the alert it replaces, from anywhere, without a hook:
 *
 *   showDialog({ title: 'Imported', message: '12 words added.', tone: 'success' });
 *
 * One `DialogHost`, mounted in the root layout, draws whichever is current.
 */
import * as React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MascotStill } from '@/components/Mascot';
import { Pop } from '@/components/motion';
import { ChunkyButton } from '@/components/ui';
import { colors, radius, shadows, type as typeScale } from '@/theme/tokens';

export type DialogTone = 'success' | 'error' | 'info' | 'confirm';

export interface DialogAction {
  label: string;
  /**
   * `primary` is the filled button, `destructive` the filled one in danger
   * pink, `cancel` the outlined one — and the one the back button and a tap
   * outside the card both mean.
   */
  kind?: 'primary' | 'destructive' | 'cancel';
  onPress?: () => void | Promise<void>;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** Picks the Crabigator's reaction; `info` and `confirm` go without. */
  tone?: DialogTone;
  /** Defaults to a single "OK". */
  actions?: DialogAction[];
}

type Listener = (dialog: DialogOptions | null) => void;

let current: DialogOptions | null = null;
const listeners = new Set<Listener>();

function publish(next: DialogOptions | null): void {
  current = next;
  for (const listener of listeners) listener(current);
}

/** Shows a dialog, replacing any that is already open. */
export function showDialog(options: DialogOptions): void {
  publish(options);
}

export function DialogHost() {
  const [dialog, setDialog] = React.useState<DialogOptions | null>(current);

  React.useEffect(() => {
    listeners.add(setDialog);
    return () => {
      listeners.delete(setDialog);
    };
  }, []);

  const actions = dialog?.actions?.length ? dialog.actions : [{ label: 'OK', kind: 'primary' as const }];
  const cancel = actions.find((action) => action.kind === 'cancel');
  // A lone button is an acknowledgement, so dismissing is the same as pressing it.
  const dismissAction = cancel ?? (actions.length === 1 ? actions[0] : null);

  // Closed first, then the handler runs: a handler that opens the next dialog
  // (a failed delete explaining itself) must not have it closed underneath it.
  const run = React.useCallback((action: DialogAction | null) => {
    if (!action) return;
    publish(null);
    void action.onPress?.();
  }, []);

  const art =
    dialog?.tone === 'success' ? (
      <MascotStill pose="correct" size={76} />
    ) : dialog?.tone === 'error' ? (
      <MascotStill pose="wrong" size={76} />
    ) : null;

  // Two buttons side by side; three or more stack, since three labels never fit a row.
  const stacked = actions.length > 2;
  const ordered = stacked
    ? [...actions.filter((a) => a.kind !== 'cancel'), ...actions.filter((a) => a.kind === 'cancel')]
    : [...actions.filter((a) => a.kind === 'cancel'), ...actions.filter((a) => a.kind !== 'cancel')];

  return (
    <Modal
      visible={dialog !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => run(dismissAction)}
    >
      <Pressable style={styles.backdrop} onPress={() => run(dismissAction)}>
        {dialog ? (
          // Swallows taps so pressing the card itself does not dismiss it.
          <Pressable onPress={() => undefined} style={styles.cardWrap}>
            <Pop key={dialog.title + (dialog.message ?? '')} style={styles.card}>
              {art ? <View style={styles.art}>{art}</View> : null}
              <Text style={styles.title}>{dialog.title}</Text>
              {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
              <View style={stacked ? styles.stack : styles.row}>
                {ordered.map((action) => (
                  <ChunkyButton
                    key={action.label}
                    label={action.label}
                    size="small"
                    chevron={false}
                    tone={action.kind === 'cancel' ? 'neutral' : 'kanji'}
                    cue={action.kind === 'cancel' ? 'back' : 'tap'}
                    onPress={() => run(action)}
                    style={StyleSheet.flatten([
                      stacked ? styles.stackButton : styles.rowButton,
                      action.kind === 'destructive' ? styles.destructive : null,
                    ])}
                  />
                ))}
              </View>
            </Pop>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 32, 36, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 380,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.ink,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    gap: 8,
    ...shadows.hard,
    shadowOffset: { width: 0, height: 4 },
  },
  art: {
    alignItems: 'center',
    marginTop: -4,
    marginBottom: 2,
  },
  title: {
    ...typeScale.cardTitle,
    color: colors.ink,
    textAlign: 'center',
  },
  message: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 19,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  rowButton: {
    flex: 1,
    borderRadius: radius.tile,
  },
  stack: {
    gap: 9,
    marginTop: 10,
  },
  stackButton: {
    borderRadius: radius.tile,
  },
  destructive: {
    backgroundColor: colors.danger,
  },
});
