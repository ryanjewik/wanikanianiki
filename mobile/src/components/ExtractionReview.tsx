/**
 * The OCR review list, shared by both places a page can be imported.
 *
 * Nothing extracted from a photo reaches the deck until someone has looked at
 * it: a reading the model marked ambiguous has to be resolved, a row already in
 * the deck is skipped rather than duplicated, and the *edited* rows are what
 * get sent back on confirm. That review is the same review whether the page was
 * photographed from the Import tab or into a named set, so it lives here rather
 * than as two copies that would drift — the way `grading.ts` and `srs.py` are
 * kept honest by a parity check because they could not be shared.
 *
 * Presentational on purpose: the rows are owned by the screen (each has its own
 * confirm endpoint and its own idea of what happens afterwards), and the two
 * transforms that edit them are exported as pure functions.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckMark } from '@/components/icons';
import { Card, SectionHeading } from '@/components/ui';
import type { DetectedItem } from '@/data/types';
import { colors, jp, radius, type as typeScale } from '@/theme/tokens';

/**
 * Flip one row's selection.
 *
 * A duplicate is never selectable — it is already in the deck, and importing it
 * again would give the same word a second, divergent SRS state.
 */
export function toggleItem(items: DetectedItem[], key: string): DetectedItem[] {
  return items.map((item) =>
    item.key === key && item.status !== 'duplicate'
      ? { ...item, selected: !item.selected }
      : item,
  );
}

/**
 * Settle an ambiguous reading.
 *
 * Picking one clears the ambiguity and selects the row: the user has just told
 * us which reading it is, so leaving it unselected would make them tap twice to
 * say one thing.
 */
export function resolveReading(
  items: DetectedItem[],
  key: string,
  reading: string,
): DetectedItem[] {
  return items.map((item) =>
    item.key === key
      ? { ...item, furiganaOnly: reading, status: 'ok', selected: true, note: undefined }
      : item,
  );
}

/** Rows still needing a reading picked. Confirm stays disabled while any remain. */
export function ambiguousItems(items: DetectedItem[]): DetectedItem[] {
  return items.filter((item) => item.status === 'ambiguous');
}

/** Rows that will actually be imported. */
export function selectedItems(items: DetectedItem[]): DetectedItem[] {
  return items.filter((item) => item.selected);
}

export function AmbiguityBanner({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <View style={styles.warningBanner}>
      <View style={styles.warningBadge}>
        <Text style={styles.warningBadgeText}>!</Text>
      </View>
      <Text style={styles.warningText}>
        {count === 1 ? 'One reading looked' : `${count} readings looked`} ambiguous. Pick the right
        one before importing.
      </Text>
    </View>
  );
}

export interface ExtractionReviewProps {
  items: DetectedItem[];
  onToggle: (key: string) => void;
  onResolve: (key: string, reading: string) => void;
  /** Card heading — the page's label when several pages are under review. */
  title?: string;
  /**
   * Total the page yielded, when it differs from what is rendered. Only the
   * Import tab's fixture path passes this; it counts rows the sample truncates.
   */
  total?: number;
}

export function ExtractionReview({
  items,
  onToggle,
  onResolve,
  title = 'Detected items',
  total,
}: ExtractionReviewProps) {
  const selected = selectedItems(items);
  const shown = total ?? items.length;

  return (
    <Card variant="bordered">
      <SectionHeading
        title={title}
        trailing={`${selected.length} of ${shown} selected`}
        trailingColor={colors.vocabulary}
      />
      <View>
        {items.map((item, index) => (
          <DetectedRow
            key={item.key}
            item={item}
            isLast={index === items.length - 1}
            onToggle={() => onToggle(item.key)}
            onResolve={(reading) => onResolve(item.key, reading)}
          />
        ))}
      </View>
      {items.length < shown ? <Text style={styles.showAll}>Show all {shown} ›</Text> : null}
    </Card>
  );
}

