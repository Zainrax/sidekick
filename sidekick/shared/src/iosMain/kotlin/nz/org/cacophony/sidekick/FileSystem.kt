package nz.org.cacophony.sidekick

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import okio.FileSystem
import okio.IOException
import okio.Path
import okio.Path.Companion.toPath
import okio.buffer
import okio.use

actual fun writeToFile(file: Path, data: ByteArray): Either<IOException, Path> {
    return try {
        // check file's directory exists if parent is not null
        val parent = file.parent
        if (parent != null && !FileSystem.SYSTEM.exists(parent)) {
            FileSystem.SYSTEM.createDirectory(parent, true)
        }
        // if file exists, delete it
        if (FileSystem.SYSTEM.exists(file)) {
            FileSystem.SYSTEM.delete(file, false)
        }
        val res = FileSystem.SYSTEM.write(file, true) {
            write(data)
        }
        return file.right()
    } catch (e: IOException) {
        e.left()
    }
}

actual fun createDirectory(path: String): Either<IOException, Path> {
    return try {
        FileSystem.SYSTEM.createDirectory(path.toPath(), true)
        path.toPath().right()
    } catch (e: IOException) {
        Either.Left(e)
    }
}

actual fun getFile(file: Path): Either<IOException, ByteArray> {
    return try {
        FileSystem.SYSTEM.read(file) {
            readByteArray()
        }.right()
    } catch (e: IOException) {
        Either.Left(e)
    }
}

actual fun hasFile(path: Path): Boolean {
    return FileSystem.SYSTEM.exists(path)
}

actual fun deleteDirectory(path: Path): Either<IOException, Unit> {
    return try {
        FileSystem.SYSTEM.deleteRecursively(path, false);
        Unit.right()
    } catch (e: IOException) {
        Either.Left(e)
    }
}

actual fun deleteFile(path: Path): Either<IOException, Unit> {
    return try {
        FileSystem.SYSTEM.delete(path, false)
        Unit.right()
    } catch (e: IOException) {
        Either.Left(e)
    }
}

actual fun readAudioFile(path: Path): Either<IOException, AudioFileData> {
    return try {
        val source = FileSystem.SYSTEM.source(path).buffer()
        source.use { bufferedSource ->
            // Read WAV header
            bufferedSource.skip(24) // Skip to sample rate
            val sampleRate = bufferedSource.readIntLe()
            bufferedSource.skip(6) // Skip to bits per sample
            val bitsPerSample = bufferedSource.readShortLe()
            bufferedSource.skip(4) // Skip to data chunk size
            val dataSize = bufferedSource.readIntLe()

            // Calculate duration
            val bytesPerSample = bitsPerSample / 8
            val numSamples = dataSize / bytesPerSample
            val durationSeconds = numSamples.toDouble() / sampleRate

            // Read the entire file content
            bufferedSource.skip(-(44 + 4)) // Go back to the start of the file
            val content = bufferedSource.readByteArray()

            AudioFileData(content, durationSeconds).right()
        }
    } catch (e: IOException) {
        e.left()
    }
}