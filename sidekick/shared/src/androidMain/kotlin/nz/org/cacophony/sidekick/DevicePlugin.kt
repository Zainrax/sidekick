package nz.org.cacophony.sidekick

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity.RESULT_OK
import android.app.Instrumentation
import android.content.Context
import android.net.ConnectivityManager
import android.net.ConnectivityManager.NetworkCallback
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.net.wifi.WifiManager.MulticastLock
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import nz.org.cacophony.sidekick.device.DeviceInterface
import org.json.JSONException
import java.net.InetSocketAddress
import java.net.Socket

@CapacitorPlugin(name = "Device")
class DevicePlugin : Plugin() {
    private val type = "_cacophonator-management._tcp."

    private lateinit var nsdHelper: NsdHelper
    private var callQueue: MutableMap<String, CallType> = mutableMapOf()
    private var discoveryRetryCount = 0
    private val MAX_DISCOVERY_RETRIES = 3
    private val DISCOVERY_RETRY_DELAY = 5000L // 5 seconds

    private lateinit var device: DeviceInterface
    private var wifiNetwork: Network? = null
    var currNetworkCallback: NetworkCallback? = null
    private var cm: ConnectivityManager? = null
    private lateinit var multicastLock: WifiManager.MulticastLock
    private var isDiscovering: Boolean = false

    // Add a flag to keep track of whether to use the multicast lock
    private var useMulticastLock = false
    private var multicastLockUsedInCurrentDiscovery = false

    override fun load() {
        super.load()
        device = DeviceInterface(context.applicationContext.filesDir.absolutePath)
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        multicastLock = wifi.createMulticastLock("multicastLock")
    }

    enum class CallType {
        DISCOVER,
    }

    @PluginMethod
    fun discoverDevices(call: PluginCall) {
        if (isDiscovering) {
            call.reject("Discovery already in progress")
            return
        }

        isDiscovering = true
        discoveryRetryCount = 0
        startDiscoveryWithRetry(call)
    }

    private fun startDiscoveryWithRetry(call: PluginCall) {
        try {
            // Set the flag for the current discovery
            multicastLockUsedInCurrentDiscovery = useMulticastLock

            // Acquire the multicast lock if needed
            if (useMulticastLock) {
                multicastLock.acquire()
            }

            nsdHelper = object : NsdHelper(context.applicationContext) {
                override fun onNsdServiceResolved(service: NsdServiceInfo) {
                    val serviceJson = JSObject().apply {
                        val endpoint = "${service.serviceName}.local"
                        put("endpoint", endpoint)
                        put("host", service.host.hostAddress)
                        put("port", service.port)
                    }
                    notifyListeners("onServiceResolved", serviceJson)
                    // Reset retry count on successful discovery
                    discoveryRetryCount = 0
                }

                override fun onNsdServiceLost(service: NsdServiceInfo) {
                    // Add verification before notifying service lost
                    if (verifyServiceLost(service)) {
                        val result = JSObject().apply {
                            val endpoint = "${service.serviceName}.local"
                            put("endpoint", endpoint)
                        }
                        notifyListeners("onServiceLost", result)
                    }
                }

                override fun onDiscoveryFailed(e: Exception) {
                    handleDiscoveryFailure(e, call)
                }
            }

            nsdHelper.initializeNsd()
            nsdHelper.discoverServices()

            // Flip the flag for the next discovery attempt
            useMulticastLock = !useMulticastLock

            call.resolve()
        } catch (e: Exception) {
            handleDiscoveryFailure(e, call)
        }
    }

