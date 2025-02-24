package nz.org.cacophony.sidekick

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class NsdHelper(private val context: Context) {
    companion object {
        private const val TAG = "NsdHelper"
        private const val SERVICE_TYPE = "_cacophonator-management._tcp."
        private const val MAX_RESOLVE_RETRIES = 5
        private const val MAX_DISCOVERY_RETRIES = 3
        private const val INITIAL_RESOLVE_RETRY_DELAY_MS = 500L
        private const val MAX_RESOLVE_RETRY_DELAY_MS = 5000L
        private const val RESOLVE_SOCKET_CHECK_TIMEOUT_MS = 2000
        private const val DISCOVERY_RESTART_DELAY_MS = 5000L
        private const val DEVICE_REACHABILITY_CHECK_INTERVAL_MS = 60000L // 1 minute
    }

    // Discovery state
    enum class DiscoveryState {
        INACTIVE,
        STARTING,
        ACTIVE,
        STOPPING,
        RESTARTING,
        FAILED
    }

    // Service states to track
    private data class ServiceState(
        val serviceInfo: NsdServiceInfo,
        var resolved: Boolean = false,
        var reachable: Boolean = false,
        var resolveAttempts: Int = 0,
        var lastSeen: Long = System.currentTimeMillis()
    )

    // Event callbacks
    var onServiceResolved: ((NsdServiceInfo) -> Unit)? = null
    var onServiceLost: ((NsdServiceInfo) -> Unit)? = null
    var onServiceResolveFailed: ((serviceName: String, errorCode: Int, message: String) -> Unit)? =
        null
    var onDiscoveryError: ((Throwable, Boolean) -> Unit)? = null
    var onDiscoveryStateChanged: ((DiscoveryState) -> Unit)? = null

    // State management
    private val _discoveryState = AtomicInteger(DiscoveryState.INACTIVE.ordinal)
    val discoveryState: DiscoveryState
        get() = DiscoveryState.values()[_discoveryState.get()]

    private val nsdManager by lazy {
        context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }

    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val pendingQueue = ConcurrentLinkedQueue<NsdServiceInfo>()
    private val knownServices = ConcurrentHashMap<String, ServiceState>()
    private val isResolving = AtomicBoolean(false)
    private val discoveryRetryCount = AtomicInteger(0)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor: ScheduledExecutorService = Executors.newScheduledThreadPool(2)
    private var reachabilityChecker: ScheduledFuture<*>? = null
    private var discoveryRestartTask: ScheduledFuture<*>? = null

    /**
     * Start service discovery with automatic retry and self-healing
     */
    fun startDiscovery() {
        // Only allow starting from INACTIVE or FAILED states
        if (!_discoveryState.compareAndSet(
                DiscoveryState.INACTIVE.ordinal,
                DiscoveryState.STARTING.ordinal
            ) &&
            !_discoveryState.compareAndSet(
                DiscoveryState.FAILED.ordinal,
                DiscoveryState.STARTING.ordinal
            )
        ) {
            Log.w(TAG, "Cannot start discovery in state: ${discoveryState}")
            return
        }

        updateState(DiscoveryState.STARTING)

        // Clear any existing resources to prevent leaks
        cleanupDiscovery(false)

        // Start reachability checker for ongoing health monitoring of discovered services
        startReachabilityChecker()

        discoveryListener = createDiscoveryListener()

        try {
            nsdManager.discoverServices(
                SERVICE_TYPE,
                NsdManager.PROTOCOL_DNS_SD,
                discoveryListener!!
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start discovery: ${e.message}")
            updateState(DiscoveryState.FAILED)
            onDiscoveryError?.invoke(e, true)
            scheduleDiscoveryRestart()
        }
    }

    /**
     * Stop discovery and clean up resources
     */
    fun stopDiscovery() {
        // Only attempt to stop if we're in ACTIVE, STARTING, or RESTARTING state
        val currentState = discoveryState
        if (currentState != DiscoveryState.ACTIVE &&
            currentState != DiscoveryState.STARTING &&
            currentState != DiscoveryState.RESTARTING
        ) {
            Log.d(TAG, "Discovery not active, nothing to stop")
            return
        }

        updateState(DiscoveryState.STOPPING)

        cleanupDiscovery(true)
        stopReachabilityChecker()
        cancelDiscoveryRestart()

        // Reset state variables
        pendingQueue.clear()
        knownServices.clear()
        isResolving.set(false)
        discoveryRetryCount.set(0)

        updateState(DiscoveryState.INACTIVE)
    }

    /**
     * Create the discovery listener with comprehensive error handling
     */
    private fun createDiscoveryListener(): NsdManager.DiscoveryListener {
        return object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "Discovery started: $regType")
                updateState(DiscoveryState.ACTIVE)
                // Reset retry count on successful start
                discoveryRetryCount.set(0)
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                Log.d(TAG, "Service found: ${service.serviceName}")
                if (service.serviceType.contains(SERVICE_TYPE)) {
                    // Add to known services map
                    knownServices.putIfAbsent(service.serviceName, ServiceState(service))
                    // Queue for resolution
                    pendingQueue.offer(service)
                    tryResolveNext()
                }
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                Log.d(TAG, "Service lost: ${service.serviceName}")
                // Remove from queue and known services
                removeFromQueue(service.serviceName)
                knownServices.remove(service.serviceName)?.let {
                    onServiceLost?.invoke(service)
                }
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Discovery stopped: $serviceType")

                if (discoveryState == DiscoveryState.RESTARTING) {
                    Log.d(TAG, "Discovery stopped as part of restart")
                    // Immediately restart discovery
                    mainHandler.post { startDiscovery() }
                } else {
                    updateState(DiscoveryState.INACTIVE)
                }
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Start discovery failed: $errorCode for $serviceType")
                updateState(DiscoveryState.FAILED)

                val errorMsg = "Failed to start NSD discovery (code=$errorCode)"
                val error = Exception(errorMsg)
                onDiscoveryError?.invoke(error, discoveryRetryCount.get() >= MAX_DISCOVERY_RETRIES)

                scheduleDiscoveryRestart()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Stop discovery failed: $errorCode for $serviceType")
                // We'll still consider discovery stopped to maintain consistency
                updateState(DiscoveryState.INACTIVE)

                val error = Exception("StopDiscoveryFailed code=$errorCode")
                onDiscoveryError?.invoke(error, false)
            }
        }
    }

    /**
     * Try to resolve the next service in the queue
     * Uses a lock to ensure only one resolve happens at a time
     */
    private fun tryResolveNext() {
        if (isResolving.compareAndSet(false, true)) {
            val service = pendingQueue.poll()
            if (service != null) {
                val serviceState = knownServices[service.serviceName]
                if (serviceState != null) {
                    resolveService(service, serviceState.resolveAttempts)
                } else {
                    // Service was removed from known services, skip it
                    isResolving.set(false)
                    tryResolveNext()
                }
            } else {
                isResolving.set(false)
            }
        }
    }

    /**
     * Resolve a service with exponential backoff for retries
     */
    private fun resolveService(service: NsdServiceInfo, attempt: Int) {
        if (attempt >= MAX_RESOLVE_RETRIES) {
            Log.w(TAG, "Max resolve retries reached for ${service.serviceName}")
            knownServices[service.serviceName]?.let { state ->
                state.resolveAttempts = 0  // Reset for future attempts
                onServiceResolveFailed?.invoke(
                    service.serviceName,
                    -1,
                    "Max retry attempts ($MAX_RESOLVE_RETRIES) exceeded"
                )
            }
            isResolving.set(false)
            tryResolveNext()
            return
        }

        // Save current attempt count
        knownServices[service.serviceName]?.resolveAttempts = attempt + 1

        val resolveListener = object : NsdManager.ResolveListener {
            override fun onServiceResolved(resolvedService: NsdServiceInfo) {
                Log.d(TAG, "Service resolved: ${resolvedService.serviceName}")
                // Update the known service with resolved info
                knownServices[resolvedService.serviceName]?.let { state ->
                    state.resolved = true
                    state.lastSeen = System.currentTimeMillis()
                }

                // Verify service is actually reachable
                checkIfStillReachable(resolvedService)
            }

            override fun onResolveFailed(failedService: NsdServiceInfo, errorCode: Int) {
                Log.w(
                    TAG,
                    "Resolve failed: ${failedService.serviceName}, code=$errorCode, attempt=${attempt + 1}"
                )

                // Calculate backoff delay with exponential increase
                val delayMs = calculateBackoffDelay(attempt)

                onServiceResolveFailed?.invoke(
                    failedService.serviceName,
                    errorCode,
                    "Resolve failed (attempt ${attempt + 1}/$MAX_RESOLVE_RETRIES)"
                )

                // Schedule retry with increasing delay
                mainHandler.postDelayed({
                    resolveService(failedService, attempt + 1)
                }, delayMs)
            }
        }

        try {
            nsdManager.resolveService(service, resolveListener)
        } catch (e: Exception) {
            Log.e(TAG, "Exception resolving service: ${e.message}")
            val delayMs = calculateBackoffDelay(attempt)
            mainHandler.postDelayed({
                resolveService(service, attempt + 1)
            }, delayMs)
        }
    }

    /**
     * Calculate backoff delay with exponential increase
     */
    private fun calculateBackoffDelay(attempt: Int): Long {
        val exponentialDelay = INITIAL_RESOLVE_RETRY_DELAY_MS * (1 shl attempt)
        return minOf(exponentialDelay, MAX_RESOLVE_RETRY_DELAY_MS)
    }

    /**
     * Check if a resolved service is actually reachable
     * Uses a separate thread to avoid blocking the main thread
     */
    private fun checkIfStillReachable(service: NsdServiceInfo) {
        executor.submit {
            val reachable = try {
                Socket().use { socket ->
                    socket.connect(
                        InetSocketAddress(service.host, service.port),
                        RESOLVE_SOCKET_CHECK_TIMEOUT_MS
                    )
                }
                true
            } catch (e: Exception) {
                Log.w(TAG, "Socket connection failed for ${service.serviceName}: ${e.message}")
                false
            }

            mainHandler.post {
                knownServices[service.serviceName]?.let { state ->
                    state.reachable = reachable
                    state.lastSeen = System.currentTimeMillis()

                    if (reachable) {
                        onServiceResolved?.invoke(service)
                    } else {
                        Log.w(TAG, "Resolved service not reachable: ${service.serviceName}")
                        onServiceLost?.invoke(service)
                    }
                }

                // Allow next resolve to proceed
                isResolving.set(false)
                tryResolveNext()
            }
        }
    }

    /**
     * Remove a service from the pending queue
     */
    private fun removeFromQueue(serviceName: String) {
        val it = pendingQueue.iterator()
        while (it.hasNext()) {
            val nextService = it.next()
            if (nextService.serviceName == serviceName) {
                it.remove()
                break
            }
        }
    }

    /**
     * Start periodic reachability checker to detect stale services
     */
    private fun startReachabilityChecker() {
        stopReachabilityChecker()

        reachabilityChecker = executor.scheduleWithFixedDelay(
            {
                checkReachabilityOfKnownServices()
            },
            DEVICE_REACHABILITY_CHECK_INTERVAL_MS,
            DEVICE_REACHABILITY_CHECK_INTERVAL_MS,
            TimeUnit.MILLISECONDS
        )
    }

    /**
     * Check reachability of all known services periodically
     */
    private fun checkReachabilityOfKnownServices() {
        val currentTime = System.currentTimeMillis()
        val staleThreshold = currentTime - (2 * DEVICE_REACHABILITY_CHECK_INTERVAL_MS)

        // Copy to avoid concurrent modification
        val services = HashMap(knownServices)

        for ((serviceName, state) in services) {
            // Skip services that haven't been resolved yet
            if (!state.resolved) continue

            // Check if service hasn't been seen recently
            if (state.lastSeen < staleThreshold) {
                executor.submit {
                    val stillReachable = try {
                        Socket().use { socket ->
                            socket.connect(
                                InetSocketAddress(state.serviceInfo.host, state.serviceInfo.port),
                                RESOLVE_SOCKET_CHECK_TIMEOUT_MS
                            )
                        }
                        true
                    } catch (e: Exception) {
                        false
                    }

                    mainHandler.post {
                        if (!stillReachable) {
                            // Service is no longer reachable
                            knownServices.remove(serviceName)?.let {
                                onServiceLost?.invoke(state.serviceInfo)
                            }
                        } else {
                            // Update last seen time
                            knownServices[serviceName]?.lastSeen = currentTime
                        }
                    }
                }
            }
        }
    }

    /**
     * Stop the reachability checker
     */
    private fun stopReachabilityChecker() {
        reachabilityChecker?.cancel(false)
        reachabilityChecker = null
    }

    /**
     * Schedule discovery restart with exponential backoff
     */
    private fun scheduleDiscoveryRestart() {
        cancelDiscoveryRestart()

        val currentRetries = discoveryRetryCount.incrementAndGet()
        if (currentRetries > MAX_DISCOVERY_RETRIES) {
            Log.e(TAG, "Exceeded maximum discovery restart attempts ($MAX_DISCOVERY_RETRIES)")
            return
        }

        // Calculate backoff delay - simple exponential backoff
        val delayMs = DISCOVERY_RESTART_DELAY_MS * (1 shl (currentRetries - 1))

        Log.d(TAG, "Scheduling discovery restart in ${delayMs}ms (attempt $currentRetries)")

        updateState(DiscoveryState.RESTARTING)

        discoveryRestartTask = executor.schedule({
            mainHandler.post {
                if (discoveryState == DiscoveryState.RESTARTING || discoveryState == DiscoveryState.FAILED) {
                    Log.d(TAG, "Executing scheduled discovery restart")
                    startDiscovery()
                }
            }
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    /**
     * Cancel any pending discovery restart
     */
    private fun cancelDiscoveryRestart() {
        discoveryRestartTask?.cancel(false)
        discoveryRestartTask = null
    }

    /**
     * Clean up discovery listener and related resources
     */
    private fun cleanupDiscovery(notifyManager: Boolean) {
        val listener = discoveryListener
        if (listener != null && notifyManager) {
            try {
                nsdManager.stopServiceDiscovery(listener)
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping service discovery: ${e.message}")
            }
        }
        discoveryListener = null
    }

    /**
     * Update discovery state and notify listeners
     */
    private fun updateState(newState: DiscoveryState) {
        val oldState = DiscoveryState.values()[_discoveryState.getAndSet(newState.ordinal)]
        if (oldState != newState) {
            Log.d(TAG, "Discovery state changed: $oldState -> $newState")
            mainHandler.post {
                onDiscoveryStateChanged?.invoke(newState)
            }
        }
    }

    /**
     * Clean up all resources
     * Should be called in onDestroy to prevent leaks
     */
    fun cleanup() {
        stopDiscovery()
        executor.shutdownNow()
    }
}