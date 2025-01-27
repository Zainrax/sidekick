package nz.org.cacophony.sidekick.cacophony

import arrow.core.Either
import arrow.core.flatMap
import arrow.core.right
import nz.org.cacophony.sidekick.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.bodyAsText
import io.ktor.http.*
import io.ktor.http.HttpHeaders.Authorization
import io.ktor.util.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okio.ByteString.Companion.toByteString
import okio.Path
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonTransformingSerializer
import kotlinx.datetime.*
import okio.Path.Companion.toPath

private const val ADTS_HEADER_SIZE = 7
private const val SYNC_WORD_MASK = 0xFFF0
private const val SYNC_WORD = 0xFFF0
private const val SAMPLE_RATE_INDEX_MASK = 0x3C00
private val SAMPLE_RATES =
    listOf(96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000)

class DeviceApi(private val api: Api, val filePath: String) {
    private fun getSha1FileHash(file: ByteArray): Either<ApiError, String> = Either.catch {
        val byteStr = file.toByteString()
        return byteStr.sha1().hex().right()
    }
        .mapLeft { InvalidResponse.ParsingError("Unable to get SHA1 hash for file $file: ${it.message}") }

    private fun encodeBase64(file: String): Either<ApiError, String> =
        Either.catch { return file.encodeBase64().right() }.mapLeft {
            InvalidResponse.ParsingError("Unable to encode file $file to base64: ${it.message}")
        }

    fun convertToIsoString(dateString: String): String {
        // Parse the input string
        val year = dateString.substring(0, 4).toInt()
        val month = dateString.substring(5, 7).toInt()
        val day = dateString.substring(8, 10).toInt()
        val hour = dateString.substring(12, 14).toInt()
        val minute = dateString.substring(15, 17).toInt()
        val second = dateString.substring(18).toInt()

        // Create a LocalDateTime object
        val dateTime = LocalDateTime(year, month, day, hour, minute, second)

        // Convert to Instant (assuming UTC timezone)
        val instant = dateTime.toInstant(TimeZone.UTC)

        // Format to ISO 8601 string
        return instant.toString()
    }


    private fun parseLocation(locationString: String): List<Double>? {
        return try {
            locationString.trim('[', ']').split(',').map { it.toDouble() }
        } catch (e: Exception) {
            null
        }
    }

    private fun convertToMp3Filename(filename: String): String {
        val nameWithoutExtension = filename.substringBeforeLast(".", "")
        return if (nameWithoutExtension.isEmpty()) filename else "$nameWithoutExtension.mp3"
    }

    @Serializable
    data class RecordingData(val type: String, val fileHash: String)

    @Serializable
    data class AudioRecordingData(val type: String, val fileHash: String)

    @Serializable
    data class DatedAudioRecordingData(
        val type: String,
        val fileHash: String,
        val recordingDateTime: String
    )

    @Serializable
    data class UploadRecordingResponse(
        val recordingId: Int,
        val success: Boolean,
        val messages: List<String>
    )

