package nz.org.cacophony.sidekick.cacophony

import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import nz.org.cacophony.sidekick.Api
import okio.Path.Companion.toPath

class BatchUploadQueue(
    val token: Token,
    val recordings: MutableList<CacophonyInterface.RecordingBatchItem>,
    val maxConcurrent: Int,
    val api: Api,
    val filePath: String,
    val onProgress: (recordingId: String, progress: Int) -> Unit = { _, _ -> },
    val onCompleted: (recordingId: String, uploadId: String) -> Unit = { _, _ -> },
    val onFailed: (recordingId: String, error: String) -> Unit = { _, _ -> },
    val onStatusChanged: (status: DeviceApi.UploadQueueStatus) -> Unit = { _ -> }
) {
    private val coroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var isPaused = false
    private var isCancelled = false
    
    private val totalCount = recordings.size
    private var pendingCount = recordings.size
    private var uploadingCount = 0
    private var completedCount = 0
    private var failedCount = 0
    
    private val uploadSemaphore = Semaphore(maxConcurrent)
    private val deviceApi = DeviceApi(api, filePath)
    
    fun start() {
        coroutineScope.launch {
            processQueue()
        }
    }
    
    private suspend fun processQueue() {
        for (recording in recordings) {
            if (isCancelled) break
            
            while (isPaused && !isCancelled) {
                delay(100) // Check every 100ms
            }
            
            uploadSemaphore.acquire()
            
            coroutineScope.launch {
                try {
                    pendingCount--
                    uploadingCount++
                    
                    // Notify progress
                    onProgress(recording.id, 0)
                    
                    // Perform upload using existing DeviceApi upload logic
                    val result = deviceApi.uploadRecording(
                        filePath = recording.filepath.toPath(),
                        filename = recording.filename,
                        device = recording.device,
                        token = token,
                        type = recording.type
                    )
                    
                    result.fold(
                        { error ->
                            failedCount++
                            onFailed(recording.id, error.toString())
                        },
                        { response ->
                            completedCount++
                            onCompleted(recording.id, response.recordingId.toString())
                        }
                    )
                } catch (e: Exception) {
                    failedCount++
                    onFailed(recording.id, e.message ?: "Unknown error")
                } finally {
                    uploadingCount--
                    uploadSemaphore.release()
                    onStatusChanged(getStatus())
                }
            }
        }
    }
    
    fun pause() {
        isPaused = true
        onStatusChanged(getStatus())
    }
    
    fun resume() {
        isPaused = false
        onStatusChanged(getStatus())
    }
    
    fun cancel() {
        isCancelled = true
        coroutineScope.cancel()
    }
    
    fun getStatus(): DeviceApi.UploadQueueStatus {
        return DeviceApi.UploadQueueStatus(
            total = totalCount,
            pending = pendingCount,
            uploading = uploadingCount,
            completed = completedCount,
            failed = failedCount,
            paused = isPaused
        )
    }
    
}