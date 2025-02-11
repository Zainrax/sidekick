package nz.org.cacophony.sidekick

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A NSD manager for discovering & resolving
 * `_cacophonator-management._tcp.` services.
 * This implementation serializes resolve calls so that only one is active at a time.
 */
class NsdHelper(private val context: Context) {

    companion object {
        private const val TAG = "NsdHelper"
        private const val SERVICE_TYPE = "_cacophonator-management._tcp."
        private const val MAX_RESOLVE_RETRIES = 3
        private const val RESOLVE_RETRY_DELAY_MS = 1_000L
        private const val RESOLVE_SOCKET_CHECK_TIMEOUT_MS = 1_000
    }

    // Public callbacks for resolved, lost, and error events.
    var onServiceResolved: ((NsdServiceInfo) -> Unit)? = null
    var onServiceLost: ((NsdServiceInfo) -> Unit)? = null
    var onDiscoveryError: ((Throwable) -> Unit)? = null

    private val nsdManager by lazy {
        context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }

    // Only allow one discovery session at a time.
    private var isDiscovering = false

    // A queue of services waiting to be resolved.
    private val pendingQueue = ConcurrentLinkedQueue<NsdServiceInfo>()

    // Indicates whether a service resolution is currently in progress.
    private val isResolving = AtomicBoolean(false)

    // Reference to the active DiscoveryListener.
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    // Handler on the main looper for UI and scheduling tasks.
    private val handler = Handler(Looper.getMainLooper())

    /**
     * Starts service discovery. If a discovery session is already active, this call is ignored.
     */
    fun startDiscovery() {
        if (isDiscovering) {
            Log.w(TAG, "Discovery is already active, ignoring startDiscovery() call.")
            return
        }
        isDiscovering = true

        // Create a new DiscoveryListener for this discovery session.
        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "Service discovery started: $regType")
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                Log.d(TAG, "Service found: $service")
                // Check that the discovered service is of the expected type.
                if (service.serviceType.contains(SERVICE_TYPE)) {
                    // Add the service to the queue and try resolving it.
                    pendingQueue.offer(service)
                    tryResolveNext()
                }
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                Log.d(TAG, "Service lost: $service")
                // Remove the service from the queue (if pending) and notify listeners.
                removeFromQueue(service)
                onServiceLost?.invoke(service)
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Service discovery stopped: $serviceType")
                isDiscovering = false
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Start discovery failed: Error $errorCode, $serviceType")
                stopDiscovery() // stop discovery on failure
                onDiscoveryError?.invoke(
                    Exception("StartDiscoveryFailed code=$errorCode type=$serviceType")
                )
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Stop discovery failed: Error $errorCode, $serviceType")
                stopDiscovery()
                onDiscoveryError?.invoke(
                    Exception("StopDiscoveryFailed code=$errorCode type=$serviceType")
                )
            }
        }

        try {
            nsdManager.discoverServices(
                SERVICE_TYPE,
                NsdManager.PROTOCOL_DNS_SD,
                discoveryListener!!
            )
        } catch (e: Exception) {
            Log.e(TAG, "discoverServices exception: ${e.message}")
            isDiscovering = false
            onDiscoveryError?.invoke(e)
        }
    }

    /**
     * Stops the current discovery session if one is active.
     */
    fun stopDiscovery() {
        if (!isDiscovering) {
            Log.d(TAG, "Not currently discovering; ignoring stopDiscovery()")
            return
        }
        try {
            discoveryListener?.let {
                nsdManager.stopServiceDiscovery(it)
            }
        } catch (e: Exception) {
            Log.e(TAG, "stopDiscovery exception: ${e.message}")
        } finally {
            discoveryListener = null
            isDiscovering = false
            // Clear any queued services and reset the resolving flag.
            pendingQueue.clear()
            isResolving.set(false)
        }
    }

    /**
     * Attempts to resolve the next service in the queue if no resolution is currently active.
     */
    private fun tryResolveNext() {
        if (isResolving.compareAndSet(false, true)) {
            val service = pendingQueue.poll()
            if (service != null) {
                resolveService(service, 0)
            } else {
                // No service to resolve; release the busy flag.
                isResolving.set(false)
            }
        }
    }

    /**
     * Resolves a given service. Retries up to [MAX_RESOLVE_RETRIES] if necessary.
     *
     * @param service The service to resolve.
     * @param attempt The current attempt count.
     */
    private fun resolveService(service: NsdServiceInfo, attempt: Int) {
        if (attempt >= MAX_RESOLVE_RETRIES) {
            Log.w(TAG, "Max resolve retries reached for ${service.serviceName}")
            isResolving.set(false)
            // Move on to the next service in the queue.
            tryResolveNext()
            return
        }

        val resolveListener = object : NsdManager.ResolveListener {
            override fun onServiceResolved(resolvedService: NsdServiceInfo) {
                Log.d(TAG, "Service resolved: $resolvedService")
                // Once resolved, perform an extra check: can we connect via socket?
                checkIfStillReachable(resolvedService)
            }

            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                Log.w(
                    TAG,
                    "onResolveFailed: ${info.serviceName}, code=$errorCode, attempt=$attempt"
                )
                // Wait a moment and retry the resolution.
                handler.postDelayed({
                    resolveService(info, attempt + 1)
                }, RESOLVE_RETRY_DELAY_MS)
            }
        }

        try {
            nsdManager.resolveService(service, resolveListener)
        } catch (e: Exception) {
            Log.e(TAG, "resolveService exception: ${e.message}")
            // Wait and retry if an exception is thrown.
            handler.postDelayed({
                resolveService(service, attempt + 1)
            }, RESOLVE_RETRY_DELAY_MS)
        }
    }

    /**
     * Verifies the resolved service is reachable by attempting to open a socket.
     * If reachable, [onServiceResolved] is called; otherwise, [onServiceLost] is triggered.
     */
    private fun checkIfStillReachable(service: NsdServiceInfo) {
        Thread {
            val success = try {
                Socket().use { socket ->
                    socket.connect(
                        InetSocketAddress(service.host, service.port),
                        RESOLVE_SOCKET_CHECK_TIMEOUT_MS
                    )
                }
                true
            } catch (e: Exception) {
                false
            }

            handler.post {
                if (success) {
                    onServiceResolved?.invoke(service)
                } else {
                    Log.w(TAG, "Resolved service not reachable: ${service.serviceName}")
                    onServiceLost?.invoke(service)
                }
                // Mark resolution as complete and proceed to the next queued service.
                isResolving.set(false)
                tryResolveNext()
            }
        }.start()
    }

    /**
     * Removes the specified service from the pending resolution queue.
     */
    private fun removeFromQueue(service: NsdServiceInfo) {
        val iter = pendingQueue.iterator()
        while (iter.hasNext()) {
            val queuedService = iter.next()
            if (queuedService.serviceName == service.serviceName) {
                iter.remove()
                break
            }
        }
    }
}
