package expo.modules.gitcrushnative

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.text.format.DateFormat
import android.widget.RemoteViews
import java.util.Date

/** Widget de l'écran d'accueil : un appui synchronise tous les dépôts. */
class SyncWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) update(context, appWidgetManager, id)
  }

  companion object {
    fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val views = RemoteViews(ctx.packageName, R.layout.gitcrush_widget)

      val ts = NativePrefs.lastSyncTs(ctx)
      val status = if (ts <= 0L) {
        ctx.getString(R.string.gitcrush_widget_never)
      } else {
        val time = DateFormat.getTimeFormat(ctx).format(Date(ts))
        val res = if (NativePrefs.lastSyncOk(ctx)) R.string.gitcrush_widget_ok else R.string.gitcrush_widget_failed
        ctx.getString(res, time)
      }
      views.setTextViewText(R.id.gitcrush_widget_status, status)

      val intent = SyncLauncher.intent(ctx, SyncLauncher.syncUri(null, "widget", true))
      val pending = PendingIntent.getActivity(
        ctx, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      views.setOnClickPendingIntent(R.id.gitcrush_widget_root, pending)

      mgr.updateAppWidget(id, views)
    }

    fun updateAll(ctx: Context) {
      val mgr = AppWidgetManager.getInstance(ctx)
      val ids = mgr.getAppWidgetIds(ComponentName(ctx, SyncWidgetProvider::class.java))
      for (id in ids) update(ctx, mgr, id)
    }
  }
}
