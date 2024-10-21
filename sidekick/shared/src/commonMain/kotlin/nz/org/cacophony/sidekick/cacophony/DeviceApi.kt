package nz.org.cacophony.sidekick.cacophony

import arrow.core.Either
import arrow.core.flatMap
import arrow.core.right
import nz.org.cacophony.sidekick.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.http.*
import io.ktor.http.HttpHeaders.Authorization
import io.ktor.util.*
import io.ktor.websocket.Frame
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import nz.org.cacophony.sidekick.*
import okio.ByteString.Companion.toByteString
import okio.Path
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonTransformingSerializer
import kotlinx.datetime.*
import kotlinx.datetime.LocalDate.Formats.ISO
import kotlinx.serialization.BinaryFormat
import okio.IOException
import okio.Path.Companion.toPath
import kotlin.time.Duration

@Serializable
data class UploadRecordingResponse(val recordingId: Int, val success: Boolean,val messages: List<String>)

class DeviceApi(private val api: Api, val filePath: String) {
    private fun getSha1FileHash(file: ByteArray): Either<ApiError, String> = Either.catch {
        val byteStr = file.toByteString()
        return byteStr.sha1().hex().right()
    }.mapLeft { InvalidResponse.ParsingError("Unable to get SHA1 hash for file $file: ${it.message}") }

    private fun encodeBase64(file: String): Either<ApiError, String> = Either.catch { return file.encodeBase64().right()}.mapLeft {
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
    @Serializable
    data class RecordingData(val type: String, val fileHash: String)
    @Serializable
    data class AudioRecordingData(val type: String, val fileHash: String, val recordingDateTime: String)
    suspend fun uploadRecording(filePath: Path, filename: String, device: String, token: Token, type: String): Either<ApiError,UploadRecordingResponse> =
        if(type == "audio") {
                readAudioFile(filePath).flatMap { audioData ->
                    getSha1FileHash(audioData.content).flatMap { hash ->
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
                                        append("file", audioData.content, Headers.build {
                                            append(
                                                HttpHeaders.ContentDisposition,
                                                "form-data; name=file; filename=${filename}"
                                            )
                                        })
                                        append(
                                            "data",
                                            Json.encodeToString(AudioRecordingData(type, hash, convertToIsoString(filename.removeSuffix(".aac")))),
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
                }.mapLeft { InvalidResponse.UnknownError("Unable to upload recording for $filename: $it") }        } else {
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
    object JsonAsStringSerializer: JsonTransformingSerializer<String>(tSerializer = String.serializer()) {
        override fun transformDeserialize(element: JsonElement): JsonElement {
            return JsonPrimitive(value = element.toString())
        }
    }
    @Serializable
    data class UploadEventResponse(val eventsAdded: Int, val eventDetailId: Int, val success: Boolean, val messages: List<String>)
    @Serializable
    data class UploadEventDescription(val type: String, val details: JsonElement)
    @Serializable
    data class UploadEventBody(val dateTimes: List<String>, val description: UploadEventDescription)
    suspend fun uploadEvent(device: String, token: String, dateTimes: List<String>, type: String, details: String) : Either<ApiError, UploadEventResponse> {
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
    data class Device(val deviceName: String, val groupName: String, val groupId: Int, val deviceId: Int, val saltId: Int, val active: Boolean, val admin: Boolean, val type: String, val public: Boolean, val lastConnectionTime: String, val lastRecordingTime: String, val location: Location, val users: List<User>)
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
}