export function DetectedRow({
  item,
  isLast,
  onToggle,
  onResolve,
}: {
  item: DetectedItem;
  isLast: boolean;
  onToggle: () => void;
  onResolve: (reading: string) => void;
}) {
  const duplicate = item.status === 'duplicate';
  const ambiguous = item.status === 'ambiguous';

  return (
    <View>
      <Pressable onPress={onToggle} disabled={duplicate}>
        <View
          style={[
            styles.detectedRow,
            !isLast && styles.rowDivider,
            ambiguous && styles.detectedRowWarning,
          ]}
        >
          <View
            style={[
              styles.checkbox,
              item.selected && !ambiguous && styles.checkboxChecked,
              ambiguous && styles.checkboxWarning,
              duplicate && styles.checkboxEmpty,
            ]}
          >
            {ambiguous ? (
              <Text style={styles.checkboxWarningText}>?</Text>
            ) : item.selected ? (
              <CheckMark size={14} />
            ) : null}
          </View>

          <Text style={[styles.detectedWord, duplicate && styles.mutedText]}>
            {item.kanjiFurigana}
          </Text>

          <View style={styles.detectedBody}>
            <Text style={[styles.detectedEnglish, duplicate && styles.mutedText]}>
              {item.english}
            </Text>
            <Text style={[styles.detectedReading, ambiguous && styles.warningReading]}>
              {item.note ?? item.furiganaOnly}
            </Text>
          </View>

          {duplicate ? (
            <Text style={styles.detectedTrailing}>Skipped</Text>
          ) : ambiguous ? (
            <Text style={styles.fixLink}>Fix ›</Text>
          ) : item.jlptLevel ? (
            <View style={styles.jlptChip}>
              <Text style={styles.jlptChipText}>N{item.jlptLevel}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {ambiguous && item.readingChoices ? (
        <View style={styles.choiceRow}>
          {item.readingChoices.map((choice) => (
            <Pressable key={choice} onPress={() => onResolve(choice)}>
              <View style={styles.choiceChip}>
                <Text style={styles.choiceText}>{choice}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  detectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  detectedRowWarning: {
    backgroundColor: colors.warningRow,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.vocabulary,
    borderColor: colors.vocabulary,
  },
  checkboxWarning: {
    borderColor: colors.warning,
  },
  checkboxEmpty: {
    borderColor: colors.outline,
  },
  checkboxWarningText: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 11,
    color: colors.warning,
  },
  detectedWord: {
    ...jp.row,
    color: colors.ink,
    width: 56,
  },
  mutedText: {
    color: colors.inkFaint,
  },
  detectedBody: {
    flex: 1,
    gap: 1,
  },
  detectedEnglish: {
    ...typeScale.body,
    fontFamily: typeScale.section.fontFamily,
    color: colors.ink,
  },
  detectedReading: {
    ...typeScale.meta,
    fontFamily: typeScale.caption.fontFamily,
    color: colors.inkFaint,
  },
  warningReading: {
    fontFamily: typeScale.meta.fontFamily,
    color: colors.warningInk,
  },
  detectedTrailing: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },
  fixLink: {
    ...typeScale.meta,
    color: colors.warning,
  },
  jlptChip: {
    backgroundColor: colors.vocabularyTint,
    borderRadius: radius.chip,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  jlptChipText: {
    fontFamily: typeScale.meta.fontFamily,
    fontSize: 9.5,
    color: colors.vocabulary,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 7,
    paddingBottom: 10,
    paddingLeft: 31,
  },
  choiceChip: {
    borderWidth: 1.5,
    borderColor: colors.warning,
    backgroundColor: colors.warningTint,
    borderRadius: radius.tile,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  choiceText: {
    ...jp.chipSmall,
    fontSize: 15,
    color: colors.warningInk,
  },
  showAll: {
    marginTop: 11,
    ...typeScale.captionBold,
    color: colors.inkSoft,
  },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radius.card,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  warningBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningBadgeText: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 13,
    color: colors.onSolid,
  },
  warningText: {
    flex: 1,
    ...typeScale.caption,
    color: colors.warningInkDeep,
    lineHeight: 18,
  },
});
