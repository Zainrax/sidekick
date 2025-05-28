// CacophonyInterface.kt
package nz.org.cacophony.sidekick.cacophony

import arrow.core.Either
import kotlinx.serialization.Serializable
import nz.org.cacophony.sidekick.*
import okio.Path.Companion.toPath
import kotlinx.datetime.Clock

@Suppress("UNUSED")
data class CacophonyInterface(val filePath: String) : CapacitorInterface {
    val api = CacophonyApi()
    private val userApi = UserApi(api)
    private val deviceApi = DeviceApi(api, filePath)
    private val stationApi = StationApi(api, filePath)

    @Serializable
    data class User(val email: String, val password: String)

    fun authenticateUser(call: PluginCall) = runCatch(call) {
        call.validateCall<User>("email", "password").map { (email, password) ->
            userApi.authenticateUser(email, password)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { authUser ->
                        val resolvedObj = mapOf(
                            "id" to authUser.id.toString(),
                            "email" to authUser.email,
                            "token" to authUser.token.token,
                            "refreshToken" to authUser.token.refreshToken,
                        )
                        call.success(resolvedObj)
                    }
                )
        }
    }

    private fun getTokenFromCall(call: PluginCall): Either<Unit, AuthToken> =
        call.validateCall<AuthToken>("token", "refreshToken", "expiry")
            .mapLeft { call.reject("Invalid arguments for token $it") }

    data class RequestDeletion(val token: String)

    fun requestDeletion(call: PluginCall) = runCatch(call) {
        call.validateCall<RequestDeletion>("token").map { (token) ->
            userApi.requestDeletion(token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success() }
                )
        }
    }

    fun validateToken(call: PluginCall) = runCatch(call) {
        call.validateCall<UserApi.RefreshRequest>("refreshToken").map { token ->
            userApi.validateToken(token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { authUser ->
                        call.success(
                            mapOf(
                                "token" to authUser.token,
                                "refreshToken" to authUser.refreshToken,
                                "expiry" to authUser.expiry,
                            )
                        )
                    }
                )
        }
    }

    @Serializable
    data class Recording(
        val token: String,
        val device: String,
        val type: String,
        val filename: String
    )

    fun uploadRecording(call: PluginCall) = runCatch(call) {
        call.validateCall<Recording>("token", "device", "type", "filename").map { recording ->
            deviceApi.uploadRecording(
                filePath.toPath().resolve("recordings/${recording.filename}"),
                recording.filename,
                recording.device,
                recording.token,
                recording.type
            )
                .fold(
                    { error -> call.failure(error.toString()) },
                    {
                        call.success(
                            mapOf(
                                "recordingId" to it.recordingId,
                                "messages" to it.messages
                            )
                        )
                    }
                )
        }
    }

    @Serializable
    data class UploadEventCall(
        val token: String,
        val device: String,
        val eventId: String,
        val type: String,
        val details: String,
        val timeStamp: String
    )

    fun uploadEvent(call: PluginCall) = runCatch(call) {
        call.validateCall<UploadEventCall>(
            "token",
            "device",
            "eventId",
            "type",
            "details",
            "timeStamp"
        ).map { event ->
            deviceApi.uploadEvent(
                event.device,
                event.token,
                listOf(event.timeStamp),
                event.type,
                event.details
            )
                .fold(
                    { error -> call.failure(error.toString()) },
                    {
                        call.success(
                            mapOf(
                                "eventDetailId" to it.eventDetailId,
                                "eventsAdded" to it.eventsAdded,
                                "messages" to it.messages
                            )
                        )
                    }
                )
        }
    }

    @Serializable
    data class GetDeviceByIdCall(val token: String, val id: String)

    fun getDeviceById(call: PluginCall) = runCatch(call) {
        call.validateCall<GetDeviceByIdCall>("token", "id").map { device ->
            deviceApi.getDeviceById(device.id, device.token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success(it) }
                )
        }
    }

    @Serializable
    data class GetStationsForUserCall(val token: String)

    fun getStationsForUser(call: PluginCall) = runCatch(call) {
        call.validateCall<GetStationsForUserCall>("token").map { stations ->
            stationApi.getStations(stations.token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success(it) }
                )
        }
    }

    @Serializable
    data class UpdateStationCall(val token: String, val id: String, val name: String)

    fun updateStation(call: PluginCall) = runCatch(call) {
        call.validateCall<UpdateStationCall>("token", "id", "name").map { station ->
            stationApi.updateStation(station.id, station.name, station.token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success(it) }
                )
        }
    }

    @Serializable
    data class CreateStationCall(
        val token: String,
        val name: String,
        val lat: String,
        val lng: String,
        val groupName: String,
        val fromDate: String
    )

    fun createStation(call: PluginCall) = runCatch(call) {
        call.validateCall<CreateStationCall>("token", "name", "lat", "lng", "groupName", "fromDate")
            .map { station ->
                stationApi.createStation(
                    station.name,
                    station.lat,
                    station.lng,
                    station.fromDate,
                    station.groupName,
                    station.token
                )
                    .fold(
                        { error -> call.failure(error.toString()) },
                        { call.success(it.stationId) }
                    )
            }
    }

    @Serializable
    data class UploadImageCall(val token: String, val station: String, val filename: String)

    fun uploadReferencePhoto(call: PluginCall) = runCatch(call) {
        call.validateCall<UploadImageCall>("token", "station", "filename").map { image ->
            stationApi.uploadReferencePhoto(
                image.station,
                image.filename.removePrefix("file://").toPath(),
                image.token
            )
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success(it.fileKey) }
                )
        }
    }

    @Serializable
    data class GetReferencePhoto(
        val token: String? = null,
        val station: String,
        val fileKey: String
    )

    fun getReferencePhoto(call: PluginCall) = runCatch(call) {
        call.validateCall<GetReferencePhoto>("token", "station", "fileKey").map { photo ->
            stationApi.getReferencePhoto(photo.station, photo.fileKey, photo.token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success(it) }
                )
        }
    }

    @Serializable
    data class DeleteReferencePhoto(
        val token: String? = null,
        val station: String,
        val fileKey: String
    )

    fun deleteReferencePhoto(call: PluginCall) = runCatch(call) {
        call.validateCall<DeleteReferencePhoto>("token", "station", "fileKey").map { photo ->
            stationApi.deleteReferencePhoto(photo.station, photo.fileKey, photo.token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { res ->
                        call.success(
                            mapOf(
                                "serverDeleted" to res.serverDeleted,
                                "localDeleted" to res.localDeleted
                            )
                        )
                    }
                )
        }
    }

    @Serializable
    data class UploadDeviceReferenceImageCall(
        val token: String,
        val deviceId: String,
        val filename: String,
        val type: String? = null,
        val atTime: String? = null
    )

    fun uploadDeviceReferenceImage(call: PluginCall) = runCatch(call) {
        call.validateCall<UploadDeviceReferenceImageCall>(
            "token",
            "deviceId",
            "filename",
            "type",
            "atTime"
        ).map { image ->
            deviceApi.uploadDeviceReferenceImage(
                image.deviceId,
                image.filename.removePrefix("file://").toPath(),
                image.token,
                image.type,
                image.atTime
            ).fold(
                { error -> call.failure(error.toString()) },
                { call.success(it) }
            )
        }
    }

    @Serializable
    data class ReferenceImageCall(
        val token: String? = null,
        val deviceId: String,
        val fileKey: String? = null,
        val filePath: String
    )

    fun getReferenceImage(call: PluginCall) = runCatch(call) {
        call.validateCall<ReferenceImageCall>("deviceId", "filePath", "fileKey").map { photo ->
            deviceApi.getReferenceImage(photo.deviceId, photo.filePath, photo.fileKey, photo.token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success(it) }
                )
        }
    }

    @Serializable
    data class DeviceCall(
        val token: String? = null,
        val filePath: String,
        val deviceId: String,
    )

    fun saveDeviceImage(call: PluginCall) = runCatch(call) {
        call.validateCall<DeviceCall>("deviceId", "filePath", "token").map { photo ->
            deviceApi.saveServerImage(photo.deviceId, photo.filePath, photo.token)
                .fold(
                    { error -> call.failure(error.toString()) },
                    { call.success(it) }
                )
        }
    }

    @Serializable
    data class DeleteReferenceImageCall(
        val token: String? = null,
        val deviceId: String,
        val fileKey: String
    )

    fun deleteReferenceImage(call: PluginCall) = runCatch(call) {
        call.validateCall<ReferenceImageCall>("deviceId", "filePath").map { photo ->
            deviceApi.deleteReferenceImage(
                photo.deviceId,
                photo.filePath,
                photo.token
            )
                .also { res ->
                    call.success(
                        mapOf(
                            "serverDeleted" to res.serverDeleted,
                            "localDeleted" to res.localDeleted
                        )
                    )
                }
        }
    }

    fun setToTestServer(call: PluginCall) = runCatch(call) {
        api.setToTest()
        call.success()
    }

    fun setToProductionServer(call: PluginCall) = runCatch(call) {
        api.setToProd()
        call.success()
    }


    @Serializable
    data class SetToCustomServer(val url: String)

    fun setToCustomServer(call: PluginCall) = runCatch(call) {
        call.validateCall<SetToCustomServer>("url").map { callVal ->
            api.setToCustom(callVal.url + "/api/v1")
            call.success()
        }
    }

    @Serializable
    data class RecordingBatchItem(
        val id: String,
        val type: String,
        val device: String,
        val filename: String,
        val filepath: String
    )

    @Serializable
    data class BatchUploadRequest(
        val token: String,
        val recordings: List<RecordingBatchItem>,
        val maxConcurrent: Int = 3
    )

    fun batchUploadRecordings(call: PluginCall) = runCatch(call) {
        call.validateCall<BatchUploadRequest>("token", "recordings").map { request ->
            deviceApi.startBatchUpload(
                token = request.token,
                recordings = request.recordings,
                maxConcurrent = request.maxConcurrent,
                onProgress = { recordingId, progress ->
                    call.notifyListeners("uploadProgress", mapOf(
                        "recordingId" to recordingId,
                        "progress" to progress,
                    ))
                },
                onCompleted = { recordingId, uploadId ->
                    call.notifyListeners("uploadCompleted", mapOf(
                        "recordingId" to recordingId,
                        "uploadId" to uploadId,
                    ))
                },
                onFailed = { recordingId, error ->
                    call.notifyListeners("uploadFailed", mapOf(
                        "recordingId" to recordingId,
                        "error" to error,
                    ))
                },
                onStatusChanged = { status ->
                    call.notifyListeners("queueStatusChanged", mapOf(
                        "total" to status.total,
                        "pending" to status.pending,
                        "uploading" to status.uploading,
                        "completed" to status.completed,
                        "failed" to status.failed,
                        "paused" to status.paused
                    ))
                }
            )
            call.success()
        }
    }

    @Serializable
    data class QueueRequest(val queueId: String)

    fun pauseUploadQueue(call: PluginCall) = runCatch(call) {
        call.validateCall<QueueRequest>("queueId").map { request ->
            deviceApi.pauseUploadQueue(request.queueId)
            call.success()
        }
    }

    fun resumeUploadQueue(call: PluginCall) = runCatch(call) {
        call.validateCall<QueueRequest>("queueId").map { request ->
            deviceApi.resumeUploadQueue(request.queueId)
            call.success()
        }
    }

    fun cancelUploadQueue(call: PluginCall) = runCatch(call) {
        call.validateCall<QueueRequest>("queueId").map { request ->
            deviceApi.cancelUploadQueue(request.queueId)
            call.success()
        }
    }

    fun getUploadQueueStatus(call: PluginCall) = runCatch(call) {
        call.validateCall<QueueRequest>("queueId").map { request ->
            val status = deviceApi.getUploadQueueStatus(request.queueId)
            call.success(
                mapOf(
                    "total" to status.total,
                    "pending" to status.pending,
                    "uploading" to status.uploading,
                    "completed" to status.completed,
                    "failed" to status.failed,
                    "paused" to status.paused
                )
            )
        }
    }
}