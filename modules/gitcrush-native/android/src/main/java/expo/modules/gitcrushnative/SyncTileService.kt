package expo.modules.gitcrushnative

import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Tuile des Réglages rapides : un appui synchronise tous les dépôts. */
class SyncTileService : TileService() {

  override fun onStartListening() {
    val tile = qsTile ?: return
    tile.state = Tile.STATE_INACTIVE
    tile.label = getString(R.string.gitcrush_tile_label)
    tile.updateTile()
  }

  override fun onClick() {
    if (isLocked) {
      unlockAndRun { startSync() }
    } else {
      startSync()
    }
  }

  private fun startSync() {
    val intent = SyncLauncher.intent(this, SyncLauncher.syncUri(this, null, "tile", true))
    if (Build.VERSION.SDK_INT >= 34) {
      // Android 14+ : startActivityAndCollapse(Intent) n'est plus autorisé.
      val pending = PendingIntent.getActivity(
        this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
