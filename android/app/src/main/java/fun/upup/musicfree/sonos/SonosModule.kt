package `fun`.upup.musicfree.sonos

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.*
import java.net.*
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.*

class SonosModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "SonosModule"

    private var proxyServer: ServerSocket? = null
    private var proxyExecutor: ExecutorService? = null
    private var isProxyRunning = false
    private val TAG = "SonosModule"

    // Casting Settings
    private var audioFormat: String = "original"
    private var wavStreamingMethod: String = "chunked"
    private var sampleRate: Int = 44100
    private var bufferDurationMs: Int = 1000

    // In-memory debug logs buffer
    private val nativeLogs = ConcurrentLinkedQueue<String>()

    private fun addLog(msg: String) {
        Log.i(TAG, msg)
        val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        nativeLogs.add("[$time] $msg")
        while (nativeLogs.size > 80) {
            nativeLogs.poll()
        }
    }

    @ReactMethod
    fun getNativeLogs(promise: Promise) {
        val arr = Arguments.createArray()
        for (line in nativeLogs) {
            arr.pushString(line)
        }
        promise.resolve(arr)
    }

    @ReactMethod
    fun updateSettings(settings: ReadableMap) {
        if (settings.hasKey("audioFormat")) audioFormat = settings.getString("audioFormat") ?: "original"
        if (settings.hasKey("wavStreamingMethod")) wavStreamingMethod = settings.getString("wavStreamingMethod") ?: "chunked"
        if (settings.hasKey("sampleRate")) sampleRate = settings.getInt("sampleRate")
        if (settings.hasKey("bufferDurationMs")) bufferDurationMs = settings.getInt("bufferDurationMs")
        addLog("Updated settings: format=$audioFormat, wavMethod=$wavStreamingMethod, rate=$sampleRate, buffer=${bufferDurationMs}ms")
    }

    @ReactMethod
    fun getLocalIpAddress(promise: Promise) {
        try {
            val ip = getActiveLocalIp()
            if (ip != null) {
                promise.resolve(ip)
            } else {
                promise.reject("NO_IP", "Could not determine local Wi-Fi IP address.")
            }
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun startDiscovery(timeoutMs: Double, promise: Promise) {
        val executor = Executors.newCachedThreadPool()
        executor.execute {
            val wifiManager = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val multicastLock = wifiManager?.createMulticastLock("SonosDiscovery")
            multicastLock?.setReferenceCounted(true)
            multicastLock?.acquire()

            val discoveredDevices = ConcurrentHashMap<String, WritableMap>()
            val timeout = if (timeoutMs > 0) timeoutMs.toInt() else 3500

            addLog("Starting Sonos discovery (timeout: ${timeout}ms)...")

            try {
                // 1. SSDP Multicast Search
                val ssdpThread = Thread {
                    try {
                        val ssdpGroup = InetAddress.getByName("239.255.255.250")
                        val socket = DatagramSocket()
                        socket.soTimeout = timeout

                        val searchTargets = listOf(
                            "urn:schemas-upnp-org:device:ZonePlayer:1",
                            "urn:schemas-upnp-org:service:AVTransport:1"
                        )

                        for (st in searchTargets) {
                            val query = "M-SEARCH * HTTP/1.1\r\n" +
                                    "HOST: 239.255.255.250:1900\r\n" +
                                    "MAN: \"ssdp:discover\"\r\n" +
                                    "MX: 2\r\n" +
                                    "ST: $st\r\n\r\n"
                            val data = query.toByteArray(Charsets.UTF_8)
                            val packet = DatagramPacket(data, data.size, ssdpGroup, 1900)
                            socket.send(packet)
                        }

                        val buffer = ByteArray(4096)
                        val startTime = System.currentTimeMillis()
                        while (System.currentTimeMillis() - startTime < timeout) {
                            try {
                                val recvPacket = DatagramPacket(buffer, buffer.size)
                                socket.receive(recvPacket)
                                val response = String(recvPacket.data, 0, recvPacket.length, Charsets.UTF_8)
                                val location = extractHeader(response, "LOCATION")
                                if (location != null && !discoveredDevices.containsKey(location)) {
                                    val dev = fetchAndParseDevice(location)
                                    if (dev != null) {
                                        val id = dev.getString("id") ?: location
                                        discoveredDevices[id] = dev
                                        addLog("Found Sonos via SSDP: ${dev.getString("name")} at ${dev.getString("ip")}")
                                    }
                                }
                            } catch (e: SocketTimeoutException) {
                                break
                            } catch (e: Exception) {
                                // continue
                            }
                        }
                        socket.close()
                    } catch (e: Exception) {
                        addLog("SSDP search notice: ${e.message}")
                    }
                }
                ssdpThread.start()

                // 2. Subnet port 1400 probe fallback
                val localIp = getActiveLocalIp()
                if (localIp != null && localIp.contains(".")) {
                    val prefix = localIp.substringBeforeLast(".")
                    val myLastOctet = localIp.substringAfterLast(".").toIntOrNull() ?: 0
                    val subnetExecutor = Executors.newFixedThreadPool(30)

                    for (i in 1..254) {
                        if (i == myLastOctet) continue
                        val targetIp = "$prefix.$i"
                        subnetExecutor.execute {
                            try {
                                val urlStr = "http://$targetIp:1400/xml/device_description.xml"
                                val url = URL(urlStr)
                                val conn = url.openConnection() as HttpURLConnection
                                conn.connectTimeout = 300
                                conn.readTimeout = 400
                                conn.requestMethod = "GET"
                                if (conn.responseCode == 200) {
                                    val dev = parseDeviceXml(conn.inputStream, targetIp, 1400)
                                    if (dev != null) {
                                        val id = dev.getString("id") ?: targetIp
                                        if (!discoveredDevices.containsKey(id)) {
                                            discoveredDevices[id] = dev
                                            addLog("Found Sonos via Port 1400: ${dev.getString("name")} at $targetIp")
                                        }
                                    }
                                }
                                conn.disconnect()
                            } catch (ignored: Exception) {}
                        }
                    }
                    subnetExecutor.shutdown()
                    subnetExecutor.awaitTermination(timeout.toLong(), TimeUnit.MILLISECONDS)
                }

                ssdpThread.join(1000)

                val resultList = Arguments.createArray()
                for (dev in discoveredDevices.values) {
                    resultList.pushMap(dev)
                }
                addLog("Discovery complete. Total devices: ${discoveredDevices.size}")
                promise.resolve(resultList)

            } catch (e: Exception) {
                addLog("Discovery error: ${e.message}")
                promise.reject("DISCOVERY_ERROR", e.message)
            } finally {
                try {
                    if (multicastLock?.isHeld == true) {
                        multicastLock.release()
                    }
                } catch (ignored: Exception) {}
                executor.shutdown()
            }
        }
    }

    private fun extractHeader(response: String, headerName: String): String? {
        val lines = response.split("\r\n", "\n")
        val prefix = "$headerName:"
        for (line in lines) {
            if (line.startsWith(prefix, ignoreCase = true)) {
                return line.substring(prefix.length).trim()
            }
        }
        return null
    }

    private fun fetchAndParseDevice(locationUrl: String): WritableMap? {
        return try {
            val url = URL(locationUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 1500
            conn.readTimeout = 2000
            if (conn.responseCode == 200) {
                val map = parseDeviceXml(conn.inputStream, url.host, url.port)
                conn.disconnect()
                map
            } else {
                conn.disconnect()
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun parseDeviceXml(inputStream: InputStream, host: String, port: Int): WritableMap? {
        return try {
            val factory = XmlPullParserFactory.newInstance()
            val parser = factory.newPullParser()
            parser.setInput(inputStream, "UTF-8")

            var friendlyName = ""
            var modelName = ""
            var udn = ""
            var avTransportControlUrl = "/MediaRenderer/AVTransport/Control"
            var renderingControlUrl = "/MediaRenderer/RenderingControl/Control"
            var currentServiceType = ""
            var currentTag = ""

            var eventType = parser.eventType
            while (eventType != XmlPullParser.END_DOCUMENT) {
                if (eventType == XmlPullParser.START_TAG) {
                    currentTag = parser.name
                } else if (eventType == XmlPullParser.TEXT) {
                    val text = parser.text?.trim() ?: ""
                    if (text.isNotEmpty()) {
                        when (currentTag) {
                            "friendlyName" -> if (friendlyName.isEmpty()) friendlyName = text
                            "modelName" -> if (modelName.isEmpty()) modelName = text
                            "UDN" -> if (udn.isEmpty()) udn = text
                            "serviceType" -> currentServiceType = text
                            "controlURL" -> {
                                if (currentServiceType.contains("AVTransport")) {
                                    avTransportControlUrl = text
                                } else if (currentServiceType.contains("RenderingControl")) {
                                    renderingControlUrl = text
                                }
                            }
                        }
                    }
                } else if (eventType == XmlPullParser.END_TAG) {
                    currentTag = ""
                }
                eventType = parser.next()
            }

            if (friendlyName.isNotEmpty()) {
                val map = Arguments.createMap()
                val id = udn.ifEmpty { "sonos_${host}_$port" }
                map.putString("id", id)
                map.putString("name", friendlyName)
                map.putString("model", modelName.ifEmpty { "Sonos Speaker" })
                map.putString("ip", host)
                map.putInt("port", port)
                map.putString("baseUrl", "http://$host:$port")
                map.putString("controlUrl", avTransportControlUrl)
                map.putString("renderingControlUrl", renderingControlUrl)
                map
            } else null
        } catch (e: Exception) {
            null
        }
    }

    @ReactMethod
    fun startAudioProxy(settings: ReadableMap?, promise: Promise) {
        if (settings != null) {
            updateSettings(settings)
        }

        if (isProxyRunning && proxyServer != null && !proxyServer!!.isClosed) {
            val localIp = getActiveLocalIp() ?: "127.0.0.1"
            val port = proxyServer!!.localPort
            val res = Arguments.createMap().apply {
                putInt("port", port)
                putString("ip", localIp)
                putString("baseUrl", "http://$localIp:$port")
            }
            promise.resolve(res)
            return
        }

        try {
            val server = ServerSocket(0)
            proxyServer = server
            isProxyRunning = true
            val localPort = server.localPort
            val localIp = getActiveLocalIp() ?: "127.0.0.1"

            addLog("Proxy server started on http://$localIp:$localPort")

            proxyExecutor = Executors.newCachedThreadPool()
            proxyExecutor?.execute {
                while (isProxyRunning && !server.isClosed) {
                    try {
                        val clientSocket = server.accept()
                        proxyExecutor?.execute {
                            handleProxyClient(clientSocket)
                        }
                    } catch (e: Exception) {
                        break
                    }
                }
            }

            val res = Arguments.createMap().apply {
                putInt("port", localPort)
                putString("ip", localIp)
                putString("baseUrl", "http://$localIp:$localPort")
            }
            promise.resolve(res)
        } catch (e: Exception) {
            addLog("Failed to start proxy server: ${e.message}")
            promise.reject("PROXY_ERROR", "Failed to start proxy server: ${e.message}")
        }
    }

    @ReactMethod
    fun stopAudioProxy(promise: Promise) {
        try {
            isProxyRunning = false
            proxyServer?.close()
            proxyServer = null
            proxyExecutor?.shutdownNow()
            proxyExecutor = null
            addLog("Proxy server stopped.")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PROXY_ERROR", e.message)
        }
    }

    private fun handleProxyClient(client: Socket) {
        try {
            client.soTimeout = 15000
            val input = BufferedReader(InputStreamReader(client.getInputStream()))
            val firstLine = input.readLine() ?: return
            val parts = firstLine.split(" ")
            if (parts.size < 2) {
                client.close()
                return
            }

            val method = parts[0].uppercase(Locale.getDefault())
            if (method != "GET" && method != "HEAD") {
                addLog("Proxy rejected method: $method")
                sendErrorResponse(client, 405, "Method Not Allowed")
                client.close()
                return
            }

            val requestPath = parts[1]
            var rangeHeader: String? = null
            var line: String? = input.readLine()
            while (!line.isNullOrEmpty()) {
                if (line.startsWith("Range:", ignoreCase = true)) {
                    rangeHeader = line.substring(6).trim()
                }
                line = input.readLine()
            }

            val uri = URI(requestPath)
            val query = uri.rawQuery ?: ""
            val queryParams = parseQueryParams(query)

            val rawTargetUrl = queryParams["url"]
            val rawHeaders = queryParams["headers"]

            if (rawTargetUrl == null) {
                sendErrorResponse(client, 400, "Missing url parameter")
                return
            }

            // Decode URL safely (supporting both standard URL encoding and Base64)
            val decodedUrlParam = URLDecoder.decode(rawTargetUrl, "UTF-8")
            val targetUrl = if (decodedUrlParam.startsWith("http://") || decodedUrlParam.startsWith("https://") ||
                decodedUrlParam.startsWith("file://") || decodedUrlParam.startsWith("/")) {
                decodedUrlParam
            } else {
                try {
                    String(Base64.decode(decodedUrlParam, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8)
                } catch (e: Exception) {
                    decodedUrlParam
                }
            }

            val headersMap = mutableMapOf<String, String>()
            if (!rawHeaders.isNullOrEmpty()) {
                try {
                    val decodedHeaders = URLDecoder.decode(rawHeaders, "UTF-8")
                    val jsonStr = if (decodedHeaders.startsWith("{")) {
                        decodedHeaders
                    } else {
                        String(Base64.decode(decodedHeaders, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8)
                    }
                    val json = JSONObject(jsonStr)
                    val keys = json.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        headersMap[k] = json.getString(k)
                    }
                } catch (ignored: Exception) {}
            }

            addLog("Proxy handling $method request for: ${targetUrl.take(60)}... Range: $rangeHeader")

            if (targetUrl.startsWith("file://") || targetUrl.startsWith("/")) {
                serveLocalFile(client, targetUrl, rangeHeader, method == "HEAD")
            } else {
                relayRemoteHttpStream(client, targetUrl, headersMap, rangeHeader, method == "HEAD")
            }

        } catch (e: Exception) {
            addLog("Proxy client error: ${e.message}")
        } finally {
            try { client.close() } catch (ignored: Exception) {}
        }
    }

    private fun getBufferSize(): Int {
        return when {
            bufferDurationMs >= 5000 -> 131072 // 128KB
            bufferDurationMs >= 2000 -> 65536  // 64KB
            bufferDurationMs >= 1000 -> 32768  // 32KB
            else -> 16384                      // 16KB
        }
    }

    private fun getTargetContentType(detectedType: String?): String {
        return when (audioFormat.lowercase(Locale.getDefault())) {
            "wav" -> "audio/wav"
            "mp3" -> "audio/mpeg"
            "flac" -> "audio/flac"
            else -> detectedType ?: "audio/mpeg"
        }
    }

    private fun serveLocalFile(client: Socket, filePathStr: String, rangeHeader: String?, isHeadOnly: Boolean) {
        val cleanPath = filePathStr.removePrefix("file://")
        val file = File(cleanPath)
        if (!file.exists() || !file.isFile) {
            sendErrorResponse(client, 404, "File Not Found")
            return
        }

        val fileLength = file.length()
        val out = BufferedOutputStream(client.getOutputStream())

        var start: Long = 0
        var end = fileLength - 1

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            val range = rangeHeader.substring(6).split("-")
            start = range[0].toLongOrNull() ?: 0
            if (range.size > 1 && range[1].isNotEmpty()) {
                end = range[1].toLongOrNull() ?: (fileLength - 1)
            }
        }

        val contentLength = end - start + 1
        val isPartial = rangeHeader != null
        val contentType = getTargetContentType(guessContentType(cleanPath))

        val responseHeader = StringBuilder()
        if (isPartial) {
            responseHeader.append("HTTP/1.1 206 Partial Content\r\n")
            responseHeader.append("Content-Range: bytes $start-$end/$fileLength\r\n")
        } else {
            responseHeader.append("HTTP/1.1 200 OK\r\n")
        }
        responseHeader.append("Content-Type: $contentType\r\n")
        responseHeader.append("Content-Length: $contentLength\r\n")
        responseHeader.append("Accept-Ranges: bytes\r\n")
        responseHeader.append("Connection: close\r\n\r\n")

        out.write(responseHeader.toString().toByteArray(Charsets.UTF_8))
        out.flush()

        if (isHeadOnly) {
            return
        }

        val raf = RandomAccessFile(file, "r")
        raf.seek(start)
        val bufSize = getBufferSize()
        val buffer = ByteArray(bufSize)
        var bytesRemaining = contentLength
        while (bytesRemaining > 0) {
            val toRead = minOf(buffer.size.toLong(), bytesRemaining).toInt()
            val read = raf.read(buffer, 0, toRead)
            if (read == -1) break
            out.write(buffer, 0, read)
            bytesRemaining -= read
        }
        out.flush()
        raf.close()
    }

    private fun relayRemoteHttpStream(
        client: Socket,
        targetUrl: String,
        customHeaders: Map<String, String>,
        rangeHeader: String?,
        isHeadOnly: Boolean
    ) {
        val url = URL(targetUrl)
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 15000
        conn.instanceFollowRedirects = true

        if (isHeadOnly) {
            conn.requestMethod = "HEAD"
        }

        for ((k, v) in customHeaders) {
            conn.setRequestProperty(k, v)
        }
        if (rangeHeader != null) {
            conn.setRequestProperty("Range", rangeHeader)
        }

        conn.connect()
        val responseCode = conn.responseCode
        val isError = responseCode >= 400

        val out = BufferedOutputStream(client.getOutputStream())
        val inStream = if (isError) conn.errorStream ?: conn.inputStream else conn.inputStream

        val upstreamContentType = conn.getHeaderField("Content-Type")
        val finalContentType = getTargetContentType(upstreamContentType)

        val headerBuilder = StringBuilder()
        headerBuilder.append("HTTP/1.1 $responseCode ${conn.responseMessage}\r\n")
        headerBuilder.append("Content-Type: $finalContentType\r\n")

        val passThroughHeaders = listOf("Content-Length", "Content-Range", "Accept-Ranges")
        for (h in passThroughHeaders) {
            val v = conn.getHeaderField(h)
            if (v != null) {
                headerBuilder.append("$h: $v\r\n")
            }
        }
        if (conn.getHeaderField("Accept-Ranges") == null) {
            headerBuilder.append("Accept-Ranges: bytes\r\n")
        }
        headerBuilder.append("Connection: close\r\n\r\n")
        out.write(headerBuilder.toString().toByteArray(Charsets.UTF_8))
        out.flush()

        if (isHeadOnly) {
            inStream?.close()
            conn.disconnect()
            return
        }

        val bufSize = getBufferSize()
        val buffer = ByteArray(bufSize)
        var read: Int
        if (inStream != null) {
            while (inStream.read(buffer).also { read = it } != -1) {
                out.write(buffer, 0, read)
            }
            out.flush()
            inStream.close()
        }
        conn.disconnect()
    }

    private fun guessContentType(path: String): String {
        return when {
            path.endsWith(".mp3", ignoreCase = true) -> "audio/mpeg"
            path.endsWith(".wav", ignoreCase = true) -> "audio/wav"
            path.endsWith(".flac", ignoreCase = true) -> "audio/flac"
            path.endsWith(".m4a", ignoreCase = true) || path.endsWith(".aac", ignoreCase = true) -> "audio/mp4"
            else -> "audio/mpeg"
        }
    }

    private fun sendErrorResponse(client: Socket, code: Int, message: String) {
        try {
            val out = client.getOutputStream()
            val resp = "HTTP/1.1 $code $message\r\nContent-Type: text/plain\r\nContent-Length: ${message.length}\r\n\r\n$message"
            out.write(resp.toByteArray(Charsets.UTF_8))
            out.flush()
        } catch (ignored: Exception) {}
    }

    private fun parseQueryParams(query: String): Map<String, String> {
        val map = mutableMapOf<String, String>()
        for (pair in query.split("&")) {
            val idx = pair.indexOf("=")
            if (idx > 0) {
                val key = pair.substring(0, idx)
                val value = pair.substring(idx + 1)
                map[key] = value
            }
        }
        return map
    }

    private fun getActiveLocalIp(): String? {
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
        while (interfaces.hasMoreElements()) {
            val iface = interfaces.nextElement()
            if (iface.isLoopback || !iface.isUp) continue
            val addresses = iface.inetAddresses
            while (addresses.hasMoreElements()) {
                val addr = addresses.nextElement()
                if (addr is Inet4Address && !addr.isLoopbackAddress) {
                    val ip = addr.hostAddress
                    if (ip?.startsWith("192.168.") == true || ip?.startsWith("10.") == true || ip?.startsWith("172.") == true) {
                        return ip
                    }
                }
            }
        }
        return null
    }
}
