/**
 * The white bar at the top of every screen.
 *
 * Three shapes appear in the designs and they share one component:
 *   branded  app mark + wordmark + avatar        (dashboard)
 *   back     chevron + title + trailing meta     (detail, browser, import)
 *   plain    title + trailing meta               (session summary)
 */
import { useRouter, useSegments } from 'expo-router';
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeIcon } from '@/components/icons';
import { MascotAvatar } from '@/components/Mascot';
import { feedback } from '@/feedback';
import { colors, jp, type as typeScale } from '@/theme/tokens';

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
  // Every screen outside the tabs gets a way straight home. Decided here from
  // the route rather than opted into per screen, so a new screen cannot ship
  // without one -- and a session several screens deep (lesson, practice,
  // summary) is one tap from the dashboard instead of a run of backs.
  const segments = useSegments();
  const showHome = segments[0] !== '(tabs)';

  const handleHome = React.useCallback(() => {
    feedback.back();
    // Pops back to the tabs if they are underneath, which they always are
    // after a normal launch; replaces the screen if something opened the app
    // straight onto a deep link.
    router.dismissTo('/');
  }, [router]);

  const handleBack = React.useCallback(() => {
    feedback.back();
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

          {showHome ? (
            <Pressable
              onPress={handleHome}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Home"
              style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}
            >
              <HomeIcon size={20} />
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

/** The crabigator avatar on the dashboard header — the way into My profile. */
export function ProfileAvatar({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      onPressIn={feedback.select}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="My profile"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <MascotAvatar size={32} style={styles.avatar} />
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
  homeButton: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
    marginRight: 2,
  },
  pressed: {
    opacity: 0.55,
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
    borderWidth: 1.5,
    borderColor: colors.ink,
  },


});