    suspend fun uploadRecording(
        filePath: Path,
        filename: String,
        device: String,
        token: Token,
        type: String
    ): Either<ApiError, UploadRecordingResponse> =
        if (type == "audio") {
            readAudioFile(filePath).map { audioData ->
                return getSha1FileHash(audioData.content).flatMap { hash ->
                    // First attempt without date
                    val initialResponse = api.post(
                        "recordings/device/${device}"
                    ) {
                        headers {
                            append(Authorization, token)
                            contentType(ContentType.MultiPart.FormData)
                        }
                        setBody(
                            MultiPartFormDataContent(
                                formData {
                                    append("file", audioData.content, Headers.build {
                                        append(
                                            HttpHeaders.ContentDisposition,
                                            "filename=file"
                                        )
                                    })
                                    append(
                                        "data",
                                        Json.encodeToString(AudioRecordingData(type, hash)),
                                        Headers.build {
                                            append(HttpHeaders.ContentType, "application/json")
                                        })
                                },
                                boundary = "WebAppBoundary"
                            )
                        )
                    }

                    // Check response and retry with date if needed
                    initialResponse.flatMap { validateResponse<UploadRecordingResponse>(it) }
                        .flatMap { response ->
                            if (!response.success &&
                                response.messages.any { it.contains("recordingDateTime not supplied") }
                            ) {

                                // Extract date from filename or use current time
                                val recordingDate =
                                    convertToIsoString(filename.removeSuffix(".aac"))

                                // Retry with DatedAudioRecordingData
                                return api.post(
                                    "recordings/device/${device}"
                                ) {
                                    headers {
                                        append(Authorization, token)
                                        contentType(ContentType.MultiPart.FormData)
                                    }
                                    setBody(
                                        MultiPartFormDataContent(
                                            formData {
                                                append("file", audioData.content, Headers.build {
                                                    append(
                                                        HttpHeaders.ContentDisposition,
                                                        "filename=file"
                                                    )
                                                })
                                                append(
                                                    "data",
                                                    Json.encodeToString(
                                                        DatedAudioRecordingData(
                                                            type,
                                                            hash,
                                                            recordingDate
                                                        )
                                                    ),
                                                    Headers.build {
                                                        append(
                                                            HttpHeaders.ContentType,
                                                            "application/json"
                                                        )
                                                    })
                                            },
                                            boundary = "WebAppBoundary"
                                        )
                                    )
                                }.flatMap { retryResponse ->
                                    validateResponse<UploadRecordingResponse>(retryResponse)
                                }
                            } else {
                                Either.Right(response)
                            }
                        }
                }
            }
                .mapLeft { InvalidResponse.UnknownError("Unable to upload recording for $filename: $it") }
        } else {
            getFile(filePath).flatMap { file ->
                getSha1FileHash(file).flatMap { hash ->
                    api.post(
                        "recordings/device/${device}"
                    ) {
                        headers {
                            append(Authorization, token)
                            contentType(ContentType.MultiPart.FormData)
                        }
                        setBody(
                            MultiPartFormDataContent(
                                formData {
                                    append("file", file, Headers.build {
                                        append(
                                            HttpHeaders.ContentDisposition,
                                            "filename=${filename}"
                                        )
                                    })
                                    append(
                                        "data",
                                        Json.encodeToString(RecordingData(type, hash)),
                                        Headers.build {
                                            append(HttpHeaders.ContentType, "application/json")
                                        })
                                },
                                boundary = "WebAppBoundary"

                            )
                        )
                    }.map {
                        return validateResponse(it)
                    }
                }
            }
                .mapLeft { InvalidResponse.UnknownError("Unable to upload recording for $filename: $it") }
        }

    object JsonAsStringSerializer :
        JsonTransformingSerializer<String>(tSerializer = String.serializer()) {
        override fun transformDeserialize(element: JsonElement): JsonElement {
            return JsonPrimitive(value = element.toString())
        }
    }

    @Serializable
    data class UploadEventResponse(
        val eventsAdded: Int,
        val eventDetailId: Int,
        val success: Boolean,
        val messages: List<String>
    )

    @Serializable
    data class UploadEventDescription(val type: String, val details: JsonElement)

    @Serializable
    data class UploadEventBody(val dateTimes: List<String>, val description: UploadEventDescription)

    suspend fun uploadEvent(
        device: String,
        token: String,
        dateTimes: List<String>,
        type: String,
        details: String
    ): Either<ApiError, UploadEventResponse> {
        // remove backslashes from \" in details and remove surrounding quotes
        val cleanDetails = details
        val json = Json.parseToJsonElement(cleanDetails)
        val eventReq = UploadEventBody(dateTimes, UploadEventDescription(type, json))
        val body = Json.encodeToString(eventReq)
        return api.post("events/device/${device}") {
            headers {
                append(Authorization, token)
                contentType(ContentType.Application.Json)
            }
            setBody(body)
        }.map {
            return validateResponse(it)
        }
    }

    @Serializable
    data class Device(
        val deviceName: String,
        val groupName: String,
        val groupId: Int,
        val deviceId: Int,
        val saltId: Int,
        val active: Boolean,
        val admin: Boolean,
        val type: String,
        val public: Boolean,
        val lastConnectionTime: String,
        val lastRecordingTime: String,
        val location: Location,
        val users: List<User>
    )

    @Serializable
    data class Location(val lat: Double, val lng: Double)

    @Serializable
    data class User(val userName: String, val userId: Int, val admin: Boolean)

    @Serializable
    data class DeviceResponse(val device: Device, val success: Boolean, val messages: List<String>)

