/**
 * A ScrollView that keeps whatever you are typing into above the keyboard.
 *
 * The app draws edge to edge, and on current Android an edge-to-edge window is
 * not resized for the keyboard whatever `windowSoftInputMode` says -- the
 * keyboard simply slides over the bottom of the screen, and an answer box
 * halfway down the page ends up underneath it, typing blind.
 *
 * So this does it by hand: while the keyboard is up, the content gets that
 * much extra room at the bottom (so there is somewhere to scroll to), and the
 * focused field is scrolled to sit just above the keyboard's top edge.
 */
import * as React from 'react';
import {
  Keyboard,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  TextInput,
} from 'react-native';

/** Clear space kept between the field and the top of the keyboard. */
const GAP = 24;

export function KeyboardAwareScroll({
  children,
  contentContainerStyle,
  onScroll,
  ...rest
}: ScrollViewProps) {
  const scroller = React.useRef<ScrollView>(null);
  const offset = React.useRef(0);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);

  const reveal = React.useCallback((keyboardTop: number) => {
    const input = TextInput.State.currentlyFocusedInput();
    if (!input) return;
    input.measureInWindow((_x, y, _width, height) => {
      const overlap = y + height + GAP - keyboardTop;
      if (overlap > 0) {
        scroller.current?.scrollTo({ y: offset.current + overlap, animated: true });
      }
    });
  }, []);

  React.useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => {
      setKeyboardHeight(event.endCoordinates.height);
      // A frame later, once the extra room exists to scroll into.
      requestAnimationFrame(() => reveal(event.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reveal]);

  const trackOffset = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll],
  );

  return (
    <ScrollView
      ref={scroller}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      {...rest}
      onScroll={trackOffset}
      contentContainerStyle={[
        contentContainerStyle,
        keyboardHeight > 0 && {
          paddingBottom:
            ((StyleSheet.flatten(contentContainerStyle)?.paddingBottom as number) ?? 0) +
            keyboardHeight,
        },
      ]}
    >
      {children}
    </ScrollView>
  );
}
