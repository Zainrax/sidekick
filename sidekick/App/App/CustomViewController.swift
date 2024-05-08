//
//  CustomViewController.swift
//  App
//
//  Created by Patrick Baxter on 2/05/24.
//

import UIKit
import Capacitor

class CustomViewController: CAPBridgeViewController {
    override open func viewDidLoad() {
            super.viewDidLoad()
            self.becomeFirstResponder()
            loadWebView()
    }
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DevicePlugin())
        bridge?.registerPluginInstance(CacophonyPlugin())
    }
}
