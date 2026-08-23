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

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.kanji,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: styles.bar,
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
      />
      <Tabs.Screen
        name="study"
        options={{
          title: 'Study',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="習" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="import"
        options={{
          title: 'Import',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="写" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="items"
        options={{
          title: 'Items',
          tabBarIcon: ({ focused }) => <TabGlyph glyph="帳" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    height: 64,
    paddingTop: 9,
    paddingBottom: 5,
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
