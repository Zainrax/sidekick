buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.2.1")
        classpath("com.google.gms:google-services:4.4.1")
        classpath("com.google.firebase:firebase-crashlytics-gradle:2.9.5")
    }
}
plugins {
    //trick: for the same plugin versions in all sub-modules
    id("com.android.application").version("8.2.0").apply(false)
    id("com.android.library").version("8.2.0").apply(false)
    id("org.jetbrains.kotlin.plugin.serialization").version("1.6.21")
    kotlin("android").version("1.9.23").apply(false)
    kotlin("multiplatform").version("1.9.23").apply(false)
}


tasks.register("clean", Delete::class) {
    delete(rootProject.buildDir)
}
allprojects {
    repositories {
        google()
        mavenCentral()
    }
}