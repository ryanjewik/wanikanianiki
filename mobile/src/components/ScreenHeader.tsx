/**
 * The white bar at the top of every screen.
 *
 * Three shapes appear in the designs and they share one component:
 *   branded  app mark + wordmark + avatar        (dashboard)
 *   back     chevron + title + trailing meta     (detail, browser, import)
 *   plain    title + trailing meta               (session summary)
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, jp, radius, type as typeScale } from '@/theme/tokens';

export interface ScreenHeaderProps {
  title?: string;
  /** Shows the back chevron and pops the stack when tapped. */
  showBack?: boolean;
  /** Grey meta text on the right, e.g. "Level 12" or "80 items". */
  trailingText?: string;
  trailingColor?: string;
  /** Replaces `trailingText` entirely — used for the avatar and step run. */
  trailing?: React.ReactNode;
  /** Renders the app mark and wordmark instead of a plain title. */
  branded?: boolean;
  /** A coloured glyph tile before the title, e.g. 字 for a kanji lesson. */
  glyph?: string;
  glyphColor?: string;
  /** An extra row under the title, e.g. the review progress bar. */
  children?: React.ReactNode;
  onBack?: () => void;
}

export function ScreenHeader({
  title,
  showBack = false,
  trailingText,
  trailingColor = colors.inkFaint,
  trailing,
  branded = false,
  glyph,
  glyphColor = colors.kanji,
  children,
  onBack,
}: ScreenHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = React.useCallback(() => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
  }, [onBack, router]);

  return (
    <View style={[styles.header, { paddingTop: insets.top + 11 }]}>
      <View style={styles.row}>
        <View style={styles.leading}>
          {showBack ? (
            <Pressable onPress={handleBack} hitSlop={12}>
              <Text style={styles.backChevron}>‹</Text>
            </Pressable>
          ) : null}

          {branded ? (
            <View style={[styles.mark, { backgroundColor: colors.kanji }]}>
              <Text style={styles.markGlyph}>漢</Text>
            </View>
          ) : glyph ? (
            <View style={[styles.glyphTile, { backgroundColor: glyphColor }]}>
              <Text style={styles.glyphTileText}>{glyph}</Text>
            </View>
          ) : null}

          {title ? (
            <Text style={branded ? styles.wordmark : styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </View>

        {trailing ?? (trailingText ? (
          <Text style={[styles.trailingText, { color: trailingColor }]}>{trailingText}</Text>
        ) : null)}
      </View>

      {children ? <View style={styles.belowRow}>{children}</View> : null}
    </View>
  );
}

/** The circular 私 avatar on the dashboard header. */
export function ProfileAvatar({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View style={styles.avatar}>
        <Text style={styles.avatarGlyph}>私</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  belowRow: {
    marginTop: 10,
  },
  leading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  backChevron: {
    fontSize: 17,
    fontFamily: typeScale.screenTitle.fontFamily,
    color: colors.inkSoft,
    marginRight: 1,
  },
  mark: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: {
    ...jp.icon,
    fontSize: 14,
    color: colors.onSolid,
  },
  glyphTile: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphTileText: {
    ...jp.icon,
    color: colors.onSolid,
  },
  wordmark: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 15,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  title: {
    ...typeScale.screenTitle,
    color: colors.ink,
    flexShrink: 1,
  },
  trailingText: typeScale.captionBold,
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radius.round,
    backgroundColor: colors.ground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: {
    ...jp.icon,
    color: colors.inkFaint,
  },
});
