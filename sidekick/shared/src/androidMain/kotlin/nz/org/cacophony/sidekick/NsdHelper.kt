import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import java.util.Collections
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.ConcurrentHashMap
abstract class NsdHelper(private val context: Context) {
    private val nsdManager: NsdManager by lazy {
        context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val resolveListenerBusy = AtomicBoolean(false)
    private val pendingNsdServices = Collections.synchronizedList(mutableListOf<NsdServiceInfo>())
    private val resolvedNsdServices = Collections.synchronizedList(mutableListOf<NsdServiceInfo>())

    companion object {
        const val NSD_SERVICE_TYPE = "_cacophonator-management._tcp."
        private const val TAG = "NsdHelper"
    }

    fun initializeNsd() {
        initializeDiscoveryListener()
    }

    fun discoverServices() {
        nsdManager.discoverServices(NSD_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
    }

    fun stopDiscovery() {
        discoveryListener?.let {
            try {
                nsdManager.stopServiceDiscovery(it)
            } catch (e: IllegalArgumentException) {
                Log.e(TAG, "Error stopping discovery: ${e.message}")
            }
        }
    }

    private fun initializeDiscoveryListener() {
        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "Service discovery started: $regType")
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                Log.d(TAG, "Service discovery success: $service")
                if (service.serviceType == NSD_SERVICE_TYPE) {
                    if (resolveListenerBusy.compareAndSet(false, true)) {
                        resolveService(service)
                    } else {
                        pendingNsdServices.add(service)
                    }
                }
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                Log.d(TAG, "Service lost: $service")
                pendingNsdServices.removeAll { it.serviceName == service.serviceName }
                resolvedNsdServices.removeAll { it.serviceName == service.serviceName }
                onNsdServiceLost(service)
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Discovery stopped: $serviceType")
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Start Discovery failed: Error code: $errorCode")
                stopDiscovery()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Stop Discovery failed: Error code: $errorCode")
                nsdManager.stopServiceDiscovery(this)
            }
        }
    }

    private fun resolveService(service: NsdServiceInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            resolveServiceModern(service)
        } else {
            resolveServiceLegacy(service)
        }
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun resolveServiceModern(service: NsdServiceInfo) {
        nsdManager.registerServiceInfoCallback(
            service,
            context.mainExecutor,
            object : NsdManager.ServiceInfoCallback {
                override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                    Log.e(TAG, "Service info callback registration failed: Error code: $errorCode")
                    resolveNextInQueue()
                }

                override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
                    Log.d(TAG, "Service updated: $serviceInfo")
                    resolvedNsdServices.add(serviceInfo)
                    onNsdServiceResolved(serviceInfo)
                    nsdManager.unregisterServiceInfoCallback(this)
                    resolveNextInQueue()
                }

                override fun onServiceLost() {
                    Log.d(TAG, "Service lost during resolution")
                    onNsdServiceLost(service)
                    resolveNextInQueue()
                }

                override fun onServiceInfoCallbackUnregistered() {
                    Log.d(TAG, "Service info callback unregistered")
                }
            }
        )
    }

    @Suppress("DEPRECATION")
    private fun resolveServiceLegacy(service: NsdServiceInfo) {
        nsdManager.resolveService(service, object : NsdManager.ResolveListener {
            override fun onServiceResolved(resolvedService: NsdServiceInfo) {
                Log.d(TAG, "Service resolved: $resolvedService")
                resolvedNsdServices.add(resolvedService)
                onNsdServiceResolved(resolvedService)
                resolveNextInQueue()
            }

            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Resolve failed: $serviceInfo - Error code: $errorCode")
                resolveNextInQueue()
            }
        })
    }

    private fun resolveNextInQueue() {
        val nextNsdService = pendingNsdServices.firstOrNull()
        if (nextNsdService != null) {
            pendingNsdServices.remove(nextNsdService)
            resolveService(nextNsdService)
        } else {
            resolveListenerBusy.set(false)
        }
    }

    abstract fun onNsdServiceResolved(service: NsdServiceInfo)
    abstract fun onNsdServiceLost(service: NsdServiceInfo)
}