package expo.modules.keyboardlanguage

import android.os.LocaleList
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Asks the keyboard to type in a given language for one text field.
 *
 * This is `EditorInfo.hintLocales`, the only lever Android gives an app over
 * the keyboard: a hint, not a switch. Gboard and Samsung Keyboard honour it by
 * flipping to a matching layout the user already has enabled. With no
 * Japanese layout installed nothing changes, which is why the kana fields also
 * convert romaji in JavaScript rather than relying on this alone.
 */
class KeyboardLanguageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeyboardLanguage")

    AsyncFunction("setHintLocales") { viewTag: Int, languageTags: List<String> ->
      val view = appContext.findView<TextView>(viewTag) ?: return@AsyncFunction false

      val locales =
        if (languageTags.isEmpty()) null
        else LocaleList.forLanguageTags(languageTags.joinToString(","))
      if (view.imeHintLocales == locales) return@AsyncFunction true

      view.imeHintLocales = locales

      // The keyboard reads the hint when a connection opens, so a field that
      // already has focus (a review flipping from reading to meaning) has to
      // reopen its connection to pick the change up.
      if (view.isFocused) {
        view.context.getSystemService(InputMethodManager::class.java)?.restartInput(view)
      }
      true
    }.runOnQueue(Queues.MAIN)
  }
}
