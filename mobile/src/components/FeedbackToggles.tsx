/**
 * The two switches that govern how the app feels.
 *
 * There is no settings screen in the designs and the tab bar is full at four,
 * so this lives as a card on the study hub rather than behind a route of its
 * own. That is the right place anyway: it sits with the other decisions about
 * how you study, and it is visible rather than buried, which matters for a
 * pair of switches most people will touch exactly once.
 */
import * as React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import {
  feedback,
  setFeedbackSetting,
  soundAvailable,
  useFeedbackSettings,
} from '@/feedback';
import { colors, type as typeScale } from '@/theme/tokens';

export function FeedbackToggles() {
  const settings = useFeedbackSettings();

  return (
    <View style={styles.rows}>
      <ToggleRow
        title="Sound"
        // Said plainly, because it is the question people actually have before
        // turning this on in a quiet room.
        blurb={
          soundAvailable
            ? 'Short cues for right, wrong and finishing a session. Follows your phone’s silent switch.'
            : 'Unavailable in this build — rebuild the app to enable sound.'
        }
        value={settings.sound && soundAvailable}
        disabled={!soundAvailable}
        onChange={(next) => void setFeedbackSetting('sound', next)}
      />
      <View style={styles.divider} />
      <ToggleRow
        title="Haptics"
        blurb="A tap you can feel when an answer lands. Works with the phone silenced."
        value={settings.haptics}
        onChange={(next) => {
          // Fired before the setting lands, so switching haptics *off* still
          // buzzes once on the way out — the confirmation that it worked.
          feedback.toggle();
          void setFeedbackSetting('haptics', next);
        }}
      />
    </View>
  );
}

function ToggleRow({
  title,
  blurb,
  value,
  disabled = false,
  onChange,
}: {
  title: string;
  blurb: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.blurb}>{blurb}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.kanji }}
        thumbColor={colors.surface}
        // Android draws an unpleasant grey-green track without this.
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typeScale.section,
    color: colors.ink,
  },
  blurb: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
  },
});
