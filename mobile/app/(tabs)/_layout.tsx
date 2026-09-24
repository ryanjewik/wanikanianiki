/**
 * The four-tab bar: Home 家 · Study 習 · Import 写 · Items 帳.
 *
 * The designs use a Japanese glyph on a squircle tile rather than a line icon
 * — active is a solid pink tile with white glyph, inactive a grey tile with
 * grey glyph. The Asset Sheet ships proper SVG replacements for the item-type
 * glyphs (see `icons.tsx`); the nav keeps the glyph tiles.
 */
import { Tabs } from 'expo-router';
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { feedback } from '@/feedback';
import { colors, jp, type as typeScale } from '@/theme/tokens';

function TabGlyph({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <View style={[styles.tile, focused ? styles.tileActive : styles.tileInactive]}>
      <Text style={[styles.glyph, { color: focused ? colors.onSolid : colors.inkFaint }]}>
        {glyph}
      </Text>
    </View>
  );
}

/** The bar's own height and bottom padding, before the system inset. */
const BAR_HEIGHT = 64;
const BAR_PAD_BOTTOM = 5;

export default function TabsLayout() {
  // The bar runs under the system navigation (edge to edge) and pads itself
  // clear of it. React Navigation would do this on its own, but a fixed
  // `height` in the style overrides that, and the design wants a fixed height —
  // so the inset is added explicitly. On a phone with back / home / recents
  // buttons that inset is ~48dp; left out, the buttons sit on the labels.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.kanji,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: [
          styles.bar,
          { height: BAR_HEIGHT + insets.bottom, paddingBottom: BAR_PAD_BOTTOM + insets.bottom },
        ],
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
        sceneStyle: { backgroundColor: colors.ground },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="家" focused={focused} />,
        }}
        listeners={{ tabPress: () => feedback.select() }}
      />
      <Tabs.Screen
        name="study"
        options={{
          title: 'Study',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="習" focused={focused} />,
        }}
        listeners={{ tabPress: () => feedback.select() }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: 'Import',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="写" focused={focused} />,
        }}
        listeners={{ tabPress: () => feedback.select() }}
      />
      <Tabs.Screen
        name="items"
        options={{
          title: 'Items',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="帳" focused={focused} />,
        }}
        listeners={{ tabPress: () => feedback.select() }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 9,
  },
  item: {
    gap: 0,
  },
  label: {
    ...typeScale.tab,
    marginTop: 4,
  },
  tile: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileActive: {
    backgroundColor: colors.kanji,
  },
  tileInactive: {
    backgroundColor: colors.ground,
  },
  glyph: jp.icon,
});
