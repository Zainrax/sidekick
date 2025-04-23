# Sidekick

Sidekick is a cross-platform mobile application for connecting to and managing Cacophony Project thermal cameras used in wildlife conservation.

## What is Sidekick?

Sidekick allows conservationists and researchers to:

- Connect to Cacophony thermal cameras in the field
- Configure camera settings and recording schedules
- View live camera feeds and test recordings
- Download and manage recorded footage
- Upload wildlife recordings to the Cacophony Project platform
- Track camera locations and status

The Cacophony Project uses thermal cameras with AI-powered detection to monitor wildlife for conservation research, particularly focusing on predator control and native species protection in New Zealand.

## Technology Stack

Sidekick is built using:

- [Kotlin Multiplatform Mobile](https://kotlinlang.org/docs/multiplatform-mobile-getting-started.html) for shared native code
- [Capacitor.js](https://capacitorjs.com/) for cross-platform native runtime
- [Solid.js](https://www.solidjs.com/) for the user interface
- [SQLite](https://www.sqlite.org/) for local data storage

This architecture provides native performance with cross-platform compatibility for both Android and iOS.

## Prerequisites

- [Node.js](https://nodejs.org/en/) version 18 or higher
- Java 17
- [Android Studio](https://developer.android.com/studio) (for Android development)
- Xcode (for iOS development, requires macOS)
- A physical mobile device for testing (most features require hardware access)

## Development Setup

1. Install deno (recommended package manager):

### Windows

irm <https://deno.land/install.ps1> | iex

### Linux

```bash
curl -fsSL https://deno.land/install.sh | sh
```

2. Open the project in Android Studio:

   - Open the `/sidekick` directory in Android Studio
   - Let Gradle download all dependencies

3. Install JavaScript dependencies:

   ```bash
   deno install
   ```

4. Build and run:

   ```bash
   # Development mode with hot reloading
   deno dev

   # OR

   # Build a release version
   deno build
   deno sync
   ```

5. Connect a physical device:
   - Enable USB debugging on your Android device
   - Connect it to your computer
   - Or use Xcode to deploy to an iOS device

**Note:** Most camera features require physical hardware and cannot be fully tested in emulators.

## Release Process

### Android

Builds are automated through GitHub releases.

### iOS

Builds are created manually using Xcode Archive.

### Version Updates

When creating a new release, update version numbers in:

- `./sidekick/app/build.gradle.kts`
- `./sidekick/App/App.xcodeproj/project.pbxproj`

## Documentation

For more information about the Cacophony Project:

- [Cacophony Project Website](https://cacophony.org.nz/)
- [GitHub Organization](https://github.com/TheCacophonyProject)

