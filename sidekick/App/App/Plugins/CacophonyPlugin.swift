//
//  DashboardPlugin.swift
//  App
//
//  Created by Patrick Baxter on 29/11/22.
//

import Capacitor
import shared
var documentPath = String(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].absoluteString.dropFirst(7));

@objc(CacophonyPlugin)
public class CacophonyPlugin: CAPPlugin, CAPBridgedPlugin {
    public var identifier: String = "CacophonyPlugin"
    public var jsName: String = "Cacophony"
    
    public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name:"authenticateUser", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"requestDeletion", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"validateToken", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"setToTestServer", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"setToProductionServer", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"setToCustomServer", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"uploadRecording", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"getStationsForUser", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"updateStation", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"getReferenceImage", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"getReferencePhoto", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"uploadReferencePhoto", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"deleteReferencePhoto", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"createStation", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"uploadEvent", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name:"getAppVersion", returnType: CAPPluginReturnPromise),
    ]
    @objc let cacophony = CacophonyInterface(filePath: documentPath)

    @objc func authenticateUser(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.authenticateUser(call: pluginCall(call: call))
        }
    }
    @objc func requestDeletion(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.requestDeletion(call: pluginCall(call: call))
        }
    }
    @objc func validateToken(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.validateToken(call: pluginCall(call: call))
        }
    }
    @objc func setToTestServer(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.setToTestServer(call: pluginCall(call: call))
        }
    }
    @objc func setToProductionServer(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.setToProductionServer(call: pluginCall(call: call))
        }
    }
    @objc func setToCustomServer(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.setToCustomServer(call: pluginCall(call: call))
        }
    }
    @objc func uploadRecording(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.uploadRecording(call: pluginCall(call: call))
        }
    }
    @objc func uploadEvent(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.uploadEvent(call: pluginCall(call: call))
        }
    }
    @objc func getStationsForUser(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.getStationsForUser(call: pluginCall(call: call))
        }
    }
    @objc func updateStation(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.updateStation(call: pluginCall(call: call))
        }
    }
    @objc func uploadReferencePhoto(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.uploadReferencePhoto(call: pluginCall(call: call))
        }
    }
    @objc func getReferenceImage(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.getReferenceImage(call: pluginCall(call: call))
        }
    }
    @objc func getReferencePhoto(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.getReferencePhoto(call: pluginCall(call: call))
        }
    }
    @objc func deleteReferencePhoto(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.deleteReferencePhoto(call: pluginCall(call: call))
        }
    }
    @objc func createStation(_ call:CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.cacophony.createStation(call: pluginCall(call: call))
        }
    }
    @objc func getAppVersion(_ call: CAPPluginCall) {
        DispatchQueue.global().async { 
            if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
               let patchVersion = Bundle.main.infoDictionary?["CFBundleVersion"] as? String {
                let fullVersion = "\(version).\(patchVersion)"
                call.resolve(["data": fullVersion, "success": true])
            } else {
                call.resolve(["data": "1.0.0", "success": true])
            }
        }
    }
}
