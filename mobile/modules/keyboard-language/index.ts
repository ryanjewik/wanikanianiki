import { requireOptionalNativeModule } from 'expo';

type KeyboardLanguageModule = {
  setHintLocales(viewTag: number, languageTags: string[]): Promise<boolean>;
};

/**
 * Null on iOS, on web, and in an Android build made before this module was
 * added — a missing keyboard hint is a non-event, so callers skip it rather
 * than fail.
 */
export default requireOptionalNativeModule<KeyboardLanguageModule>('KeyboardLanguage');