    suspend fun getDeviceById(deviceId: String, token: String): Either<ApiError, DeviceResponse> {
        return api.get("devices/${deviceId}") {
            headers {
                append(Authorization, token)
            }
        }.map {
            return validateResponse(it)
        }
    }

    @Serializable
    data class ReferencePhoto(val key: String, val size: Int)

    @Serializable
    data class DeviceReferenceImage(
        val result: ReferencePhoto,
        val messages: List<String>,
        val success: Boolean
    )

    @Serializable
    data class DeleteResponse(val success: Boolean)

    @Serializable
    data class DeletedReference(val localDeleted: Boolean, val serverDeleted: Boolean)

    suspend fun uploadDeviceReferenceImage(
        deviceId: String,
        filePath: Path,
        token: Token,
        type: String? = null,
        atTime: String? = null
    ): Either<InvalidResponse, String> =
        getFile(filePath).map { image ->
            val url = "${api.basePath}/devices/$deviceId/reference-image"
            val res = api.client.post(url) {
                headers {
                    append(Authorization, token)
                    append("Content-Disposition", "image/jpeg")

                }
                setBody(image)
            }
            return res.bodyAsText().right()
        }.mapLeft { InvalidResponse.UnknownError("Unable to get image for $filePath") }

    suspend fun getReferenceImage(
        deviceId: String,
        filePath: String,
        fileKey: String?,
        token: Token? = null
    ): Either<InvalidResponse, String> {
        try {
            // remove "file:/" from start
            val path = filePath.removePrefix("file:/").toPath()
            return if (hasFile(path)) {
                getFile(path).map { path.toString() }
                    .mapLeft { InvalidResponse.UnknownError("Unable to get reference image for $deviceId: $it") }
            } else if (hasFile(filePath.toPath())) {
                getFile(filePath.toPath()).map { path.toString() }
                    .mapLeft { InvalidResponse.UnknownError("Unable to get reference image for $deviceId: $it") }
            } else {
                api.getRequest("devices/$deviceId/reference-image", token)
                    .flatMap { validateResponse<ByteArray>(it) }
                    .flatMap {
                        writeToFile(path, it)
                            .map { path -> path.toString() }
                            .mapLeft { err ->
                                InvalidResponse.UnknownError("Unable to write image for $path: $err")
                            }
                    }
                    .mapLeft { InvalidResponse.UnknownError("Unable to get reference image for $deviceId: $it") }
            }
        } catch (e: Exception) {
            return filePath.right()
        }
    }

    suspend fun saveServerImage(
        deviceId: String,
        filePath: String,
        token: Token? = null
    ): Either<InvalidResponse, String> {
        try {
            val path = filePath.removePrefix("file://").toPath()
            return api.getRequest("devices/$deviceId/reference-image", token)
                .flatMap { validateResponse<ByteArray>(it) }
                .flatMap {
                    writeToFile(path, it)
                        .map { path -> path.toString() }
                        .mapLeft { err ->
                            InvalidResponse.UnknownError("Unable to write image for $path: $err")
                        }
                }
                .mapLeft { InvalidResponse.UnknownError("Unable to get reference image for $deviceId: $it") }
        } catch (e: Exception) {
            return filePath.right()
        }
    }

    suspend fun deleteReferenceImage(
        deviceId: String,
        filePath: String,
        token: Token? = null
    ): DeletedReference {
        val safeFileKey = filePath.replace("/", "_")
        val path = filePath.toPath().resolve("cache/$safeFileKey")

        val localDelete: Either<InvalidResponse, Unit> =
            deleteFile(path).mapLeft {
                InvalidResponse.UnknownError("Unable to delete local file for $deviceId: $it")
            }

        val serverDelete: Either<InvalidResponse, DeleteResponse> =
            api.deleteRequest("devices/$deviceId/reference-image", token)
                .mapLeft {
                    // If the delete request itself failed to even return a response
                    InvalidResponse.UnknownError("Failed to call deleteRequest: $it")
                }
                .flatMap { responseOrError ->
                    // Validate the actual HTTP response body
                    validateResponse<DeleteResponse>(responseOrError).mapLeft { err ->
                        InvalidResponse.UnknownError("DeleteResponse validation failed: $err")
                    }
                }

        val localDeleted = localDelete.isRight()
        val serverDeleted = serverDelete.isRight()

        return DeletedReference(localDeleted, serverDeleted)
    }

}
