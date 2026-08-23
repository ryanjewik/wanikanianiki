/**
 * Root layout: load fonts, open the local database, then reveal the app.
 *
 * The splash stays up until both are ready. Fonts matter more than usual here
 * — the whole system leans on weight (400 through 900) to carry hierarchy, and
 * React Native picks a face by name rather than synthesising one, so a
 * half-loaded family looks broken rather than merely unstyled.
 */
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDatabase } from '@/data/db';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden, or the module is unavailable on web — not worth failing over.
});

export default function RootLayout() {
  /**
   * Subset copies from `assets/fonts/`, not the `@expo-google-fonts` packages.
   *
   * The full families are ~26MB across these six weights, almost all of it CJK
   * coverage the app never asks for. `scripts/subset-fonts.py` cuts the sans
   * down to UI chrome (~80KB a weight) and the serif to JIS X 0208, which still
   * covers every kanji in modern Japanese. Re-run that script after changing
   * which weights are loaded here.
   *
   * The keys are the family names `theme/tokens.ts` refers to, so they must
   * stay exactly as spelled.
   */
  const [fontsLoaded, fontError] = useFonts({
    ZenKakuGothicNew_400Regular: require('../assets/fonts/ZenKakuGothicNew_400Regular.ttf'),
    ZenKakuGothicNew_500Medium: require('../assets/fonts/ZenKakuGothicNew_500Medium.ttf'),
    ZenKakuGothicNew_700Bold: require('../assets/fonts/ZenKakuGothicNew_700Bold.ttf'),
    ZenKakuGothicNew_900Black: require('../assets/fonts/ZenKakuGothicNew_900Black.ttf'),
    ShipporiMincho_500Medium: require('../assets/fonts/ShipporiMincho_500Medium.ttf'),
    ShipporiMincho_700Bold: require('../assets/fonts/ShipporiMincho_700Bold.ttf'),
  });

  const [databaseReady, setDatabaseReady] = React.useState(false);

  React.useEffect(() => {
    // A failed migration should not wedge the app on the splash screen; the
    // screens all fall back to fixtures when the mirror is empty.
    getDatabase()
      .catch(() => undefined)
      .finally(() => setDatabaseReady(true));
  }, []);

  const ready = (fontsLoaded || Boolean(fontError)) && databaseReady;

  React.useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.ground },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="lesson" />
          <Stack.Screen name="review" />
          {/* The summary ends a session, so it should not slide back into it. */}
          <Stack.Screen name="session-summary" options={{ animation: 'fade' }} />
          <Stack.Screen name="item/[id]" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