    @PluginMethod
    fun stopDiscoverDevices(call: PluginCall) {
        val result = JSObject()
        if (!isDiscovering) {
            result.put("success", true)
            call.resolve(result)
            return
        }
        try {
            // Release the multicast lock if it was used
            if (multicastLockUsedInCurrentDiscovery && multicastLock.isHeld) {
                multicastLock.release()
            }
            nsdHelper.stopDiscovery()
            isDiscovering = false
            result.put("success", true)
            call.resolve(result)
        } catch (e: Exception) {
            result.put("success", false)
            result.put("message", e.message)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun checkDeviceConnection(call: PluginCall) {
        device.checkDeviceConnection(pluginCall(call))
    }

    @PluginMethod(returnType = PluginMethod.RETURN_PROMISE)
    fun connectToDeviceAP(call: PluginCall) {
        try {
            val ssid = "bushnet"
            val password = "feathers"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // ask for permission
                val wifiSpecifier = WifiNetworkSpecifier.Builder()
                    .setSsid(ssid)
                    .setWpa2Passphrase(password)
                    .build()
                val networkRequest = NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .setNetworkSpecifier(wifiSpecifier)
                    .build()


                cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                cm!!.bindProcessToNetwork(null)
                currNetworkCallback = object : NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        super.onAvailable(network)
                        wifiNetwork = network
                        cm!!.bindProcessToNetwork(network)
                        val result = JSObject()
                        result.put("status", "connected")
                        call.resolve(result)
                    }

                    override fun onUnavailable() {
                        super.onUnavailable()
                        val result = JSObject()
                        result.put("status", "disconnected")
                        call.resolve(result)
                        wifiNetwork = null
                        cm!!.unregisterNetworkCallback(this)
                    }

                    override fun onLost(network: Network) {
                        super.onLost(network)
                        val result = JSObject()
                        result.put("status", "disconnected")
                        call.resolve(result)
                        cm!!.bindProcessToNetwork(null)
                        wifiNetwork = null
                        cm!!.unregisterNetworkCallback(this)
                        call.resolve(result)
                    }
                }

                cm!!.requestNetwork(networkRequest, currNetworkCallback!!)
            } else {
                connectToWifiLegacy(ssid, password, {
                    val result = JSObject()
                    result.put("status", "connected")
                    call.resolve(result)
                }, {
                    val result = JSObject()
                    result.put("status", "disconnected")
                    call.resolve(result)
                })
            }
        } catch (e: Exception) {
            val result = JSObject()
            result.put("success", false)
            result.put("message", e.message)
            call.resolve(result)
        }
    }

    private fun handleDiscoveryFailure(e: Exception, call: PluginCall) {
        if (discoveryRetryCount < MAX_DISCOVERY_RETRIES) {
            discoveryRetryCount++
            Handler(Looper.getMainLooper()).postDelayed({
                startDiscoveryWithRetry(call)
            }, DISCOVERY_RETRY_DELAY)
        } else {
            // Release the multicast lock if it was used
            if (multicastLockUsedInCurrentDiscovery && multicastLock.isHeld) {
                multicastLock.release()
            }
            isDiscovering = false
            call.reject("Discovery failed after $MAX_DISCOVERY_RETRIES attempts: ${e.message}")
        }
    }

    private fun verifyServiceLost(service: NsdServiceInfo): Boolean {
        // Add additional verification before confirming service is lost
        return try {
            val socket = Socket()
            socket.connect(InetSocketAddress(service.host, service.port), 1000)
            socket.close()
            false // Service is still available
        } catch (e: Exception) {
            true // Service is truly lost
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_PROMISE)
    fun disconnectFromDeviceAP(call: PluginCall) {
        try {
            cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                cm?.bindProcessToNetwork(null)
                currNetworkCallback?.let { cm?.unregisterNetworkCallback(it) }
            }

            val result = JSObject()
            result.put("success", true)
            result.put("message", "Disconnected from device AP")
            call.resolve(result)
        } catch (e: Exception) {
            val result = JSObject()
            result.put("success", false)
            result.put("message", e.message)
            call.resolve(result)
        }
    }

    @ActivityCallback
    fun connectToWifi(call: PluginCall, result: Instrumentation.ActivityResult) {
        if (result.resultCode == RESULT_OK) {
            val res = JSObject()
            res.put("success", true)
            res.put("data", "Connected to device AP")
            call.resolve(res)
        } else {
            val res = JSObject()
            res.put("success", false)
            res.put("message", "Failed to connect to device AP")
            call.resolve(res)
        }
    }

    @Suppress("DEPRECATION")
    private fun connectToWifiLegacy(
        ssid: String,
        password: String,
        onConnect: () -> Unit,
        onFail: () -> Unit
    ) {
        val wifiManager =
            context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

        // Enable Wi-Fi if it's not enabled
        if (!wifiManager.isWifiEnabled) {
            wifiManager.isWifiEnabled = true
        }

        val wifiConfig = WifiConfiguration().apply {
            SSID = "\"" + ssid + "\""
            preSharedKey = "\"" + password + "\""
        }

        // Add the Wi-Fi configuration
        val networkId = wifiManager.addNetwork(wifiConfig)

        if (networkId != -1) {
            // Enable the network
            wifiManager.enableNetwork(networkId, true)

            // Reconnect to the network
            wifiManager.reconnect()
            onConnect()
        } else {
            onFail()
        }
    }

    @PluginMethod
    fun getDeviceInfo(call: PluginCall) {
        device.getDeviceInfo(pluginCall(call))
    }

    @PluginMethod
    fun getDeviceConfig(call: PluginCall) {
        device.getDeviceConfig(pluginCall(call))
    }

    @PluginMethod
    fun setDeviceConfig(call: PluginCall) {
        device.setDeviceConfig(pluginCall(call))
    }

    @PluginMethod
    fun setLowPowerMode(call: PluginCall) {
        device.setLowPowerMode(pluginCall(call))
    }

    @PluginMethod
    fun setDeviceLocation(call: PluginCall) {
        device.setDeviceLocation(pluginCall(call))
    }

    @PluginMethod
    fun getDeviceLocation(call: PluginCall) {
        device.getDeviceLocation(pluginCall(call))
    }

    @PluginMethod
    fun getRecordings(call: PluginCall) {
        device.getRecordings(pluginCall(call))
    }

    @PluginMethod
    fun getEventKeys(call: PluginCall) {
        device.getEventKeys(pluginCall(call))
    }

    @PluginMethod
    fun getEvents(call: PluginCall) {
        device.getEvents(pluginCall(call))
    }

    @PluginMethod
    fun deleteEvents(call: PluginCall) {
        device.deleteEvents(pluginCall(call))
    }

    @PluginMethod
    fun downloadRecording(call: PluginCall) {
        device.downloadRecording(pluginCall(call))
    }

    @PluginMethod
    fun deleteRecordings(call: PluginCall) {
        device.deleteRecordings(pluginCall(call))
    }

    @PluginMethod
    fun deleteRecording(call: PluginCall) {
        device.deleteRecording(pluginCall(call))
    }

    @PluginMethod
    fun unbindConnection(call: PluginCall) {
        call.resolve()
    }

    @PluginMethod
    fun rebindConnection(call: PluginCall) {
        call.resolve()
    }

    @PluginMethod
    fun hasConnection(call: PluginCall) {
        val result = JSObject()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val isConnected = cm?.getNetworkCapabilities(wifiNetwork)
                    ?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    ?: false

                result.put("success", true)
                result.put("connected", isConnected)
            } else {
                val wifiManager =
                    context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                val wifiInfo = wifiManager.connectionInfo
                val isConnected = wifiInfo.ssid == "\"bushnet\""

                result.put("success", true)
                result.put("connected", isConnected)
            }
        } catch (e: Exception) {
            result.put("success", false)
            result.put("message", e.message)
        }
        call.resolve(result)
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun checkIsAPConnected(call: PluginCall) {
        val result = JSObject()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val networkCapabilities = cm?.getNetworkCapabilities(wifiNetwork)
                val isConnected =
                    networkCapabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
                val ssid = if (isConnected) {
                    (context.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo.ssid
                } else {
                    ""
                }

                result.put("success", true)
                result.put("connected", isConnected && ssid == "\"bushnet\"")
            } else {
                val wifiManager =
                    context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                val wifiInfo = wifiManager.connectionInfo
                val isConnected = wifiInfo.ssid == "\"bushnet\""

                result.put("success", true)
                result.put("connected", isConnected)
            }
        } catch (e: Exception) {
            result.put("success", false)
            result.put("message", e.message)
        }
        call.resolve(result)
    }

    @PluginMethod
    fun reregisterDevice(call: PluginCall) {
        device.reregister(pluginCall(call))
    }

    @PluginMethod
    fun updateRecordingWindow(call: PluginCall) {
        device.updateRecordingWindow(pluginCall(call))
    }

    @PluginMethod
    fun updateWifi(call: PluginCall) {
        device.updateWifi(pluginCall(call))
    }

    @PluginMethod
    fun turnOnModem(call: PluginCall) {
        device.turnOnModem(pluginCall(call))
    }
}
