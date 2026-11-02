package expo.modules.gitcrushnative

import android.util.Base64
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Requête HTTP(S) utilisée par le moteur Git pour les dépôts dont l'utilisateur a choisi
 * de désactiver la vérification SSL (serveur auto-hébergé avec certificat auto-signé).
 * Le corps est échangé en base64 avec JavaScript.
 */
object Http {
  private val trustAll: Array<TrustManager> = arrayOf(
    object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>?, authType: String?) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>?, authType: String?) {}
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
  )

  private val insecureFactory: SSLSocketFactory by lazy {
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(null, trustAll, SecureRandom())
    ctx.socketFactory
  }

  fun request(
    url: String,
    method: String,
    headers: Map<String, String>,
    bodyBase64: String,
    insecure: Boolean
  ): Map<String, Any?> {
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      if (insecure && conn is HttpsURLConnection) {
        conn.sslSocketFactory = insecureFactory
        conn.hostnameVerifier = HostnameVerifier { _, _ -> true }
      }
      conn.requestMethod = method
      conn.connectTimeout = 30_000
      conn.readTimeout = 120_000
      conn.instanceFollowRedirects = true

      for ((k, v) in headers) {
        val name = k.lowercase()
        // accept-encoding : on laisse HttpURLConnection gérer gzip et décoder tout seul.
        if (name == "accept-encoding" || name == "host" || name == "content-length") continue
        conn.setRequestProperty(k, v)
      }

      if (bodyBase64.isNotEmpty()) {
        val bytes = Base64.decode(bodyBase64, Base64.DEFAULT)
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(bytes.size)
        conn.outputStream.use { it.write(bytes) }
      }

      val code = conn.responseCode
      val stream = if (code >= 400) conn.errorStream else conn.inputStream
      val data = stream?.use { it.readBytes() } ?: ByteArray(0)

      val out = LinkedHashMap<String, String>()
      for ((k, v) in conn.headerFields) {
        if (k != null) out[k.lowercase()] = v.joinToString(", ")
      }

      return mapOf(
        "status" to code,
        "statusText" to (conn.responseMessage ?: ""),
        "headers" to out,
        "body" to Base64.encodeToString(data, Base64.NO_WRAP)
      )
    } finally {
      conn.disconnect()
    }
  }
}
