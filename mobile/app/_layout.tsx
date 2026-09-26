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
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/Dialog';
import { isBackendConfigured } from '@/data/api';
import { getDatabase } from '@/data/db';
import { syncNow } from '@/data/sync';
import { initFeedback } from '@/feedback';
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
      // Sound and haptic preferences live in the same database, and the audio
      // players are built here so the first cue of the first session does not
      // pay for loading them. Deliberately after the catch and not awaited into
      // the gate below: feedback is a nicety, and the app should open without
      // it rather than wait on it.
      .finally(() => {
        void initFeedback();
        setDatabaseReady(true);
      });
  }, []);

  const ready = (fontsLoaded || Boolean(fontError)) && databaseReady;

  // Drain the outbox and refresh the mirror on launch and whenever the app
  // comes back to the front. Without it, answers left queued -- the phone was
  // offline, or the server was briefly unreachable -- waited until the next
  // answer or a pull-to-refresh, and the server went on counting those cards
  // as due.
  React.useEffect(() => {
    if (!databaseReady || !isBackendConfigured) return;
    // Full pulls: a copy kept only by diffs never recovers from a change it
    // missed -- lessons done on the website, reviews done elsewhere.
    void syncNow({ full: true }).catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow({ full: true }).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [databaseReady]);

  React.useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <RootStack />
        <DialogHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The stack, kept below the system navigation bar.
 *
 * The app draws edge to edge, so on a phone with Android's back / home /
 * recents buttons every full-screen page would otherwise run underneath them —
 * a review's "Wrap up", the last row of a summary. Padding here, once, covers
 * every stacked screen, and the ground colour fills the strip so it reads as
 * the page ending rather than a gap. Gesture navigation has a small inset and
 * gets a small strip.
 *
 * The tab group opts out: its bar extends under the buttons and pads itself
 * (`(tabs)/_layout.tsx`), which is how a bottom bar is meant to meet them.
 *
 * A component of its own because the insets are only readable inside
 * `SafeAreaProvider`.
 */
function RootStack() {
  const insets = useSafeAreaInsets();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.ground, paddingBottom: insets.bottom },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: colors.ground } }} />
      <Stack.Screen name="lesson" />
      <Stack.Screen name="review" />
      <Stack.Screen name="quiz" />
      <Stack.Screen name="lesson-bundle" />
      {/* The summary ends a session, so it should not slide back into it. */}
      <Stack.Screen name="session-summary" options={{ animation: 'fade' }} />
      <Stack.Screen name="item/[id]" />
      <Stack.Screen name="sets/index" />
      <Stack.Screen name="sets/[id]" />
      <Stack.Screen name="grammar/index" />
      <Stack.Screen name="grammar/[id]" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}
