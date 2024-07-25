package nz.org.cacophony.sidekick
import NsdHelper
import android.annotation.SuppressLint
import android.app.Activity.RESULT_OK
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import nz.org.cacophony.sidekick.device.DeviceInterface

@CapacitorPlugin(name = "Device")
class DevicePlugin: Plugin() {
    private val type = "_cacophonator-management._tcp"

    private lateinit var nsdHelper: NsdHelper
    private lateinit var discoveryListener: NsdManager.DiscoveryListener
    private var callQueue: MutableMap<String, CallType> = mutableMapOf()

    private lateinit var device: DeviceInterface
    private var wifiNetwork: Network? = null;
    var currNetworkCallback: ConnectivityManager.NetworkCallback? = null
    private var cm: ConnectivityManager? = null;
    private lateinit var multicastLock:WifiManager.MulticastLock
    private var isDiscovering: Boolean = false;


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
            call.reject("Currently discovering")
            return
        }
        try {
            isDiscovering = true
            multicastLock.acquire()
            nsdHelper = object : NsdHelper(context) {
                override fun onNsdServiceResolved(service: NsdServiceInfo) {
                    val serviceJson = JSObject().apply {
                        val endpoint = "${service.serviceName}.local"
                        put("endpoint", endpoint)
                        put("host", service.host.hostAddress)
                        put("port", service.port)
                    }
                    notifyListeners("onServiceResolved", serviceJson)
                }

                override fun onNsdServiceLost(service: NsdServiceInfo) {
                    val result = JSObject().apply {
                        val endpoint = "${service.serviceName}.local"
                        put("endpoint", endpoint)
                    }
                    notifyListeners("onServiceLost", result)
                }
            }
            nsdHelper.initializeNsd()
            nsdHelper.discoverServices()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Error discovering devices: ${e.message}")
            isDiscovering = false
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
            nsdHelper.stopDiscovery()

            isDiscovering = false
            multicastLock.release()
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


    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
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
                val networkRequest =NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .setNetworkSpecifier(wifiSpecifier)
                    .build()


                cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                cm!!.bindProcessToNetwork(null)
                val callback = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        super.onAvailable(network)
                        wifiNetwork = network
                        cm!!.bindProcessToNetwork(network)
                        val result = JSObject()
                        result.put("status", "connected")
                        notifyListeners("onAccessPointChange", result)
                    }
                    override fun onUnavailable() {
                        super.onUnavailable()
                        val result = JSObject()
                        result.put("status", "disconnected")
                        notifyListeners("onAccessPointChange", result)
                        wifiNetwork = null
                        call.setKeepAlive(false)
                        cm!!.unregisterNetworkCallback(this)
                        bridge.releaseCall(call.callbackId)
                    }
                    override fun onLost(network: Network) {
                        super.onLost(network)
                        val result = JSObject()
                        result.put("status", "disconnected")
                        notifyListeners("onAccessPointChange", result)
                        cm!!.bindProcessToNetwork(null)
                        wifiNetwork = null
                        cm!!.unregisterNetworkCallback(this)
                        call.resolve(result)
                        call.setKeepAlive(false)
                        bridge.releaseCall(call.callbackId)
                    }
                }
                currNetworkCallback = callback
                cm!!.requestNetwork(networkRequest, callback)
            } else {
                connectToWifiLegacy(ssid, password, {
                    val result = JSObject()
                    result.put("status", "connected")
                    notifyListeners("onAccessPointChange", result)
                }, {
                    val result = JSObject()
                    result.put("status", "disconnected")
                    notifyListeners("onAccessPointChange", result)
                })
            }
        } catch (e: Exception) {
            val result = JSObject()
            result.put("success", false)
            result.put("message", e.message)
            call.resolve(result)
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    fun disconnectFromDeviceAP(call: PluginCall) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                cm?.bindProcessToNetwork(null)
                currNetworkCallback?.let { cm?.unregisterNetworkCallback(it) }
                val result = JSObject()
                result.put("success", true)
                result.put("data", "Disconnected from device AP")
                call.resolve(result)
            } else {
                val result = JSObject()
                result.put("success", false)
                result.put("message", "Failed to disconnect from device AP")
                call.resolve(result)
            }
        } catch (e: Exception) {
            val result = JSObject()
            result.put("success", false)
            result.put("message", e.message)
            call.resolve(result)
        }
    }

    @ActivityCallback
    fun connectToWifi(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == RESULT_OK) {
            val res= JSObject()
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
    private fun connectToWifiLegacy(ssid: String, password: String, onConnect: () -> Unit, onFail: () -> Unit) {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

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
                val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
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
                val isConnected = networkCapabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
                val ssid = if (isConnected) {
                    (context.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo.ssid
                } else {
                    ""
                }

                result.put("success", true)
                result.put("connected", isConnected && ssid == "\"bushnet\"")
            } else {
                val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
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
