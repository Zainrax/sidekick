package nz.org.cacophony.sidekick

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import nz.org.cacophony.sidekick.cacophony.CacophonyInterface

@CapacitorPlugin(name = "Cacophony")
class CacophonyPlugin : Plugin() {
    lateinit var cacophony: CacophonyInterface

    override fun load() {
        cacophony = CacophonyInterface(context.applicationContext.filesDir.absolutePath)
    }

    @PluginMethod
    fun authenticateUser(call: PluginCall) {
        cacophony.authenticateUser(pluginCall(call))
    }

    @PluginMethod
    fun requestDeletion(call: PluginCall) {
        cacophony.requestDeletion(pluginCall(call))
    }

    @PluginMethod
    fun validateToken(call: PluginCall) {
        cacophony.validateToken(pluginCall(call))
    }

    @PluginMethod
    fun setToTestServer(call: PluginCall) {
        cacophony.setToTestServer(pluginCall(call))
    }

    @PluginMethod
    fun setToProductionServer(call: PluginCall) {
        cacophony.setToProductionServer(pluginCall(call))
    }

    @PluginMethod
    fun setToCustomServer(call: PluginCall) {
        cacophony.setToCustomServer(pluginCall(call))
    }

    @PluginMethod
    fun uploadRecording(call: PluginCall) {
        cacophony.uploadRecording(pluginCall(call))
    }

    @PluginMethod
    fun uploadEvent(call: PluginCall) {
        cacophony.uploadEvent(pluginCall(call))
    }

    @PluginMethod
    fun getDeviceById(call: PluginCall) {
        cacophony.getDeviceById(pluginCall(call))
    }

    @PluginMethod
    fun getStationsForUser(call: PluginCall) {
        cacophony.getStationsForUser(pluginCall(call))
    }

    @PluginMethod
    fun createStation(call: PluginCall) {
        cacophony.createStation(pluginCall(call))
    }

    @PluginMethod
    fun updateStation(call: PluginCall) {
        cacophony.updateStation(pluginCall(call))
    }

    @PluginMethod
    fun uploadReferencePhoto(call: PluginCall) {
        cacophony.uploadReferencePhoto(pluginCall(call))
    }

    @PluginMethod
    fun getReferencePhoto(call: PluginCall) {
        cacophony.getReferencePhoto(pluginCall(call))
    }

    @PluginMethod
    fun getReferenceImage(call: PluginCall) {
        cacophony.getReferenceImage(pluginCall(call))
    }


    @PluginMethod
    fun saveDeviceImage(call: PluginCall) {
        cacophony.saveDeviceImage(pluginCall(call))
    }

    @PluginMethod
    fun uploadDeviceReferenceImage(call: PluginCall) {
        cacophony.uploadDeviceReferenceImage(pluginCall(call))
    }

    @PluginMethod
    fun deleteReferenceImage(call: PluginCall) {
        cacophony.deleteReferenceImage(pluginCall(call))
    }


    @PluginMethod
    fun deleteReferencePhoto(call: PluginCall) {
        cacophony.deleteReferencePhoto(pluginCall(call))
    }


    fun PackageManager.getPackageInfoCompat(packageName: String, flags: Int = 0): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION") getPackageInfo(packageName, flags)
        }

    @PluginMethod
    fun getAppVersion(call: PluginCall) {
        // Get version name
        try {
            val pInfo = context.packageManager.getPackageInfoCompat(context.packageName)
            val version = pInfo.versionName
            val data = JSObject()
            data.put("data", version)
            data.put("success", true)
            call.resolve(data)
        } catch (e: PackageManager.NameNotFoundException) {
            e.printStackTrace()
            val data = JSObject()
            data.put("success", false)
            data.put("message", "Could not get app version")
            call.resolve(data)
        }

    }
}

