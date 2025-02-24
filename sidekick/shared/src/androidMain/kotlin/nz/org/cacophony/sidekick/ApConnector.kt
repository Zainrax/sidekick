package nz.org.cacophony.sidekick

import android.annotation.SuppressLint
import android.content.Context
import android.net.*
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.RequiresApi
import kotlinx.coroutines.*
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class ApConnector(private val context: Context) {
    companion object {
        private const val TAG = "RobustApConnector"
        private const val DEVICE_AP_SSID = "bushnet"
        private const val DEVICE_AP_PASSWORD = "feathers"

        // Timeout constants
        private const val CONNECTION_TIMEOUT_MS = 45000L  // 45 seconds
        private const val CONNECTION_CHECK_INTERVAL_MS = 5000L  // 5 seconds
        private const val DISCONNECT_TIMEOUT_MS = 15000L  // 15 seconds
        private const val REACHABILITY_TIMEOUT_MS = 3000  // 3 seconds
        private const val MAX_REACHABILITY_ATTEMPTS = 3

        // Ping IP for connectivity verification (device gateway)
        private const val VERIFICATION_HOST = "192.168.4.1"
        private const val VERIFICATION_PORT = 80
    }

    // Connection states
    enum class ConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTION_VERIFYING,
        CONNECTED,
        DISCONNECTING,
        CONNECTION_FAILED,
        CONNECTION_LOST
    }

    // Event callbacks
    interface ConnectionCallbacks {
        fun onStateChanged(newState: ConnectionState)
        fun onConnected()
        fun onDisconnected()
        fun onConnectionFailed(reason: String, canRetry: Boolean)
        fun onConnectionLost()
    }

    private val callbacks = CopyOnWriteArrayList<ConnectionCallbacks>()

    // State management
    private val _connectionState = AtomicInteger(ConnectionState.DISCONNECTED.ordinal)
    val connectionState: ConnectionState
        get() = ConnectionState.values()[_connectionState.get()]

    // Connection management
    private val cm: ConnectivityManager by lazy {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    private val wifiManager: WifiManager by lazy {
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    }

    private val currentCallback = AtomicReference<ConnectivityManager.NetworkCallback?>(null)
    private val currentNetworkRequest = AtomicReference<NetworkRequest?>(null)
    private val currentNetwork = AtomicReference<Network?>(null)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val connectionTimeoutJob = AtomicReference<Job?>(null)
    private val disconnectionTimeoutJob = AtomicReference<Job?>(null)
    private val verificationJob = AtomicReference<Job?>(null)
    private val monitoringJob = AtomicReference<Job?>(null)

    private val isConnecting = AtomicBoolean(false)
    private val isDisconnecting = AtomicBoolean(false)

    private val coroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val scheduler: ScheduledExecutorService = Executors.newScheduledThreadPool(1)

    // Add callback listener
    fun addConnectionCallback(callback: ConnectionCallbacks) {
        callbacks.add(callback)
    }

    // Remove callback listener
    fun removeConnectionCallback(callback: ConnectionCallbacks) {
        callbacks.remove(callback)
    }

    /**
     * Connect to the device AP with verification and timeout
     */
    fun connect(): Boolean {
        // Ensure we're in a valid state to start connection
        val currentState = connectionState
        if (currentState != ConnectionState.DISCONNECTED &&
            currentState != ConnectionState.CONNECTION_FAILED &&
            currentState != ConnectionState.CONNECTION_LOST
        ) {
            Log.w(TAG, "Cannot connect in state: $currentState")
            return false
        }

        // Prevent concurrent connection attempts
        if (!isConnecting.compareAndSet(false, true)) {
            Log.w(TAG, "Connection already in progress")
            return false
        }

        updateState(ConnectionState.CONNECTING)

        // Cancel any active timeouts
        connectionTimeoutJob.getAndSet(null)?.cancel()
        disconnectionTimeoutJob.getAndSet(null)?.cancel()
        verificationJob.getAndSet(null)?.cancel()

        // Start connection timeout
        connectionTimeoutJob.set(coroutineScope.launch {
            delay(CONNECTION_TIMEOUT_MS)
            if (connectionState == ConnectionState.CONNECTING ||
                connectionState == ConnectionState.CONNECTION_VERIFYING
            ) {
                Log.e(TAG, "Connection attempt timed out after ${CONNECTION_TIMEOUT_MS}ms")
                cleanupConnection()
                updateState(ConnectionState.CONNECTION_FAILED)
                notifyConnectionFailed("Connection timed out", true)
                isConnecting.set(false)
            }
        })

        // Start connection process appropriate for Android version
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            connectModern()
        } else {
            connectLegacy()
        }
    }

    /**
     * Modern connection approach for Android 10+
     */
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun connectModern(): Boolean {
        try {
            // First clean up any existing connections
            cleanupConnection()

            // Create network specifier for the AP
            val wifiSpecifier = WifiNetworkSpecifier.Builder()
                .setSsid(DEVICE_AP_SSID)
                .setWpa2Passphrase(DEVICE_AP_PASSWORD)
                .build()

            // Create network request
            val networkRequest = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .setNetworkSpecifier(wifiSpecifier)
                .build()

            // Store the request for later cleanup
            currentNetworkRequest.set(networkRequest)

            // Create callback to handle connection events
            val networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    super.onAvailable(network)
                    Log.d(TAG, "Network available: $network")

                    // Store network and bind process
                    currentNetwork.set(network)
                    bindToNetwork(network)

                    // Start verification to ensure connection is valid
                    verifyConnection(network)
                }

                override fun onUnavailable() {
                    super.onUnavailable()
                    Log.e(TAG, "Network unavailable")

                    connectionTimeoutJob.getAndSet(null)?.cancel()
                    cleanupConnection()
                    updateState(ConnectionState.CONNECTION_FAILED)
                    notifyConnectionFailed("Network unavailable", true)
                    isConnecting.set(false)
                }

                override fun onLost(network: Network) {
                    super.onLost(network)
                    Log.d(TAG, "Network lost: $network")

                    // Only handle if this is our current network
                    if (network == currentNetwork.get()) {
                        // Cancel verification if in progress
                        verificationJob.getAndSet(null)?.cancel()
                        connectionTimeoutJob.getAndSet(null)?.cancel()

                        if (connectionState == ConnectionState.CONNECTED) {
                            handleConnectionLost()
                        } else if (connectionState == ConnectionState.CONNECTING ||
                            connectionState == ConnectionState.CONNECTION_VERIFYING
                        ) {
                            cleanupConnection()
                            updateState(ConnectionState.CONNECTION_FAILED)
                            notifyConnectionFailed("Connection lost during setup", true)
                            isConnecting.set(false)
                        }
                    }
                }

                override fun onCapabilitiesChanged(
                    network: Network,
                    capabilities: NetworkCapabilities
                ) {
                    super.onCapabilitiesChanged(network, capabilities)
                    // Verify network still has internet capability
                    if (network == currentNetwork.get() &&
                        connectionState == ConnectionState.CONNECTED &&
                        !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    ) {
                        Log.w(TAG, "Network lost WiFi transport")
                        handleConnectionLost()
                    }
                }
            }

            // Store callback for later cleanup
            currentCallback.set(networkCallback)

            // Request network connection
            cm.requestNetwork(networkRequest, networkCallback)

            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error connecting to AP: ${e.message}")
            cleanupConnection()
            connectionTimeoutJob.getAndSet(null)?.cancel()
            updateState(ConnectionState.CONNECTION_FAILED)
            notifyConnectionFailed("Error: ${e.message}", false)
            isConnecting.set(false)
            return false
        }
    }

    /**
     * Legacy connection approach for devices < Android 10
     */
    @Suppress("DEPRECATION")
    private fun connectLegacy(): Boolean {
        try {
            if (!wifiManager.isWifiEnabled) {
                wifiManager.isWifiEnabled = true
                // Give time for WiFi to enable
                Thread.sleep(1000)
            }

            // Create WiFi configuration
            val wifiConfig = android.net.wifi.WifiConfiguration().apply {
                SSID = "\"$DEVICE_AP_SSID\""
                preSharedKey = "\"$DEVICE_AP_PASSWORD\""

                // Set highest priority
                priority = Int.MAX_VALUE
            }

            // Add network and connect
            val networkId = wifiManager.addNetwork(wifiConfig)
            if (networkId == -1) {
                Log.e(TAG, "Failed to add network configuration")
                updateState(ConnectionState.CONNECTION_FAILED)
                notifyConnectionFailed("Failed to add network", true)
                isConnecting.set(false)
                return false
            }

            // Enable network and reconnect
            val success = wifiManager.enableNetwork(networkId, true) && wifiManager.reconnect()

            if (success) {
                // Start verification after a short delay to allow connection to establish
                verificationJob.set(coroutineScope.launch {
                    delay(5000) // Wait 5 seconds for connection to establish
                    updateState(ConnectionState.CONNECTION_VERIFYING)
                    verifyLegacyConnection()
                })
                return true
            } else {
                Log.e(TAG, "Failed to enable network or reconnect")
                updateState(ConnectionState.CONNECTION_FAILED)
                notifyConnectionFailed("Failed to enable network", true)
                isConnecting.set(false)
                return false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in legacy connection: ${e.message}")
            connectionTimeoutJob.getAndSet(null)?.cancel()
            updateState(ConnectionState.CONNECTION_FAILED)
            notifyConnectionFailed("Error: ${e.message}", false)
            isConnecting.set(false)
            return false
        }
    }

    /**
     * Verify connection to ensure we're actually connected to the correct AP
     */
    private fun verifyConnection(network: Network) {
        updateState(ConnectionState.CONNECTION_VERIFYING)

        verificationJob.set(coroutineScope.launch {
            var success = false

            // Multiple attempts for reliability
            for (attempt in 1..MAX_REACHABILITY_ATTEMPTS) {
                try {
                    // Try to reach the expected gateway IP
                    val socket = network.socketFactory.createSocket()
                    socket.connect(
                        java.net.InetSocketAddress(VERIFICATION_HOST, VERIFICATION_PORT),
                        REACHABILITY_TIMEOUT_MS
                    )
                    socket.close()

                    // Success - additional validation
                    val info = wifiManager.connectionInfo

                    if (info?.ssid?.contains(DEVICE_AP_SSID, ignoreCase = true) == true) {
                        success = true
                        break
                    } else {
                        Log.w(TAG, "Connected to incorrect SSID: ${info?.ssid}")
                        delay(1000)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Verification attempt $attempt failed: ${e.message}")
                    delay(1000)
                }
            }

            if (success) {
                // Connection verified successfully
                connectionTimeoutJob.getAndSet(null)?.cancel()
                updateState(ConnectionState.CONNECTED)
                notifyConnected()

                // Start connection monitoring
                startConnectionMonitoring()
            } else {
                // Verification failed
                Log.e(
                    TAG,
                    "Connection verification failed after $MAX_REACHABILITY_ATTEMPTS attempts"
                )
                cleanupConnection()
                updateState(ConnectionState.CONNECTION_FAILED)
                notifyConnectionFailed("Connection verification failed", true)
            }

            isConnecting.set(false)
        })
    }

    /**
     * Verify legacy connection
     */
    @Suppress("DEPRECATION")
    private fun verifyLegacyConnection() = coroutineScope.launch {
        var success = false

        // Multiple attempts for reliability
        for (attempt in 1..MAX_REACHABILITY_ATTEMPTS) {
            try {
                // First check SSID
                val info = wifiManager.connectionInfo
                if (info?.ssid?.contains(DEVICE_AP_SSID, ignoreCase = true) != true) {
                    Log.w(TAG, "Connected to incorrect SSID: ${info?.ssid}")
                    delay(1000)
                    continue
                }

                // Try to reach the expected gateway IP
                val socket = Socket()
                socket.connect(
                    java.net.InetSocketAddress(VERIFICATION_HOST, VERIFICATION_PORT),
                    REACHABILITY_TIMEOUT_MS
                )
                socket.close()

                success = true
                break
            } catch (e: Exception) {
                Log.w(TAG, "Legacy verification attempt $attempt failed: ${e.message}")
                delay(1000)
            }
        }

        if (success) {
            // Connection verified successfully
            connectionTimeoutJob.getAndSet(null)?.cancel()
            updateState(ConnectionState.CONNECTED)
            notifyConnected()

            // Start connection monitoring
            startConnectionMonitoring()
        } else {
            // Verification failed
            Log.e(
                TAG,
                "Legacy connection verification failed after $MAX_REACHABILITY_ATTEMPTS attempts"
            )
            disconnectLegacy()
            updateState(ConnectionState.CONNECTION_FAILED)
            notifyConnectionFailed("Connection verification failed", true)
        }

        isConnecting.set(false)
    }

    /**
     * Start monitoring connection health
     */
    private fun startConnectionMonitoring() {
        // Stop any existing monitoring
        monitoringJob.getAndSet(null)?.cancel()

        // Start periodic connection checks
        monitoringJob.set(coroutineScope.launch {
            while (isActive && connectionState == ConnectionState.CONNECTED) {
                checkConnectionHealth()
                delay(CONNECTION_CHECK_INTERVAL_MS)
            }
        })
    }

    /**
     * Check if connection is still healthy
     */
    private fun checkConnectionHealth() = coroutineScope.launch {
        try {
            val success = withContext(Dispatchers.IO) {
                try {
                    // For modern API, check if Network object is valid
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val network = currentNetwork.get() ?: return@withContext false

                        // Check if we can reach verification host
                        val socket = network.socketFactory.createSocket()
                        socket.connect(
                            java.net.InetSocketAddress(
                                VERIFICATION_HOST,
                                VERIFICATION_PORT
                            ), REACHABILITY_TIMEOUT_MS
                        )
                        socket.close()

                        // Also verify we're still on the right SSID
                        val info = wifiManager.connectionInfo
                        if (info?.ssid?.contains(DEVICE_AP_SSID, ignoreCase = true) != true) {
                            return@withContext false
                        }
                    } else {
                        // For legacy, check SSID and connectivity
                        val info = wifiManager.connectionInfo
                        if (info?.ssid?.contains(DEVICE_AP_SSID, ignoreCase = true) != true) {
                            return@withContext false
                        }

                        // Try to reach verification host
                        val socket = Socket()
                        socket.connect(
                            java.net.InetSocketAddress(
                                VERIFICATION_HOST,
                                VERIFICATION_PORT
                            ), REACHABILITY_TIMEOUT_MS
                        )
                        socket.close()
                    }

                    return@withContext true
                } catch (e: Exception) {
                    Log.w(TAG, "Connection health check failed: ${e.message}")
                    return@withContext false
                }
            }

            if (!success && connectionState == ConnectionState.CONNECTED) {
                Log.w(TAG, "Connection appears to be lost")
                handleConnectionLost()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in connection health check: ${e.message}")
        }
    }

    /**
     * Handle lost connection scenario
     */
    private fun handleConnectionLost() {
        if (connectionState == ConnectionState.CONNECTED) {
            monitoringJob.getAndSet(null)?.cancel()
            cleanupConnection()
            updateState(ConnectionState.CONNECTION_LOST)
            notifyConnectionLost()
        }
    }

    /**
     * Disconnect from device AP
     */
    fun disconnect(): Boolean {
        // Ensure we're in a connected state
        if (connectionState != ConnectionState.CONNECTED &&
            connectionState != ConnectionState.CONNECTION_LOST
        ) {
            Log.w(TAG, "Cannot disconnect in state: $connectionState")
            return false
        }

        // Prevent concurrent disconnect operations
        if (!isDisconnecting.compareAndSet(false, true)) {
            Log.w(TAG, "Disconnect already in progress")
            return false
        }

        updateState(ConnectionState.DISCONNECTING)

        // Cancel any active jobs
        connectionTimeoutJob.getAndSet(null)?.cancel()
        monitoringJob.getAndSet(null)?.cancel()
        verificationJob.getAndSet(null)?.cancel()

        // Start disconnect timeout
        disconnectionTimeoutJob.set(coroutineScope.launch {
            delay(DISCONNECT_TIMEOUT_MS)
            if (connectionState == ConnectionState.DISCONNECTING) {
                Log.e(TAG, "Disconnect timed out")
                // Force disconnect state even if operation didn't complete properly
                updateState(ConnectionState.DISCONNECTED)
                notifyDisconnected()
                isDisconnecting.set(false)
            }
        })

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            disconnectModern()
        } else {
            disconnectLegacy()
        }
    }

    /**
     * Modern disconnect for Android 10+
     */
    private fun disconnectModern(): Boolean {
        try {
            val callback = currentCallback.getAndSet(null)
            if (callback != null) {
                try {
                    cm.unregisterNetworkCallback(callback)
                } catch (e: Exception) {
                    Log.e(TAG, "Error unregistering network callback: ${e.message}")
                }
            }

            // Unbind process from network
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                cm.bindProcessToNetwork(null)
            }

            // Reset references
            currentNetworkRequest.set(null)
            currentNetwork.set(null)

            // Complete disconnect
            disconnectionTimeoutJob.getAndSet(null)?.cancel()
            updateState(ConnectionState.DISCONNECTED)
            notifyDisconnected()
            isDisconnecting.set(false)

            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error disconnecting: ${e.message}")

            // Force disconnect state
            updateState(ConnectionState.DISCONNECTED)
            notifyDisconnected()
            isDisconnecting.set(false)

            return false
        }
    }

    /**
     * Legacy disconnect for < Android 10
     */
    @Suppress("DEPRECATION")
    private fun disconnectLegacy(): Boolean {
        try {
            val wifiInfo = wifiManager.connectionInfo
            if (wifiInfo != null && wifiInfo.networkId != -1) {
                wifiManager.disableNetwork(wifiInfo.networkId)
                wifiManager.disconnect()
            }

            // Complete disconnect
            disconnectionTimeoutJob.getAndSet(null)?.cancel()
            updateState(ConnectionState.DISCONNECTED)
            notifyDisconnected()
            isDisconnecting.set(false)

            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error in legacy disconnect: ${e.message}")

            // Force disconnect state
            updateState(ConnectionState.DISCONNECTED)
            notifyDisconnected()
            isDisconnecting.set(false)

            return false
        }
    }

    /**
     * Check if currently connected to device AP
     */
    @SuppressLint("MissingPermission")
    fun isConnected(): Boolean {
        // First check connection state
        if (connectionState != ConnectionState.CONNECTED) {
            return false
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val network = currentNetwork.get() ?: return false

                // Check if network is still valid
                val capabilities = cm.getNetworkCapabilities(network)
                if (capabilities == null || !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    return false
                }

                // Check SSID to confirm we're connected to the right network
                val info = wifiManager.connectionInfo
                return info?.ssid?.contains(DEVICE_AP_SSID, ignoreCase = true) == true

            } else {
                // For legacy, just check SSID
                val info = wifiManager.connectionInfo
                return info?.ssid?.contains(DEVICE_AP_SSID, ignoreCase = true) == true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error checking connection status: ${e.message}")
            return false
        }
    }

    /**
     * Bind process to network
     */
    private fun bindToNetwork(network: Network) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Bind process to use this network for all connections
            val success = cm.bindProcessToNetwork(network)
            if (success) {
                Log.d(TAG, "Successfully bound process to network")
            } else {
                Log.w(TAG, "Failed to bind process to network")
            }
        }
    }

    /**
     * Clean up connection resources
     */
    private fun cleanupConnection() {
        try {
            // Cancel any active jobs
            monitoringJob.getAndSet(null)?.cancel()

            // Unregister callback if exists
            val callback = currentCallback.getAndSet(null)
            if (callback != null) {
                try {
                    cm.unregisterNetworkCallback(callback)
                } catch (e: Exception) {
                    Log.e(TAG, "Error unregistering network callback: ${e.message}")
                }
            }

            // Unbind process
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                cm.bindProcessToNetwork(null)
            }

            // Reset references
            currentNetworkRequest.set(null)
            currentNetwork.set(null)

        } catch (e: Exception) {
            Log.e(TAG, "Error cleaning up connection: ${e.message}")
        }
    }

    /**
     * Update connection state and notify listeners
     */
    private fun updateState(newState: ConnectionState) {
        val oldState = ConnectionState.values()[_connectionState.getAndSet(newState.ordinal)]
        if (oldState != newState) {
            Log.d(TAG, "Connection state changed: $oldState -> $newState")
            mainHandler.post {
                for (callback in callbacks) {
                    try {
                        callback.onStateChanged(newState)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error in callback: ${e.message}")
                    }
                }
            }
        }
    }

    /**
     * Notify connected callbacks
     */
    private fun notifyConnected() {
        mainHandler.post {
            for (callback in callbacks) {
                try {
                    callback.onConnected()
                } catch (e: Exception) {
                    Log.e(TAG, "Error in onConnected callback: ${e.message}")
                }
            }
        }
    }

    /**
     * Notify disconnected callbacks
     */
    private fun notifyDisconnected() {
        mainHandler.post {
            for (callback in callbacks) {
                try {
                    callback.onDisconnected()
                } catch (e: Exception) {
                    Log.e(TAG, "Error in onDisconnected callback: ${e.message}")
                }
            }
        }
    }

    /**
     * Notify connection failed callbacks
     */
    private fun notifyConnectionFailed(reason: String, canRetry: Boolean) {
        mainHandler.post {
            for (callback in callbacks) {
                try {
                    callback.onConnectionFailed(reason, canRetry)
                } catch (e: Exception) {
                    Log.e(TAG, "Error in onConnectionFailed callback: ${e.message}")
                }
            }
        }
    }

    /**
     * Notify connection lost callbacks
     */
    private fun notifyConnectionLost() {
        mainHandler.post {
            for (callback in callbacks) {
                try {
                    callback.onConnectionLost()
                } catch (e: Exception) {
                    Log.e(TAG, "Error in onConnectionLost callback: ${e.message}")
                }
            }
        }
    }

    /**
     * Release all resources
     * Should be called when component is destroyed
     */
    fun cleanup() {
        connectionTimeoutJob.getAndSet(null)?.cancel()
        disconnectionTimeoutJob.getAndSet(null)?.cancel()
        verificationJob.getAndSet(null)?.cancel()
        monitoringJob.getAndSet(null)?.cancel()

        cleanupConnection()
        callbacks.clear()
        coroutineScope.cancel()
        scheduler.shutdownNow()
    }
}