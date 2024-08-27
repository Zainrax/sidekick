//
//  DevicePlugin.swift
//  App
//
//  Created by Patrick Baxter on 13/12/22.
//

import Network
import Capacitor
import shared
import NetworkExtension
import SystemConfiguration.CaptiveNetwork

let type = "_cacophonator-management._tcp"
let domain = "local."

@objc(DevicePlugin)
public class DevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public var identifier: String = "DevicePlugin"
    public var jsName: String = "Device"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discoverDevices",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopDiscoverDevices",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkDeviceConnection",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceInfo",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDeviceConfig",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceConfig",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLowPowerMode",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connectToDeviceAP", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkIsAPConnected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceLocation",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDeviceLocation",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRecordings",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEvents",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteEvents",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEventKeys",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteRecording",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteRecordings",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadRecording",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateRecordingWindow",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unbindConnection",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rebindConnection",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasConnection",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnectFromDeviceAP",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "turnOnModem",returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reregisterDevice",returnType: CAPPluginReturnPromise),
    ]
    
    enum CallType {
        case permissions
        case singleUpdate
        case discover
    }
    enum Result {
        case success
        case failed
    }
    
    @objc let device = DeviceInterface(filePath: documentPath)
    let configuration = NEHotspotConfiguration(ssid: "bushnet", passphrase: "feathers", isWEP: false)
    var isConnected = false;
    
    private var callQueue: [String: CallType] = [:]
    func createBrowser() -> NWBrowser {
        return NWBrowser(for: .bonjour(type: type, domain: domain), using: .tcp)
    }
    private var serviceBrowser: NWBrowser?
    private var isDiscovering = false
    func getIPFromHost(_ host: Network.NWEndpoint.Host) -> String? {
        switch host {
        case .ipv4(let ipv4Address):
            return ipv4Address.debugDescription
        case .ipv6(let ipv6Address):
            var ipString = ipv6Address.debugDescription
            // Remove the scope ID if present
            if let percentIndex = ipString.firstIndex(of: "%") {
                ipString = String(ipString[..<percentIndex])
            }
            return ipString
        case .name(let hostname, _):
            return hostname
        @unknown default:
            return nil
        }
    }
    @objc func discoverDevices(_ call: CAPPluginCall) {
        if isDiscovering {
            call.reject("Currently discovering")
            return
        }
        
        let parameters = NWParameters()
        parameters.requiredInterfaceType = .wifi
        
        serviceBrowser = NWBrowser(for: .bonjour(type: "_cacophonator-management._tcp", domain: "local."), using: parameters)
        serviceBrowser?.stateUpdateHandler = { newState in
            switch newState {
            case .failed(let error):
                call.reject("Error discovering devices: \(error.localizedDescription)")
            case .ready:
                break
            default:
                break
            }
        }
        
        serviceBrowser?.browseResultsChangedHandler = { [weak self] results, changes in
            for change in changes {
                switch change {
                case .added(let result):
                    let endpoint = switch result.endpoint {
                    case .service(let name, _, _, _):
                        "\(name).local"
                    default:
                        result.endpoint.debugDescription
                    }
                    self?.notifyListeners("onServiceResolved", data: ["endpoint": endpoint, "status": "connected"])
                case .identical:
                    break
                case .removed(let result):
                    let endpoint = switch result.endpoint {
                    case .service(let name, _, _, _):
                        "\(name).local"
                    default:
                        result.endpoint.debugDescription
                    }
                    let data = ["endpoint": endpoint, "status": "disconnected"]
                    self?.notifyListeners("onServiceLost", data: data)
                case .changed(old: _, new: let new, flags: _):
                    let endpoint = switch new.endpoint {
                    case .service(let name, _, _, _):
                        "\(name).local"
                    default:
                        new.endpoint.debugDescription
                    }
                    self?.notifyListeners("onServiceResolved", data: ["endpoint": endpoint, "status": "connected"])
                    break
                @unknown default:
                    break
                }
                
            }
        }
        
        serviceBrowser?.start(queue: .main)
    }

    
    @objc func stopDiscoverDevices(_ call: CAPPluginCall) {
        isDiscovering = false
        call.resolve()
    }
    @objc func checkDeviceConnection(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.checkDeviceConnection(call: pluginCall(call: call))
        }
    }
    
    @objc func connectToDeviceAP(_ call: CAPPluginCall) {
        guard let bridge = self.bridge else { return }
        DispatchQueue.global().async { [self] in
            
            // First, check if already connected to bushnet
            checkCurrentConnection { isConnected in
                if isConnected {
                    call.resolve(["status": "connected"])
                    return
                }
                self.configuration.joinOnce = true
                
                // If not connected, proceed with connection attempt
                NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: "bushnet")
                
                NEHotspotConfigurationManager.shared.apply(self.configuration) { error in
                    if let error = error {
                        call.resolve(["status": "error", "error": error.localizedDescription])
                        return
                    }
                    call.resolve(["status": "connected"])
                }
            }
        }}
    
    
    @objc func disconnectFromDeviceAP(_ call: CAPPluginCall) {
        guard let bridge = self.bridge else { return call.reject("Could not access bridge") }
        call.keepAlive = true
        DispatchQueue.global().async {
            
            // Attempt to remove the Wi-Fi configuration for the SSID "bushnet"
            NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: "bushnet")
            
            if #available(iOS 14.0, *) {
                NEHotspotNetwork.fetchCurrent { (currentConfiguration) in
                    if let currentSSID = currentConfiguration?.ssid, currentSSID == "bushnet" {
                        // The device is still connected to the "bushnet" network, disconnection failed
                        call.resolve(["success": false, "error": "Failed to disconnect from the desired network"])
                    } else {
                        // Successfully disconnected or was not connected to "bushnet"
                        call.resolve(["success": true, "data": "disconnected"])
                    }
                    // Clean up any reference to the call if necessary
                    bridge.releaseCall(withID: call.callbackId)
                }
            } else {
                // Fallback for earlier versions of iOS
                guard let interfaceNames = CNCopySupportedInterfaces() else {
                    call.resolve(["success": false, "error": "No interfaces found"])
                    bridge.releaseCall(withID: call.callbackId)
                    return
                }
                guard let swiftInterfaces = (interfaceNames as NSArray) as? [String] else {
                    call.resolve(["success": false, "error": "No interfaces found"])
                    bridge.releaseCall(withID: call.callbackId)
                    
                    return
                }
                for name in swiftInterfaces {
                    guard let info = CNCopyCurrentNetworkInfo(name as CFString) as? [String: AnyObject] else {
                        call.resolve(["success": false, "error": "Did not connect to the desired network"])
                        bridge.releaseCall(withID: call.callbackId)
                        return
                    }
                    
                    guard let ssid = info[kCNNetworkInfoKeySSID as String] as? String else {
                        call.resolve(["success": false, "error": "Did not connect to the desired network"])
                        bridge.releaseCall(withID: call.callbackId)
                        return
                    }
                    if ssid.contains("bushnet") {
                        // The device is still connected to "bushnet", meaning disconnection failed
                        call.resolve(["success": false, "error": "Failed to disconnect from the desired network"])
                    } else {
                        // Successfully disconnected or was not connected to "bushnet"
                        call.resolve(["success": true, "data": "disconnected"])
                    }
                }
                bridge.releaseCall(withID: call.callbackId)
            }
        }
    }

    @objc private func checkCurrentConnection(completion: @escaping (Bool) -> Void) {
            if #available(iOS 14.0, *) {
                NEHotspotNetwork.fetchCurrent { (currentConfiguration) in
                    let isConnected = currentConfiguration?.ssid == "bushnet"
                    completion(isConnected)
                }
            } else {
                // Fallback for iOS 13 and earlier
                guard let interfaceNames = CNCopySupportedInterfaces() as? [String] else {
                    completion(false)
                    return
                }
                
                for name in interfaceNames {
                    guard let info = CNCopyCurrentNetworkInfo(name as CFString) as? [String: Any],
                          let ssid = info[kCNNetworkInfoKeySSID as String] as? String else {
                        continue
                    }
                    
                    if ssid == "bushnet" {
                        completion(true)
                        return
                    }
                }
                
                completion(false)
            }
        }
    
    @objc func checkIsAPConnected(_ call: CAPPluginCall) {
        checkCurrentConnection { isConnected in
            call.resolve(["connected": isConnected])
        }
    }


    @objc func turnOnModem(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.turnOnModem(call: pluginCall(call: call))
        }
    }
    
    @objc func reregisterDevice(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.reregister(call: pluginCall(call: call))
        }
    }
    
    
    @objc func getDeviceInfo(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.getDeviceInfo(call: pluginCall(call: call))
        }
    }
    
    @objc func setDeviceConfig(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.setDeviceConfig(call: pluginCall(call: call))
        }
    }
    
    @objc func getDeviceConfig(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.getDeviceConfig(call: pluginCall(call: call))
        }
    }
    
    @objc func getDeviceLocation(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.getDeviceLocation(call: pluginCall(call: call))
        }
    }
    
    @objc func setDeviceLocation(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.setDeviceLocation(call: pluginCall(call: call))
        }
    }

    @objc func getRecordings(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.getRecordings(call: pluginCall(call: call))
        }
    }
    
    @objc func getEvents(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.getEvents(call: pluginCall(call: call))
        }
    }
    @objc func deleteEvents(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.deleteEvents(call: pluginCall(call: call))
        }
    }
    @objc func getEventKeys(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.getEventKeys(call: pluginCall(call: call))
        }
    }
    
    @objc func downloadRecording(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.downloadRecording(call: pluginCall(call: call))
        }
    }
    
    @objc func deleteRecording(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.deleteRecording(call: pluginCall(call: call))
        }
    }
    
    @objc func deleteRecordings(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.deleteRecordings(call: pluginCall(call: call))
        }
    }

    @objc func updateRecordingWindow(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.updateRecordingWindow(call: pluginCall(call: call))
        }
    }
    
    @objc func setLowPowerMode(_ call: CAPPluginCall) {
        DispatchQueue.global().async { [weak self] in
            self?.device.setLowPowerMode(call: pluginCall(call: call))
        }
    }
    
    @objc func unbindConnection(_ call: CAPPluginCall) {
        call.resolve()
    }
    
    @objc func rebindConnection(_ call: CAPPluginCall) {
        call.resolve()
    }
    
    @objc func hasConnection(_ call: CAPPluginCall) {
        if #available(iOS 14.0, *) {
            NEHotspotNetwork.fetchCurrent { (currentConfiguration) in
                if let currentSSID = currentConfiguration?.ssid, currentSSID == "bushnet" {
                    // Successfully connected to the desired network
                    call.resolve(["success": true, "data": "connected"])
                } else {
                    // The device might have connected to a different network
                    call.resolve(["success": false, "error": "Did not connect to the desired network"])
                }
            }
        } else {
            // Fallback on earlier versions
            call.resolve(["success": true, "data": "default"])
        }
    }
}
