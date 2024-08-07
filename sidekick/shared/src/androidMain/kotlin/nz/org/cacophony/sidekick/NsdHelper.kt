import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.RequiresApi
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration.Companion.seconds

abstract class NsdHelper(private val context: Context) {
    private val nsdManager: NsdManager by lazy {
        context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val resolveListenerBusy = AtomicBoolean(false)
    private val pendingNsdServices = ConcurrentLinkedQueue<NsdServiceInfo>()
    private val resolvedNsdServices = mutableListOf<NsdServiceInfo>()
    private val handler = Handler(Looper.getMainLooper())

    companion object {
        const val NSD_SERVICE_TYPE = "_cacophonator-management._tcp."
        private const val TAG = "NsdHelper"
        private const val RESOLVE_TIMEOUT = 10000L // 10 seconds
        private const val RETRY_DELAY = 1000L // 1 second
        private const val MAX_RETRIES = 3
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
                    pendingNsdServices.offer(service)
                    if (resolveListenerBusy.compareAndSet(false, true)) {
                        resolveNextInQueue()
                    }
                }
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                Log.d(TAG, "Service lost: $service")
                pendingNsdServices.removeAll { it.serviceName == service.serviceName }
                synchronized(resolvedNsdServices) {
                    resolvedNsdServices.removeAll { it.serviceName == service.serviceName }
                }
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

    private fun resolveService(service: NsdServiceInfo, retryCount: Int = 0) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            resolveServiceModern(service, retryCount)
        } else {
            resolveServiceLegacy(service, retryCount)
        }

        // Set a timeout for resolution
        handler.postDelayed({
            if (resolveListenerBusy.get()) {
                Log.w(TAG, "Resolution timeout for service: ${service.serviceName}")
                resolveNextInQueue()
            }
        }, RESOLVE_TIMEOUT)
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun resolveServiceModern(service: NsdServiceInfo, retryCount: Int) {
        val callback = object : NsdManager.ServiceInfoCallback {
            override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                Log.e(TAG, "Service info callback registration failed: Error code: $errorCode")
                retryResolve(service, retryCount)
            }

            override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service updated: $serviceInfo")
                synchronized(resolvedNsdServices) {
                    resolvedNsdServices.add(serviceInfo)
                }
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

        nsdManager.registerServiceInfoCallback(service, context.mainExecutor, callback)
    }

    @Suppress("DEPRECATION")
    private fun resolveServiceLegacy(service: NsdServiceInfo, retryCount: Int) {
        nsdManager.resolveService(service, object : NsdManager.ResolveListener {
            override fun onServiceResolved(resolvedService: NsdServiceInfo) {
                Log.d(TAG, "Service resolved: $resolvedService")
                synchronized(resolvedNsdServices) {
                    resolvedNsdServices.add(resolvedService)
                }
                onNsdServiceResolved(resolvedService)
                resolveNextInQueue()
            }

            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Resolve failed: $serviceInfo - Error code: $errorCode")
                retryResolve(service, retryCount)
            }
        })
    }

    private fun retryResolve(service: NsdServiceInfo, retryCount: Int) {
        if (retryCount < MAX_RETRIES) {
            Log.d(TAG, "Retrying resolve for ${service.serviceName}, attempt ${retryCount + 1}")
            handler.postDelayed({
                resolveService(service, retryCount + 1)
            }, RETRY_DELAY)
        } else {
            Log.e(TAG, "Max retries reached for ${service.serviceName}")
            resolveNextInQueue()
        }
    }

    private fun resolveNextInQueue() {
        val nextNsdService = pendingNsdServices.poll()
        if (nextNsdService != null) {
            resolveService(nextNsdService)
        } else {
            resolveListenerBusy.set(false)
        }
    }

    abstract fun onNsdServiceResolved(service: NsdServiceInfo)
    abstract fun onNsdServiceLost(service: NsdServiceInfo)
}