package expo.modules.gitcrushnative

import android.app.StatusBarManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GitCrushNativeModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not available")

  override fun definition() = ModuleDefinition {
    Name("GitCrushNative")

    // ── Service d'accessibilité (synchro à l'ouverture / fermeture d'autres applications) ──
    Function("isAccessibilityEnabled") { isAccessibilityServiceEnabled() }

    Function("openAccessibilitySettings") { openAccessibilitySettings() }

    Function("getWatchRules") { NativePrefs.rulesJson(context) }

    Function("setWatchRules") { json: String -> NativePrefs.setRulesJson(context, json) }

    AsyncFunction("getLaunchableApps") { listLaunchableApps() }

    // ── Tuile des Réglages rapides et widget ──
    AsyncFunction("requestAddTile") { promise: Promise -> requestAddTile(promise) }

    Function("requestPinWidget") { requestPinWidget() }

    // Clé des liens de synchronisation internes (audit AUDIT-003).
    Function("getSyncKey") { NativePrefs.syncKey(context) }

    Function("setWidgetStatus") { timestampMs: Double, ok: Boolean ->
      NativePrefs.setLastSync(context, timestampMs.toLong(), ok)
      SyncWidgetProvider.updateAll(context)
    }

    // ── HTTP sans vérification SSL (par dépôt) ──
    AsyncFunction("httpRequest") { url: String, method: String, headers: Map<String, String>, bodyBase64: String, insecure: Boolean ->
      Http.request(url, method, headers, bodyBase64, insecure)
    }
  }

  private fun isAccessibilityServiceEnabled(): Boolean {
    val enabled = Settings.Secure.getString(
      context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val me = ComponentName(context, WatchAccessibilityService::class.java)
    val full = me.flattenToString()
    val short = me.flattenToShortString()
    return enabled.split(':').any { it.equals(full, ignoreCase = true) || it.equals(short, ignoreCase = true) }
  }

  private fun openAccessibilitySettings() {
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  @Suppress("DEPRECATION")
  private fun listLaunchableApps(): List<Map<String, String>> {
    val ctx = context
    val pm = ctx.packageManager
    val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val infos = if (Build.VERSION.SDK_INT >= 33) {
      pm.queryIntentActivities(query, PackageManager.ResolveInfoFlags.of(0L))
    } else {
      pm.queryIntentActivities(query, 0)
    }
    return infos
      .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
      .filter { it.first != ctx.packageName }
      .distinctBy { it.first }
      .sortedBy { it.second.lowercase() }
      .map { mapOf("pkg" to it.first, "label" to it.second) }
  }

  private fun requestAddTile(promise: Promise) {
    if (Build.VERSION.SDK_INT < 33) {
      promise.resolve(-1) // à ajouter manuellement dans les Réglages rapides
      return
    }
    try {
      val ctx = context
      val manager = ctx.getSystemService(StatusBarManager::class.java)
      manager.requestAddTileService(
        ComponentName(ctx, SyncTileService::class.java),
        ctx.getString(R.string.gitcrush_tile_label),
        Icon.createWithResource(ctx, R.drawable.gitcrush_ic_sync),
        ctx.mainExecutor
      ) { code -> promise.resolve(code) }
    } catch (e: Exception) {
      promise.reject("ERR_ADD_TILE", e.message, e)
    }
  }

  private fun requestPinWidget(): Boolean {
    val ctx = context
    val manager = AppWidgetManager.getInstance(ctx)
    // requestPinAppWidget existe à partir d'Android 8 (API 26).
    return if (Build.VERSION.SDK_INT >= 26 && manager.isRequestPinAppWidgetSupported) {
      manager.requestPinAppWidget(ComponentName(ctx, SyncWidgetProvider::class.java), null, null)
    } else {
      false
    }
  }
}
