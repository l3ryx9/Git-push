package expo.modules.gitcrushnative

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import org.json.JSONArray
import java.util.UUID

/** Règle « synchroniser le dépôt [repo] quand l'application [pkg] s'ouvre / se ferme ». */
data class WatchRule(val pkg: String, val repo: String, val onOpen: Boolean, val onClose: Boolean)

/** Réglages partagés entre le module JS, le service d'accessibilité et le widget. */
object NativePrefs {
  private const val FILE = "gitcrush_native"
  private const val KEY_RULES = "watch_rules"
  private const val KEY_LAST_TS = "last_sync_ts"
  private const val KEY_LAST_OK = "last_sync_ok"
  private const val KEY_SYNC_KEY = "sync_intent_key"

  private fun prefs(ctx: Context): SharedPreferences =
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun rulesJson(ctx: Context): String = prefs(ctx).getString(KEY_RULES, "[]") ?: "[]"

  fun setRulesJson(ctx: Context, json: String) {
    JSONArray(json) // lève une exception si le JSON est invalide : on ne stocke rien
    prefs(ctx).edit().putString(KEY_RULES, json).apply()
  }

  fun rules(ctx: Context): List<WatchRule> {
    return try {
      val arr = JSONArray(rulesJson(ctx))
      val out = ArrayList<WatchRule>()
      for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        val pkg = o.optString("pkg")
        if (pkg.isNotEmpty()) {
          out.add(WatchRule(pkg, o.optString("repo"), o.optBoolean("onOpen"), o.optBoolean("onClose")))
        }
      }
      out
    } catch (e: Exception) {
      emptyList()
    }
  }

  fun setLastSync(ctx: Context, ts: Long, ok: Boolean) {
    prefs(ctx).edit().putLong(KEY_LAST_TS, ts).putBoolean(KEY_LAST_OK, ok).apply()
  }

  fun lastSyncTs(ctx: Context): Long = prefs(ctx).getLong(KEY_LAST_TS, 0L)

  fun lastSyncOk(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_LAST_OK, true)

  /**
   * Clé secrète propre à cette installation, ajoutée aux liens gitcrush://sync lancés par
   * la tuile, le widget et le service d'accessibilité. Un lien sans cette clé (autre
   * application, page web) demande une confirmation à l'utilisateur (audit AUDIT-003).
   */
  @Synchronized
  fun syncKey(ctx: Context): String {
    val existing = prefs(ctx).getString(KEY_SYNC_KEY, null)
    if (!existing.isNullOrEmpty()) return existing
    val created = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "")
    prefs(ctx).edit().putString(KEY_SYNC_KEY, created).commit()
    return created
  }
}

/**
 * Tous les points d'entrée natifs (tuile, widget, service d'accessibilité) lancent la
 * synchronisation en ouvrant le lien gitcrush://sync dans l'application : l'écran
 * app/sync.tsx exécute alors la synchro (avec fermeture automatique si close=1).
 */
object SyncLauncher {
  /** repo : identifiants / noms séparés par des virgules ; vide = tous les dépôts. */
  fun syncUri(ctx: Context, repo: String?, reason: String, close: Boolean): Uri {
    val b = Uri.Builder().scheme("gitcrush").authority("sync")
    if (!repo.isNullOrEmpty()) b.appendQueryParameter("repo", repo)
    b.appendQueryParameter("reason", reason)
    b.appendQueryParameter("key", NativePrefs.syncKey(ctx))
    if (close) b.appendQueryParameter("close", "1")
    return b.build()
  }

  fun intent(ctx: Context, uri: Uri): Intent =
    Intent(Intent.ACTION_VIEW, uri)
      .setPackage(ctx.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
