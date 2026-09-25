/**
 * A row of choice chips: exactly one selected, scrolling sideways when there
 * are more than fit. Used for the folder and JLPT filters on the set browser
 * and for choosing a set's folder and tier.
 */
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { feedback } from '@/feedback';
import { colors, radius, subjectPalette, type as typeScale } from '@/theme/tokens';

export interface ChipOption<K extends string | number> {
  key: K;
  label: string;
}

export function FilterChips<K extends string | number>({
  label,
  options,
  selected,
  onSelect,
  onLongPress,
  trailing,
}: {
  label?: string;
  options: ChipOption<K>[];
  selected: K;
  onSelect: (key: K) => void;
  /** For chips that can be managed — a folder's rename and delete. */
  onLongPress?: (key: K) => void;
  /** An extra chip after the options, such as "+ Folder". */
  trailing?: { label: string; onPress: () => void };
}) {
  const accent = subjectPalette.vocabulary;

  return (
    <View style={styles.block}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {options.map((option) => {
          const active = option.key === selected;
          return (
            <Pressable
              key={String(option.key)}
              onPress={() => onSelect(option.key)}
              onLongPress={onLongPress ? () => onLongPress(option.key) : undefined}
              onPressIn={feedback.select}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.chip,
                    active && { backgroundColor: accent.tint, borderColor: accent.solid },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipText, active && { color: accent.ink }]}>
                    {option.label}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
        {trailing ? (
          <Pressable onPress={trailing.onPress} onPressIn={feedback.tap}>
            {({ pressed }) => (
              <View style={[styles.chip, styles.chipDashed, pressed && styles.pressed]}>
                <Text style={styles.chipText}>{trailing.label}</Text>
              </View>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 6,
  },
  label: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },
  row: {
    gap: 7,
    paddingRight: 4,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.tile,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipDashed: {
    borderStyle: 'dashed',
    borderColor: colors.outline,
  },
  chipText: {
    ...typeScale.captionBold,
    color: colors.inkMuted,
  },
  pressed: {
    opacity: 0.6,
  },
});
