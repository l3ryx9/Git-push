package expo.modules.gitcrushnative

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.InputMethodManager

/**
 * Détecte l'application au premier plan pour déclencher une synchronisation quand
 * l'utilisateur ouvre ou quitte une application choisie (règles définies dans l'app).
 *
 * Confidentialité : le service ne lit jamais le contenu de l'écran (voir
 * canRetrieveWindowContent=false) ; seul le NOM DE PAQUET de la fenêtre au premier plan
 * est comparé aux règles. Rien n'est enregistré ni envoyé.
 */
class WatchAccessibilityService : AccessibilityService() {

  private var lastPkg: String? = null
  private val cooldown = HashMap<String, Long>()
  private var ignored: Set<String> = emptySet()
  private var ignoredAt = 0L

  override fun onServiceConnected() {
    super.onServiceConnected()
    refreshIgnored()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return

    if (SystemClock.elapsedRealtime() - ignoredAt > 60_000L) refreshIgnored()
    if (pkg == packageName || pkg in ignored) return // notre propre fenêtre, clavier, barre système…
    if (pkg == lastPkg) return // simple changement de fenêtre dans la même application

    val previous = lastPkg
    lastPkg = pkg

    val rules = NativePrefs.rules(this)
    if (rules.isEmpty()) return

    val now = SystemClock.elapsedRealtime()
    val repos = LinkedHashSet<String>()
    var fired = false
    for (r in rules) {
      val kind = when {
        r.onOpen && r.pkg == pkg -> "open"
        r.onClose && previous != null && r.pkg == previous -> "close"
        else -> null
      } ?: continue
      val key = "${r.repo}|${r.pkg}|$kind"
      if (now - (cooldown[key] ?: 0L) < COOLDOWN_MS) continue
      cooldown[key] = now
      repos.add(r.repo)
      fired = true
    }
    if (!fired) return

    // Un seul lancement, même si plusieurs règles se déclenchent en même temps.
    val repoParam = if (repos.contains("")) "" else repos.joinToString(",")
    try {
      startActivity(SyncLauncher.intent(this, SyncLauncher.syncUri(this, repoParam, "watch", true)))
    } catch (e: Exception) {
      // Lancement refusé par le système : rien à faire, la prochaine règle réessaiera.
    }
  }

  override fun onInterrupt() {}

  private fun refreshIgnored() {
    val set = hashSetOf(
      packageName,
      "android",
      "com.android.systemui",
      "com.google.android.permissioncontroller",
      "com.android.permissioncontroller"
    )
    try {
      val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      for (info in imm.enabledInputMethodList) set.add(info.packageName)
    } catch (e: Exception) {
      // Liste des claviers indisponible : on garde les valeurs par défaut.
    }
    ignored = set
    ignoredAt = SystemClock.elapsedRealtime()
  }

  private companion object {
    const val COOLDOWN_MS = 30_000L
  }
}
