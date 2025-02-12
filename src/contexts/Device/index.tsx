import { KeepAwake } from "@capacitor-community/keep-awake";
import {
  HttpResponse,
  PluginListenerHandle,
  registerPlugin,
} from "@capacitor/core";
import { CapacitorHttp } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { Geolocation } from "@capacitor/geolocation";
import { createContextProvider } from "@solid-primitives/context";
import { ReactiveMap } from "@solid-primitives/map";
import { debounce, leading } from "@solid-primitives/scheduled";
import { ReactiveSet } from "@solid-primitives/set";
import {
  createEffect,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { z } from "zod";
import { GoToPermissions } from "~/components/GoToPermissions";
import { Location } from "~/database/Entities/Location";
import { Result, URL } from "..";
import { useStorage } from "../Storage";
import { isWithinRange } from "../Storage/location";
import DeviceCamera from "./Camera";
import { Effect } from "effect";
import { useLogsContext } from "../LogsContext";
import { useSearchParams } from "@solidjs/router";
import { useUserContext } from "../User";
import { Network } from "@capacitor/network";

const WifiNetwork = z
  .object({
    SSID: z.string(),
    Quality: z.string(),
    "Signal Level": z.string().optional(),
    Security: z.string().optional(),
  })
  .transform((val) => {
    // Quality is a string of the form "xx/70" where xx is the signal level
    const quality = Math.round((parseInt(val.Quality) / 70) * 100);
    const isSecured = !val.Security || val.Security !== "Unknown";
    return {
      SSID: val.SSID,
      quality,
      signalLevel: val["Signal Level"],
      isSecured,
    };
  });
export type WifiNetwork = z.infer<typeof WifiNetwork>;
export const asInt = z
  .union([z.string(), z.number()])
  .transform((val) => (typeof val === "string" ? parseInt(val) : val));
export const tc2ModemSchema = z
  .object({
    failedToFindModem: z.boolean().optional(),
    failedToFindSimCard: z.boolean().optional(),
    modem: z
      .object({
        connectedTime: z.string(),
        manufacturer: z.string(),
        model: z.string(),
        name: z.string(),
        netdev: z.string(),
        serial: z.string(),
        // parse as number even if it's a string
        temp: asInt,
        vendor: z.string(),
        voltage: asInt,
        apn: z.string().optional(),
      })
      .partial(),
    onOffReason: z.string(),
    powered: z.boolean(),
    signal: z
      .object({
        accessTechnology: z.string(),
        band: z.string(),
        provider: z.string(),
        strength: z.string(),
      })
      .partial()
      .optional(),
    simCard: z
      .object({
        ICCID: z.string(),
        provider: z.string(),
        simCardStatus: z.string(),
      })
      .partial()
      .optional(),
    timestamp: z.string(),
  })
  .partial();
export type Modem = z.infer<typeof tc2ModemSchema>;

const AudioModeSchema = z.union([
  z.literal("Disabled" as const),
  z.literal("AudioOnly" as const),
  z.literal("AudioOrThermal" as const),
  z.literal("AudioAndThermal" as const),
]);

const AudioStatusSchema = z.union([
  z.literal(1).transform(() => "ready" as const),
  z.literal(2).transform(() => "pending" as const),
  z.literal(3).transform(() => "recording" as const),
  z.literal(4).transform(() => "busy" as const),
]);
const AudioModeResSchema = z.object({
  ["audio-mode"]: AudioModeSchema,
});
const AudioStatusResSchema = z.object({
  mode: z.union([
    z.literal(0).transform(() => "Disabled" as const),
    z.literal(1).transform(() => "AudioOnly" as const),
    z.literal(2).transform(() => "AudioOrThermal" as const),
    z.literal(3).transform(() => "AudioAndThermal" as const),
  ]),
  status: AudioStatusSchema,
});
export type AudioMode = z.infer<typeof AudioModeSchema>;
export type DeviceId = string;
export type DeviceName = string;
export type DeviceHost = string;
export type DeviceType = "pi" | "tc2";
export type DeviceUrl = { url: string };
export type RecordingName = string;

export type DeviceDetails = {
  id: DeviceId;
  saltId?: string;
  host: DeviceHost;
  name: DeviceName;
  group: string;
  endpoint: string;
  isProd: boolean;
  timeFound: Date;
  locationSet: boolean;
  url: string;
  type: "pi" | "tc2";
  hasAudioCapabilities: boolean;
  lastUpdated?: Date;
  batteryPercentage?: string;
};

type DeviceCoords<T extends string | number> = {
  latitude: T;
  longitude: T;
  altitude: T;
  accuracy: T;
  timestamp: string;
};

export type ConnectedDevice = DeviceDetails & {
  isConnected: true;
};

export type DisconnectedDevice = DeviceDetails & {
  isConnected: false;
};

export type Device = ConnectedDevice | DisconnectedDevice;

type DeviceService = {
  host: string;
  endpoint: string;
};

export interface DevicePlugin {
  addListener(
    call: "onServiceResolved",
    callback: (res: DeviceService) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    call: "onServiceResolveFailed",
    callback: (res: {
      endpoint: string;
      message: string;
      errorCode: string;
    }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    call: "onServiceLost",
    callback: (res: { endpoint: string }) => void
  ): Promise<PluginListenerHandle>;
  connectToDeviceAP(): Promise<{
    status: "connected" | "disconnected" | "error";
    error?: string;
  }>;
  discoverDevices(): Promise<void>;
  stopDiscoverDevices(): Promise<void>;
  checkDeviceConnection(options: DeviceUrl): Result;
  getDeviceInfo(options: DeviceUrl): Result<string>;
  getDeviceConfig(options: DeviceUrl): Result<string>;
  setDeviceConfig(options: {
    url: string;
    section: string;
    // JSON string
    config: string;
  }): Result<string>;
  setLowPowerMode(options: DeviceUrl & { enabled: string }): Result;
  updateRecordingWindow(
    options: DeviceUrl & { on: string; off: string }
  ): Result;
  checkIsAPConnected(): Promise<{ connected: boolean }>;
  getDeviceLocation(options: DeviceUrl): Result<string>;
  setDeviceLocation(options: DeviceUrl & DeviceCoords<string>): Result;
  getRecordings(options: DeviceUrl): Result<string[]>;
  getEventKeys(options: DeviceUrl): Result<number[]>;
  getEvents(options: DeviceUrl & { keys: string }): Result<string>;
  deleteEvents(options: DeviceUrl & { keys: string }): Result;
  deleteRecording(options: { recordingPath: string }): Result;
  deleteRecordings(): Result;
  downloadRecording(
    options: DeviceUrl & { recordingPath: string }
  ): Result<{ path: string; size: number }>;
  disconnectFromDeviceAP(): Promise<Result<"disconnected">>;
  reregisterDevice(
    options: DeviceUrl & { group: string; device: string }
  ): Result;
  updateWifi(options: DeviceUrl & { ssid: string; password: string }): Result;
  // rebind & unbind are used when trying to use the phone's internet connection
  turnOnModem(options: DeviceUrl & { minutes: string }): Result;
  hasConnection(): Result;
  getTestText(): Promise<{ text: string }>;
  checkPermissions(): Promise<{ granted: boolean }>;
}

export const DevicePlugin = registerPlugin<DevicePlugin>("Device");

const DeviceInfoSchema = z.object({
  serverURL: z.string(),
  groupname: z.string(),
  devicename: z.string(),
  deviceID: z.number(),
  saltID: z.string().optional(),
  type: z.literal("pi").or(z.literal("tc2")).or(z.literal("")).nullish(),
  lastUpdated: z.string().optional(),
});
type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

const [DeviceProvider, useDevice] = createContextProvider(() => {
  const storage = useStorage();
  const log = useLogsContext();
  const user = useUserContext();

  const devices = new ReactiveMap<DeviceId, Device>();
  const deviceRecordings = new ReactiveMap<DeviceId, RecordingName[] | null>();
  const deviceEventKeys = new ReactiveMap<DeviceId, number[]>();
  const [connectingToDevice, setConnectingToDevice] = createSignal<string[]>(
    []
  );

  const locationBeingSet = new ReactiveSet<string>();
  const devicesDownloading = new ReactiveSet<DeviceId>();

  const [listeners, setListeners] = createSignal<PluginListenerHandle[]>([]);
  const [isDiscovering, setIsDiscovering] = createSignal(false);

  const setCurrRecs = async (device: ConnectedDevice) =>
    deviceRecordings.set(device.id, await getRecordings(device));
  const setCurrEvents = async (device: ConnectedDevice) =>
    deviceEventKeys.set(device.id, await getEventKeys(device));

  const clearUploaded = async (device: ConnectedDevice) => {
    debugger;
    if (devicesDownloading.has(device.id)) return;
    await deleteUploadedRecordings(device);
    await deleteUploadedEvents(device);
    await setCurrRecs(device);
    await setCurrEvents(device);
  };

  // Regularly Poll recordings and events to clear uploaded
  const CLEAR_UPLOADED_INTERVAL = 3000; // 5 seconds
  onMount(() => {
    const interval = setInterval(async () => {
      await Promise.all(
        devices
          .values()
          .filter((d) => d.isConnected)
          .map(clearUploaded)
      );
    }, CLEAR_UPLOADED_INTERVAL);
    onCleanup(() => {
      clearInterval(interval);
    });
  });

  // Function to fetch device info from a URL
  const fetchDeviceInfo = async (url: string): Promise<DeviceInfo> => {
    try {
      const infoRes = await Effect.runPromise(
        Effect.retry(
          Effect.tryPromise<HttpResponse>(() =>
            CapacitorHttp.get({
              url: `${url}/api/device-info`,
              headers,
              webFetchExtra: {
                credentials: "include",
              },
            })
          ),
          { times: 3 }
        )
      );

      if (!infoRes || infoRes.status !== 200) {
        throw new Error(
          `Could not get device info from ${url}, status: ${infoRes?.status}`
        );
      }

      const info = DeviceInfoSchema.parse(JSON.parse(infoRes.data));
      return info;
    } catch (error) {
      throw new Error(`Failed to fetch device info from ${url}: ${error}`);
    }
  };

  // Function to create a device object from a URL
  const createDevice = async (url: string) => {
    if (!url) throw new Error("No URL provided to create device");

    try {
      const info = await fetchDeviceInfo(url);
      const id: DeviceId = info.deviceID.toString();
      debugger;
      const type = info.type || "pi";

      return {
        id,
        saltId: info.saltID,
        name: info.devicename || "New Device",
        group: info.groupname,
        type,
        isProd: !info.serverURL.includes("test"),
        locationSet: false,
        timeFound: new Date(),
        url,
        isConnected: true as const,
        lastUpdated: info.lastUpdated ? new Date(info.lastUpdated) : undefined,
      };
    } catch (error) {
      throw new Error(`Could not create device from URL ${url}: ${error}`);
    }
  };

  // Function to convert an endpoint and host to a connected device
  const endpointToDevice = async (
    endpoint: string,
    host: string
  ): Promise<ConnectedDevice | undefined> => {
    try {
      const [deviceName] = endpoint.split(".");
      const url1 = `http://${deviceName}.local`;
      const url2 = `http://${host}`;

      const device = await Promise.any([
        createDevice(url1),
        createDevice(url2),
      ]);
      console.log("Creating Device", device);

      if (!device) throw new Error("Failed to connect to device");

      const batteryPercentage = await getBattery(device.url);
      const hasAudio = await hasAudioCapabilities(device.url);

      return {
        ...device,
        host,
        endpoint,
        batteryPercentage: batteryPercentage?.mainBattery,
        hasAudioCapabilities: hasAudio,
      };
    } catch (error) {
      console.error("Error in endpointToDevice:", error);
      return undefined;
    }
  };

  // Function to manage modem intervals for devices
  const manageModemIntervals = () => {
    const modemOnIntervals = new ReactiveMap<DeviceId, NodeJS.Timeout>();

    createEffect(
      on(
        () => devices,
        (devicesMap) => {
          for (const device of devicesMap.values()) {
            const interval = modemOnIntervals.get(device.id);

            if (device.isConnected) {
              if (!interval) {
                const id = setInterval(() => {
                  DevicePlugin.turnOnModem({ url: device.url, minutes: "5" });
                }, 300000); // Every 5 minutes
                modemOnIntervals.set(device.id, id);
              }
            } else {
              if (interval) {
                clearInterval(interval);
                modemOnIntervals.delete(device.id);
              }
            }
          }
        }
      )
    );
  };

  // Function to check if we should attempt to connect to a new device
  const shouldConnectToDevice = (newDevice: DeviceService): boolean => {
    if (!newDevice) return false;

    const existingDevice = [...devices.values()].find(
      (d) => d.endpoint === newDevice.endpoint && d.host === newDevice.host
    );

    if (existingDevice && existingDevice.isConnected) return false;
    if (connectingToDevice().includes(newDevice.endpoint)) return false;

    return true;
  };

  // Function to connect to a device
  const connectToDevice = async (newDevice: DeviceService) => {
    setConnectingToDevice((prev) => [...prev, newDevice.endpoint]);

    try {
      const connectedDevice = await Effect.runPromise(
        Effect.retry(
          Effect.tryPromise<ConnectedDevice | undefined>(() =>
            endpointToDevice(newDevice.endpoint, newDevice.host)
          ),
          { times: 3 }
        )
      );

      if (connectedDevice) {
        await addConnectedDevice(connectedDevice);
        return connectedDevice;
      }
    } catch (error) {
      log.logError({
        error,
        message: `Unable to connect to discovered device: ${JSON.stringify(
          newDevice
        )}`,
      });
    } finally {
      setConnectingToDevice((prev) =>
        prev.filter((d) => d !== newDevice.endpoint)
      );
    }
  };

  // Function to handle when a service is resolved (device discovered)
  const handleServiceResolved = async (newDevice: DeviceService) => {
    console.log("Found Device", newDevice);
    if (shouldConnectToDevice(newDevice)) {
      console.log("Connecting to device", newDevice);
      const device = await connectToDevice(newDevice);
      const userData = user.data();
      if (device?.isConnected && userData?.token && apState() !== "connected") {
        try {
          // First check the existing device type
          const typeRes = await CapacitorHttp.get({
            url: `${user.getServerUrl()}/api/v1/devices/${device.id}/type`,
            headers: {
              Authorization: userData.token,
            },
          });

          const settingsRes = await CapacitorHttp.get({
            url: `${user.getServerUrl()}/api/v1/devices/${device.id}/settings`,
            headers: {
              Authorization: userData.token,
            },
          });
          console.log("Settings", settingsRes.data);

          const typeData = z
            .object({ type: deviceTypes.optional() })
            .safeParse(typeRes.data);
          const currentType = typeData.success ? typeData.data.type : undefined;

          // Only update if type is unknown/undefined or if it was thermal but now has audio
          if (
            !currentType ||
            currentType === "unknown" ||
            (currentType === "thermal" && device.hasAudioCapabilities)
          ) {
            const deviceLocation = await getLocationCoords(device.id);
            const updateData = {
              type: device.hasAudioCapabilities
                ? "hybrid-thermal-audio"
                : "thermal",
              ...(deviceLocation.success && {
                location: {
                  lat: deviceLocation.data.latitude,
                  lng: deviceLocation.data.longitude,
                },
              }),
            };

            await CapacitorHttp.post({
              url: `${user.getServerUrl()}/api/v1/devices/${
                device.id
              }/settings`,
              headers: {
                Authorization: userData.token,
                "Content-Type": "application/json",
              },
              data: updateData,
            });
          }
        } catch (error) {
          console.error("Error updating device type:", error);
        }
      }
      return device;
    }
    console.log("Not connecting to device", newDevice);
    return undefined;
  };

  // Function to remove a device by its saltId
  const removeDeviceBySaltId = (saltId: string) => {
    for (const device of devices.values()) {
      if (!device.isConnected && device.saltId === saltId) {
        devices.delete(device.id);
        break;
      }
    }
  };

  // Function to add a connected device to the devices map
  const addConnectedDevice = async (connectedDevice: ConnectedDevice) => {
    if (connectedDevice.saltId) {
      removeDeviceBySaltId(connectedDevice.saltId);
    }
    devices.set(connectedDevice.id, connectedDevice);

    log.logEvent("device_found", {
      name: connectedDevice.name,
      saltId: connectedDevice.saltId,
      group: connectedDevice.group,
    });

    await clearUploaded(connectedDevice); // Assume clearUploaded is defined elsewhere
    await turnOnModem(connectedDevice.id); // Assume turnOnModem is defined elsewhere
  };

  // Function to handle when a service is lost (device disconnected)
  const handleServiceLost = (lostDevice: { endpoint: string }) => {
    const device = [...devices.values()].find(
      (d) => d.endpoint === lostDevice.endpoint && d.isConnected
    );

    if (device) {
      devices.set(device.id, {
        ...device,
        isConnected: false,
      });

      log.logEvent("device_lost", {
        name: device.name,
        saltId: device.saltId,
        group: device.group,
      });
    }
  };

  const handleServiceResolvedFailed = (service: {
    errorCode: string;
    endpoint: string;
    message: string;
  }) => {
    console.log("FAILED SERVICE", service);
    log.logWarning({
      message:
        "Found device but was unable to connect. Please restart the device or contact support if it persists.",
      details: `${service.endpoint} - Error Code: ${service.errorCode} - Details: ${service.message}`,
      warn: true,
    });
  };

  const [checkingAP, setCheckingAP] = createSignal(false);
  const monitorAPConnection = () => {
    return setInterval(async () => {
      if (checkingAP()) return;
      setCheckingAP(true);

      try {
        // Try multiple times to get a reliable connection status
        let isConnected = false;
        for (let i = 0; i < AP_CHECK_RETRIES; i++) {
          const res = await DevicePlugin.checkIsAPConnected();
          if (res.connected) {
            isConnected = true;
            break;
          }
          // Wait before retry
          if (i < AP_CHECK_RETRIES - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, AP_CHECK_RETRY_DELAY)
            );
          }
        }

        // Only update state if there's a definitive change
        if (isConnected && apState() !== "loadingDisconnect") {
          setApState("connected");
        } else if (!isConnected && apState() !== "loadingConnect") {
          // Additional verification before setting to default
          const hasConnectedDevices = [...devices.values()].some(
            (d) => d.isConnected
          );

          // Only set to default if we're really sure we're disconnected
          if (!hasConnectedDevices) {
            setApState("default");
          }
        }
      } catch (error) {
        log.logError({
          message: "Error checking AP connection",
          error,
        });
      } finally {
        setCheckingAP(false);
      }
    }, 10000); // Every 10 seconds
  };

  const setupListeners = async () => {
    const serviceResolvedListener = await DevicePlugin.addListener(
      "onServiceResolved",
      handleServiceResolved
    );
    const serviceResolveFailedListener = await DevicePlugin.addListener(
      "onServiceResolveFailed",
      handleServiceResolvedFailed
    );
    const serviceLostListener = await DevicePlugin.addListener(
      "onServiceLost",
      handleServiceLost
    );

    setListeners([
      serviceResolvedListener,
      serviceLostListener,
      serviceResolveFailedListener,
    ]);
  };

  // Function to remove all event listeners
  const removeAllListeners = () => {
    listeners().forEach((listener) => listener.remove());
    setListeners([]);
  };

  // Function to clean up listeners
  const cleanupListeners = () => {
    removeAllListeners();
  };

  // Function to clear old devices that haven't been connected for a while
  const clearOldDevices = () => {
    const now = Date.now();
    for (const device of devices.values()) {
      const timeDiff = now - device.timeFound.getTime();
      // If the device hasn't been connected for more than 3 minutes
      if (!device.isConnected && timeDiff > 60 * 1000 * 1) {
        devices.delete(device.id);
      }
    }
  };

  // Function to get device info
  const getDeviceInfo = (url: string) =>
    Effect.tryPromise({
      try: () => DevicePlugin.getDeviceInfo({ url }),
      catch: (unknown) =>
        new Error(`Could not get device information: ${unknown}`),
    });

  const [searchParams, setSearchParams] = useSearchParams();
  // Function to check if a device is still connected
  const CONNECTION_CHECK_INTERVAL = 15000; // 15 seconds
  const CONNECTION_RETRY_ATTEMPTS = 5;
  const CONNECTION_RETRY_DELAY = 2000; // 2 seconds
  const DISCOVERY_INTERVAL = 30000; // 30 seconds

  const checkDeviceConnection = async (device: Device) => {
    let attempts = 0;
    const tryConnection = async (): Promise<ConnectedDevice | undefined> => {
      try {
        // First verify physical connection
        const pingResult = await CapacitorHttp.get({
          url: `${device.url}/api/ping`,
          headers,
          webFetchExtra: { credentials: "include" },
          connectTimeout: 3000,
        });

        if (pingResult.status === 200) {
          // Then verify API status
          const deviceInfo = await Effect.runPromise(
            Effect.retry(getDeviceInfo(device.url), {
              times: CONNECTION_RETRY_ATTEMPTS,
              delay: CONNECTION_RETRY_DELAY,
            })
          );

          if (deviceInfo.success) {
            const data = JSON.parse(deviceInfo.data);
            const info = DeviceInfoSchema.safeParse(data);
            console.log("Device Info", info);

            if (info.success) {
              const battery = await getBattery(device.url);
              const hasAudio = await hasAudioCapabilities(device.url);
              return {
                ...device,
                id: info.data.deviceID.toString(),
                name: info.data.devicename,
                lastUpdated: info.data.lastUpdated
                  ? new Date(info.data.lastUpdated)
                  : device.lastUpdated,
                batteryPercentage: battery?.mainBattery,
                isConnected: true,
                hasAudioCapabilities: hasAudio,
              };
            }
          }
          return undefined;
        }
      } catch (error) {
        if (attempts < CONNECTION_RETRY_ATTEMPTS) {
          attempts++;
          await new Promise((resolve) =>
            setTimeout(resolve, CONNECTION_RETRY_DELAY)
          );
          return tryConnection();
        }
        return undefined;
      }
    };

    const updatedDevice = await tryConnection();
    if (updatedDevice) {
      if (updatedDevice.id !== device.id) {
        devices.delete(device.id);
        if (searchParams.deviceSettings === device.id) {
          setSearchParams({ deviceSettings: updatedDevice.id });
        } else if (searchParams.setupDevice === device.id) {
          setSearchParams({ setupDevice: updatedDevice.id });
        }
      }
      devices.set(updatedDevice.id, updatedDevice);
      return updatedDevice;
    }

    // Only mark as disconnected if we're sure
    if (device.isConnected) {
      devices.set(device.id, { ...device, isConnected: false });
      log.logEvent("device_disconnected", {
        name: device.name,
        saltId: device.saltId,
        group: device.group,
      });
    }
    return undefined;
  };

  const hasAudioCapabilities = async (url: string) => {
    try {
      const res = await getAudioMode(url);
      if (res !== null) return true;
    } catch (error) {
      console.error(error);
      return false;
    }
    return false;
  };

  // Function to start device discovery
  const startDiscovery = async () => {
    try {
      await DevicePlugin.discoverDevices();
      setIsDiscovering(true);
    } catch (e) {
      console.error("Already discovering devices");
      setIsDiscovering(false);
      return;
    }

    try {
      clearOldDevices();

      // Check device connections
      for (const device of devices.values()) {
        await checkDeviceConnection(device);
      }
    } catch (error) {
      log.logError({
        error,
        message: "Error during device discovery",
        warn: false,
      });
    }
  };

  // Function to stop device discovery
  const stopDiscovery = async () => {
    try {
      await DevicePlugin.stopDiscoverDevices();
    } catch (e) {
      console.error("No listeners registered, registering new listeners", e);
      if (e instanceof Error && e.message.includes("listener not registered")) {
        await setupListeners();
      }
      console.error("Error stopping discovery:", e);
    }
  };

  let isSearching = false;
  // Function to search for devices, debounced to avoid excessive calls
  const searchDevice = async () => {
    if (isSearching) return;
    try {
      isSearching = true;
      await stopDiscovery();
      await startDiscovery();
      for (const device of devices.values()) {
        if (device.isConnected) {
          await clearUploaded(device); // Assume clearUploaded is defined elsewhere
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      isSearching = false;
    }
  };

  // Initialize modem intervals management
  manageModemIntervals();

  // Set up component lifecycle
  onMount(async () => {
    await setupListeners();
    const monitorInterval = monitorAPConnection();
    await searchDevice();

    onCleanup(() => {
      clearInterval(monitorInterval);
      cleanupListeners();
    });
  });

  const Authorization = "Basic YWRtaW46ZmVhdGhlcnM=";
  const headers = { Authorization: Authorization };

  const getRecordings = async (
    device: ConnectedDevice
  ): Promise<string[] | null> => {
    try {
      if ((await Filesystem.checkPermissions()).publicStorage === "denied") {
        const permission = await Filesystem.requestPermissions();
        if (permission.publicStorage === "denied") {
          return null;
        }
      }
      const { url } = device;
      const res = await DevicePlugin.getRecordings({ url });
      const audioRes = await fetch(`${url}/api/audio/recordings`, {
        method: "GET",
        headers,
      });
      const thermalRecordings = res.success ? res.data : [];
      const audioRecordings = audioRes.ok
        ? (await audioRes.json().catch(() => [])) ?? []
        : [];
      return [...thermalRecordings, ...audioRecordings];
    } catch (error) {
      log.logError({
        message: "Could not get recordings",
        error,
      });
      return null;
    }
  };

  const deleteUploadedRecordings = async (device: ConnectedDevice) => {
    try {
      const { url } = device;
      const currDeviceRecordings = await getRecordings(device);
      const savedRecordings = await storage.getSavedRecordings({
        device: device.id,
      });
      for (const rec of savedRecordings) {
        if (currDeviceRecordings?.includes(rec.name)) {
          if (rec.isUploaded) {
            const res: HttpResponse = await CapacitorHttp.delete({
              url: `${url}/api/recording/${rec.name}`,
              headers,
              webFetchExtra: {
                credentials: "include",
              },
            });
            if (res.status !== 200) continue;
            await storage.deleteRecording(rec);
          } else {
            continue;
          }
        } else {
          await storage.deleteRecording(rec);
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        log.logError({
          message: "Could not delete recordings",
          error,
        });
      } else {
        log.logWarning({
          message: "Could not delete recordings",
          details: JSON.stringify(error),
        });
      }
    }
  };

  const saveRecordings = async (device: ConnectedDevice) => {
    const recs = deviceRecordings.get(device.id);
    const savedRecs = storage.savedRecordings();
    debugger;
    if (!recs) return;
    const nonSavedRecs = recs.filter(
      (r) => !savedRecs.find((s) => s.name === r && s.device === device.id)
    );
    debugger;
    if (!nonSavedRecs.length) return;
    // Filter out recordings that have already been saved
    for (const rec of nonSavedRecs) {
      // Added to allow for pause functionality
      if (!devicesDownloading.has(device.id)) return;
      const res = await DevicePlugin.downloadRecording({
        url: device.url,
        recordingPath: rec,
      });
      if (!res.success) {
        log.logWarning({
          message: "Could not download recording",
          details: res.message,
          warn: false,
        });
        continue;
      }
      const data = await storage?.saveRecording({
        ...device,
        filename: rec,
        path: res.data.path,
        size: res.data.size,
        isProd: device.isProd,
      });
      if (!data) continue;
    }
    await setCurrRecs(device);
    const recordings = storage
      .savedRecordings()
      .filter((rec) => rec.device === device.id && !rec.isUploaded);
    if (recordings) {
      saveRecordings(device);
    }
  };

  const getEventKeys = async (device: ConnectedDevice) => {
    try {
      const { url } = device;
      const res = await DevicePlugin.getEventKeys({ url });
      if (!res.success) return [];
      const events = res.data;
      return events;
    } catch (error) {
      if (error instanceof Error) {
        log.logError({
          message: "Could not get events",
          details: error.message,
          error,
        });
      }
      return [];
    }
  };

  const deleteUploadedEvents = async (device: ConnectedDevice) => {
    debugger;
    try {
      const { url } = device;
      const currEvents = await getEventKeys(device);
      const savedEvents = await storage.getSavedEvents({
        device: device.id,
      });
      const eventsToDel = savedEvents.filter(
        (event) => currEvents.includes(Number(event.key)) && event.isUploaded
      );
      const keys = eventsToDel.map((event) => Number(event.key));
      if (keys.length !== 0) {
        const res = await DevicePlugin.deleteEvents({
          url,
          keys: JSON.stringify(keys),
        });
        if (!res.success) return;
      }
      // Delete events if they are not on the device, or if they were deleted on the device
      const deletedEvents = [
        ...savedEvents.filter(
          (event) => !currEvents.includes(Number(event.key))
        ),
        ...eventsToDel,
      ];
      await storage.deleteEvents({ events: deletedEvents });
    } catch (error) {
      log.logError({
        message: "Could not delete events",
        error,
      });
    }
  };

  // Zod schema for event, is an object with a key as a number and a value is an object with
  // {event: {Type: string, Details: object, Timestamp: string}, success: boolean}
  const eventSchema = z.record(
    z.string(),
    z.object({
      event: z.object({
        Type: z.string(),
        Timestamp: z.string(),
        Details: z.any(),
      }),
      success: z.boolean(),
    })
  );

  const getEvents = async (device: ConnectedDevice, keys: number[]) => {
    try {
      const { url } = device;
      const res = await DevicePlugin.getEvents({
        url,
        keys: JSON.stringify(keys),
      });
      if (!res.success) return [];
      const json = JSON.parse(res.data);
      const events = eventSchema.safeParse(json);
      if (!events.success) return [];
      // map over the events and add the device id to the event
      const eventsWithDevice = Object.entries(events.data).map(
        ([key, value]) => ({
          ...value.event,
          key,
          device: device.id,
          isProd: device.isProd,
        })
      );
      return eventsWithDevice;
    } catch (error) {
      log.logError({
        message: "Could not get events",
        error,
      });
      return [];
    }
  };

  const saveEvents = async (device: ConnectedDevice) => {
    const eventKeys = await getEventKeys(device);
    deviceEventKeys.set(device.id, eventKeys);
    if (!eventKeys) return;
    const savedEvents = storage.savedEvents();
    const events = await getEvents(
      device,
      eventKeys.filter(
        (key) => !savedEvents.find((event) => event.key === key.toString())
      )
    );
    for (const event of events) {
      storage?.saveEvent({
        key: parseInt(event.key),
        device: device.id,
        isProd: device.isProd,
        type: event.Type,
        timestamp: event.Timestamp,
        details: JSON.stringify(event.Details),
      });
    }
  };

  const saveItems = async (deviceId: DeviceId) => {
    const device = devices.get(deviceId);
    if (!device || !device.isConnected) return;
    const { id } = device;
    const isSupported = await KeepAwake.isSupported();
    if (isSupported) {
      await KeepAwake.keepAwake();
    }
    devicesDownloading.add(id);
    await Promise.all([setCurrRecs(device), setCurrEvents(device)]);
    await Promise.all([saveRecordings(device), saveEvents(device)]);
    log.logSuccess({
      message: `Successfully saved recordings and events for ${device.name}.`,
    });
    devicesDownloading.delete(id);
    if (isSupported) {
      await KeepAwake.allowSleep();
    }
  };

  const stopSaveItems = async (deviceId: DeviceId) => {
    devicesDownloading.delete(deviceId);
  };

  const locationSchema = z.object({
    latitude: z.number().transform((val) => val.toString()),
    longitude: z.number().transform((val) => val.toString()),
    altitude: z.number().transform((val) => val.toString()),
    accuracy: z.number().transform((val) => Math.round(val).toString()),
    timestamp: z.number().transform((val) => val.toString()),
  });

  const LOCATION_ERROR =
    "Please ensure location is enabled, and permissions are granted";
  const setDeviceToCurrLocation = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return;
      let permission = await Geolocation.requestPermissions();
      if (permission.location === "prompt-with-rationale") {
        permission = await Geolocation.checkPermissions();
      }
      if (permission.location !== "granted") return;
      locationBeingSet.add(device.id);
      const { timestamp, coords } = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
      });
      const location = locationSchema.safeParse({ ...coords, timestamp });
      if (!location.success) {
        locationBeingSet.delete(device.id);
        log.logWarning({
          message: LOCATION_ERROR,
          details: location.error.message,
        });
        return;
      }
      const options = {
        url: device.url,
        ...location.data,
      };
      const res = await DevicePlugin.setDeviceLocation(options);
      if (res.success) {
        tryUpdateServerLocation(deviceId, {
          lat: parseFloat(location.data.latitude),
          lng: parseFloat(location.data.longitude),
        });
        devices.set(device.id, {
          ...device,
          locationSet: true,
        });
        log.logSuccess({
          message: `Successfully set location for ${device.name}.`,
          timeout: 6000,
        });
      }
      locationBeingSet.delete(device.id);
    } catch (error) {
      if (error instanceof Error) {
        log.logWarning({
          message: LOCATION_ERROR,
          details: error.message,
        });
      }
      locationBeingSet.delete(deviceId);
    }
  };

  const tryUpdateServerLocation = async (
    deviceId: string,
    location: { lat: number; lng: number }
  ) => {
    try {
      const updateData = {
        location,
      };
      const userData = user.data();
      if (userData) {
        const url = user.getServerUrl();
        const setLocationRes = await CapacitorHttp.post({
          url: `${url}/api/v1/devices/${deviceId}/settings`,
          method: "POST",
          headers: {
            Authorization: userData.token,
            "Content-Type": "application/json",
          },
          data: updateData,
        });
      }
    } catch (e) {
      console.error(e);
    }
  };
  const getLocationCoords = async (
    device: DeviceId
  ): Result<DeviceCoords<number>> => {
    try {
      const deviceObj = devices.get(device);

      // If device is not connected, return error.
      if (!deviceObj || !deviceObj.isConnected) {
        return {
          success: false,
          message: "Device is not connected",
        };
      }

      const { url } = deviceObj;

      // Define the shape of the response data.
      const locationSchema = z.object({
        latitude: z.number(),
        longitude: z.number(),
        altitude: z.number(),
        accuracy: z.number(),
        timestamp: z.string(),
      });

      // Make the request to the device.
      const res = await DevicePlugin.getDeviceLocation({ url });
      console.log("Location Response", res);
      // If the request was successful, return the data.
      if (res.success) {
        const location = locationSchema.safeParse(JSON.parse(res.data));
        if (!location.success) {
          return {
            success: false,
            message: location.error.message,
          };
        }
        tryUpdateServerLocation(device, {
          lat: location.data.latitude,
          lng: location.data.longitude,
        });
        return {
          success: true,
          data: location.data,
        };
      } else {
        return {
          success: false,
          message: "Could not get location",
        };
      }
    } catch (error) {
      return {
        success: false,
        message: "Could not get location",
      };
    }
  };

  const getLocationByDevice = (deviceId: DeviceId) =>
    createResource(
      () => [storage.savedLocations(), devices.get(deviceId)] as const,
      async (data): Promise<Location | null> => {
        try {
          const [locations, device] = data;
          if (!device || !locations?.length || !device.isConnected) return null;
          const deviceLocation = await getLocationCoords(device.id);
          if (!deviceLocation.success) return null;
          const sameGroupLocations = locations.filter(
            (loc) =>
              loc.groupName === device.group && loc.isProd === device.isProd
          );
          const location = sameGroupLocations.filter((loc) =>
            isWithinRange(
              [loc.coords.lat, loc.coords.lng],
              [deviceLocation.data.latitude, deviceLocation.data.longitude],
              deviceLocation.data.accuracy
            )
          );

          if (!location.length) return null;
          return location.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0];
        } catch (error) {
          if (error instanceof Error) {
            log.logError({
              message: "Could not get location",
              details: error.message,
              error,
            });
          } else {
            log.logWarning({
              message: "Could not get location",
              details: `${error}`,
            });
          }
          return null;
        }
      }
    );

  const [permission, { refetch: refetchLocationPermission }] = createResource(
    async () => {
      try {
        let permission = await Geolocation.checkPermissions();
        if (
          permission.location === "denied" ||
          permission.location === "prompt" ||
          permission.location === "prompt-with-rationale"
        ) {
          permission = await Geolocation.requestPermissions();
          if (permission.location === "prompt-with-rationale") {
            permission = await Geolocation.checkPermissions();
          }
        }
        return permission.location;
      } catch (e) {
        return "denied";
      }
    }
  );

  const [locationDisabled, setLocationDisabled] = createSignal(false);
  const [devicesLocToUpdate, { refetch: refetchDeviceLocToUpdate }] =
    createResource(
      () => {
        return [[...devices.values()], permission()] as const;
      },
      async ([devices, permission]) => {
        try {
          devices = devices.filter(({ isConnected }) => isConnected);
          if (!devices || devices.length === 0 || !permission) return [];
          if (permission === "denied") return [];
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
          }).catch((e) => {
            console.log("Error", e);
            if (e instanceof Error && e.message === "location disabled") {
              setLocationDisabled(true);
            }
            return null;
          });
          if (!pos) return [];
          setLocationDisabled(false);

          const devicesToUpdate: string[] = [];
          for (const device of devices) {
            if (!device.isConnected) continue;
            const locationRes = await getLocationCoords(device.id);
            if (!locationRes.success) continue;
            const loc = locationRes.data;
            const newLoc: [number, number] = [
              pos.coords.latitude,
              pos.coords.longitude,
            ];

            const withinRange = isWithinRange(
              [loc.latitude, loc.longitude],
              newLoc,
              pos.coords.accuracy
            );
            if (!withinRange) {
              devicesToUpdate.push(device.id);
            }
          }
          return devicesToUpdate;
        } catch (error) {
          if (error instanceof Error) {
            log.logWarning({
              message:
                "Could not update device locations. Check location permissions and try again.",
              action: <GoToPermissions />,
            });
          } else if (typeof error === "string") {
            log.logWarning({
              message: "Could not update device locations",
              details: error,
            });
          }

          return [];
        }
      }
    );

  type DeviceLocationStatus =
    | "loading"
    | "current"
    | "needsUpdate"
    | "unavailable";
  const shouldDeviceUpdateLocation = (
    deviceId: DeviceId
  ): DeviceLocationStatus => {
    const devicesToUpdate = devicesLocToUpdate();
    console.log("Permission", permission());
    if (!devicesToUpdate?.length)
      return permission() === "denied" ? "unavailable" : "current";
    const updateDevice = devicesToUpdate.includes(deviceId)
      ? "needsUpdate"
      : "current";
    console.log("Update Device", updateDevice);
    return updateDevice;
  };
  const getWifiNetworks = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return [];
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/network/wifi`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      if (res.status !== 200) {
        return null;
      }
      const networks = WifiNetwork.array().parse(JSON.parse(res.data));
      return networks
        ? networks
            .filter((network) => network.SSID)
            // remove duplicate networks
            .reduce((acc, curr) => {
              const found = acc.find((a) => a.SSID === curr.SSID);
              if (!found) {
                acc.push(curr);
              }
              return acc;
            }, [] as WifiNetwork[])
        : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const getCurrentWifiNetwork = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/network/wifi/current`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      if (res.status !== 200) return null;
      const network = z
        .object({ SSID: z.string() })
        .safeParse(JSON.parse(res.data));
      return network.success ? network.data : null;
    } catch (error) {
      return null;
    }
  };

  const saveWifiNetwork = async (
    deviceId: DeviceId,
    ssid: string,
    password: string
  ) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      log.logEvent("device_wifi_connect");
      const res = await CapacitorHttp.post({
        url: `${url}/api/network/wifi/save`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
        data: { ssid, password },
      });
      return res.status === 200;
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  const saveAPN = async (deviceId: DeviceId, apn: string) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await CapacitorHttp.post({
        url: `${url}/api/modem/apn`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
        data: { apn },
      });
      return res.status === 200;
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  const AP_CHECK_RETRIES = 3;
  const AP_CHECK_RETRY_DELAY = 20000; // 20 second

  const LimePercent = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
    59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77,
    78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96,
    97, 98, 99, 100,
  ];
  const LimeVoltage = [
    30.0, 30.1, 30.2, 30.4, 30.5, 30.6, 30.7, 30.8, 31.0, 31.1, 31.2, 31.3,
    31.4, 31.6, 31.7, 31.8, 31.9, 32.0, 32.2, 32.3, 32.4, 32.5, 32.6, 32.8,
    32.9, 33.0, 33.1, 33.2, 33.4, 33.5, 33.6, 33.7, 33.8, 34.0, 34.1, 34.2,
    34.3, 34.4, 34.6, 34.7, 34.8, 34.9, 35.0, 35.2, 35.3, 35.4, 35.5, 35.6,
    35.8, 35.9, 36.0, 36.1, 36.2, 36.4, 36.5, 36.6, 36.7, 36.8, 37.0, 37.1,
    37.2, 37.3, 37.4, 37.6, 37.7, 37.8, 37.9, 38.0, 38.2, 38.3, 38.4, 38.5,
    38.6, 38.8, 38.9, 39.0, 39.1, 39.2, 39.4, 39.5, 39.6, 39.7, 39.8, 40.0,
    40.1, 40.2, 40.3, 40.4, 40.6, 40.7, 40.8, 40.9, 41.0, 41.2, 41.3, 41.4,
    41.5, 41.6, 41.8, 41.9, 42.0,
  ];
  function interpolateVoltageToPercentage(
    voltage: number,
    voltageArray: number[],
    percentageArray: number[]
  ): number {
    if (voltage <= voltageArray[0]) return percentageArray[0];
    if (voltage >= voltageArray[voltageArray.length - 1])
      return percentageArray[percentageArray.length - 1];

    for (let i = 0; i < voltageArray.length - 1; i++) {
      if (voltage >= voltageArray[i] && voltage <= voltageArray[i + 1]) {
        const voltageRange = voltageArray[i + 1] - voltageArray[i];
        const percentageRange = percentageArray[i + 1] - percentageArray[i];
        const voltageOffset = voltage - voltageArray[i];
        return (
          percentageArray[i] + (voltageOffset / voltageRange) * percentageRange
        );
      }
    }

    throw new Error("Unable to interpolate voltage to percentage");
  }
  const dataSchema = z
    .object({
      time: z.string(),
      mainBattery: z.string(),
      mainBatteryLow: z.string(),
      rtcBattery: z.string(),
    })
    .transform((data) => ({
      time: new Date(data.time),
      mainBattery: Number(
        interpolateVoltageToPercentage(
          // remove spaces from the string
          Number(data.mainBattery.replace(/\s/g, "")),
          LimeVoltage,
          LimePercent
        )
      ).toFixed(0),
      mainBatteryLow: Number(data.mainBatteryLow),
      rtcBattery: Number(data.rtcBattery),
    }));
  const getBattery = async (url: URL) => {
    try {
      const res = await CapacitorHttp.get({
        url: `${url}/api/battery`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
      });
      console.log("BATTERY", res);
      if (res.status !== 200) return;
      const parsedBattery = dataSchema.safeParse(JSON.parse(res.data)).data;
      console.log("BATTERY", parsedBattery);
      return parsedBattery;
    } catch (e) {
      console.error(e);
      return;
    }
  };

  const devicesConnectingToWifi = new ReactiveMap();
  const disconnectFromWifi = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      log.logEvent("device_wifi_disconnect");
      const res = await CapacitorHttp.delete({
        url: `${url}/api/network/wifi/current`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      return res.status === 200;
    } catch (error) {
      return false;
    }
  };

  const forgetWifi = async (deviceId: DeviceId, ssid: string) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await CapacitorHttp.delete({
        url: `${url}/api/network/wifi/forget`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
        data: { ssid },
      });
      return res.status === 200;
    } catch (error) {
      return false;
    }
  };

  // Connect post req /network/wifi
  const connectToWifi = async (
    deviceId: DeviceId,
    ssid: string,
    password?: string
  ) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      CapacitorHttp.post({
        url: `${url}/api/network/wifi`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
        data: { ssid, password },
        connectTimeout: 10000,
        readTimeout: 10000,
      });
      let tries = 0;
      const connected = await new Promise((resolve) => {
        const interval = setInterval(async () => {
          searchDevice();
          tries++;
          if (tries > 10) {
            clearInterval(interval);
            resolve(false);
            return;
          }
          try {
            const res = await CapacitorHttp.get({
              url: `${url}/api/network/wifi/current`,
              headers,
              webFetchExtra: {
                credentials: "include",
              },
              connectTimeout: 20000,
              readTimeout: 20000,
            });
            if (res.status === 200) {
              resolve(true);
              clearInterval(interval);
            }
          } catch (e) {
            console.error(e);
          }
        }, 5000);
      });
      return connected;
    } catch (error) {
      return false;
    }
  };

  const ConnectionRes = z.object({
    connected: z.boolean(),
  });

  const checkDeviceWifiInternetConnection = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/wifi-check`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      const connection =
        res.status === 200
          ? ConnectionRes.parse(JSON.parse(res.data)).connected
          : res.status === 404
          ? true
          : false;
      return connection;
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  const checkDeviceModemInternetConnection = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/modem-check`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      return ConnectionRes.parse(JSON.parse(res.data)).connected;
    } catch (error) {
      console.error("Connection Error:", error);
      return false;
    }
  };

  const getModem = async (deviceId: DeviceId): Promise<Modem | null> => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/modem`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      return res.status === 200 ? tc2ModemSchema.parse(res.data) : null;
    } catch (error) {
      console.error("Get Modem Error:", error);
      return null;
    }
  };

  const turnOnModem = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await DevicePlugin.turnOnModem({ url, minutes: "5" });
      return res.success;
    } catch (error) {
      console.error("Turn On Error: ", error);
      return false;
    }
  };

  const hasNetworkEndpoints = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await Effect.runPromise(
        Effect.retry(
          Effect.tryPromise<HttpResponse>(() => {
            return CapacitorHttp.get({
              url: `${url}/api/network/wifi/current`,
              headers,
              webFetchExtra: {
                credentials: "include",
              },
            });
          }),
          { times: 3 }
        )
      );
      return res.status === 200;
    } catch (error) {
      return false;
    }
  };

  const getModemSignalStrength = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      let res = await CapacitorHttp.get({
        url: `${url}/api/signal-strength`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      if (res.status !== 200) throw Error("No Modem");
      res = JSON.parse(res.data);
      return tc2ModemSchema.parse(res);
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const getSavedWifiNetworks = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return [];
      const { url } = device;
      const savedNetworks = await CapacitorHttp.get({
        url: `${url}/api/network/wifi/saved`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      if (savedNetworks.status !== 200) return [];
      return z
        .array(
          z
            .string()
            .or(z.object({ SSID: z.string() }).transform((val) => val.SSID))
        )
        .parse(JSON.parse(savedNetworks.data));
    } catch (error) {
      console.error(error);
      return [];
    }
  };

  const InterfaceSchema = z.object({
    name: z.string(),
    addresses: z.array(z.string()).nullable(),
    mtu: z.number(),
    macAddress: z.string(),
    flags: z.string(),
  });

  const getDeviceInterfaces = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return [];
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/network/interfaces`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      const interfaces = InterfaceSchema.array().parse(JSON.parse(res.data));
      return res.status === 200 ? interfaces : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  };

  // Access point
  const [apState, setApState] = createSignal<
    | "connected"
    | "disconnected"
    | "loadingDisconnect"
    | "loadingConnect"
    | "default"
  >("default");

  createEffect(
    on(
      () => [...devices.values()],
      (currDevices, prev) => {
        if ((prev?.length ?? 0) > 0 && currDevices.length === 0) {
          if (apState() === "connected") {
            DevicePlugin.hasConnection().then((res) => {
              if (!res.success) {
                log.logEvent("AP_disconnect");
                setApState("disconnected");
              }
            });
          }
        }
        return currDevices;
      }
    )
  );

  const connectToDeviceAP = leading(
    debounce,
    async () => {
      setApState("loadingConnect");

      const connectTimeout = setTimeout(() => {
        if (apState() === "loadingConnect") {
          setApState("default");
        }
      }, 120000); // 2 minute timeout

      try {
        log.logEvent("AP_connect");
        const res = await DevicePlugin.connectToDeviceAP();

        if (res.status === "connected") {
          // Verify the connection with multiple checks
          let verified = false;
          for (let i = 0; i < AP_CHECK_RETRIES; i++) {
            const checkRes = await DevicePlugin.checkIsAPConnected();
            if (checkRes.connected) {
              verified = true;
              break;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, AP_CHECK_RETRY_DELAY)
            );
          }

          if (verified) {
            log.logEvent("AP_connected");
            setApState("connected");
            searchDevice();
          } else {
            throw new Error("Connection verification failed");
          }
        } else if (res.status === "error") {
          log.logEvent("AP_failed");
          log.logWarning({
            message:
              "Please try again, or connect to 'bushnet' with password 'feathers' in your wifi settings. Alternatively, set up a hotspot named 'bushnet' password: 'feathers'.",
          });
          setApState("default");
        }
      } catch (err) {
        log.logEvent("AP_failed");
        setApState("default");
      } finally {
        clearTimeout(connectTimeout);
      }
    },
    800
  );

  const disconnectFromDeviceAP = async () => {
    try {
      setApState("loadingDisconnect");
      const res = await DevicePlugin.disconnectFromDeviceAP();
      searchDevice();
      return res.success;
    } catch (error) {
      return false;
    }
  };

  const takeTestRecording = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await CapacitorHttp.put({
        url: `${url}/api/camera/snapshot-recording`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
      });
      return res.status === 200;
    } catch (error) {
      return false;
    }
  };

  const takeAudioRecording = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await CapacitorHttp.put({
        url: `${url}/api/audio/test-recording`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
      });
      return res.status === 200;
    } catch (error) {
      return false;
    }
  };

  const getAudioMode = async (url: string) => {
    try {
      const res = await CapacitorHttp.get({
        url: `${url}/api/audiorecording`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
      });
      console.log("Audio mode", res);
      console.trace();
      return res.status === 200
        ? AudioModeResSchema.parse(JSON.parse(res.data))["audio-mode"]
        : null;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const getAudioStatus = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/audio/audio-status`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
      });
      console.log("Audio status", res);
      return res.status === 200
        ? AudioStatusResSchema.parse(JSON.parse(res.data))
        : null;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const setAudioMode = async (deviceId: DeviceId, type: AudioMode) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;
      const { url } = device;
      const res = await CapacitorHttp.post({
        url: `${url}/api/audiorecording?audio-mode=${type}`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
      });
      return res.status === 200;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const getAudioFiles = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return [];
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/audio/recordings`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
      });
      return res.status === 200 ? JSON.parse(res.data) : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  };

  const getDeviceCamera = (deviceId: DeviceId) => {
    const device = devices.get(deviceId);
    if (!device || !device.isConnected) return null;
    const { url } = device;
    return DeviceCamera(url.split("http://")[1]);
  };

  const changeGroup = async (
    deviceId: DeviceId,
    group: string,
    token: string
  ) => {
    const device = devices.get(deviceId);
    if (!device || !device.isConnected) return false;
    const { url } = device;
    const res = await CapacitorHttp.post({
      url: `${url}/api/reregister-authorized`,
      headers: { ...headers, "Content-Type": "application/json" },
      webFetchExtra: {
        credentials: "include",
      },
      data: {
        newGroup: group,
        authorizedUser: token,
      },
    });
    if (res.status === 200) {
      const info = await fetchDeviceInfo(url);
      const id: DeviceId = info.deviceID.toString();

      devices.set(id, {
        ...device,
        group,
      });
      devices.delete(deviceId);
      return true;
    } else if (res.status === 404 || res.status === 400) {
      const res = await DevicePlugin.reregisterDevice({
        url,
        group,
        device: deviceId,
      });
      const info = await fetchDeviceInfo(url);
      const id: DeviceId = info.deviceID.toString();
      if (res.success) {
        devices.set(id, {
          ...device,
          group,
        });
        devices.delete(deviceId);
        return true;
      }
    }
    throw new Error("Could not change group");
  };
  const configDefaultsSchema = z.object({
    // Config is much larger, but only these fields are used
    windows: z
      .object({
        StartRecording: z.string(),
        StopRecording: z.string(),
        PowerOn: z.string(),
        PowerOff: z.string(),
      })
      .partial(),
    "thermal-recorder": z
      .object({
        UseLowPowerMode: z.boolean(),
      })
      .partial()
      .optional(),
  });

  // Make optional version of configDefaultsSchema
  const configValueSchema = z
    .object({
      windows: z.object({
        StartRecording: z.string(),
        StopRecording: z.string(),
        PowerOn: z.string(),
        PowerOff: z.string(),
      }),
      thermalRecorder: z
        .object({
          UseLowPowerMode: z.boolean(),
        })
        .partial(),
    })
    .partial();

  const configSchema = z.object({
    defaults: configDefaultsSchema,
    values: configValueSchema,
  });

  const getDeviceConfig = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await DevicePlugin.getDeviceConfig({ url });
      if (!res.success) return null;
      const config = configSchema.parse(JSON.parse(res.data));
      console.log("CONFIG", config);
      return config;
    } catch (error) {
      console.error("Get Config Error", error);
      return null;
    }
  };

  const setRecordingWindow = async (
    deviceId: DeviceId,
    on: string,
    off: string
  ) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await DevicePlugin.updateRecordingWindow({ url, on, off });
      return res.success;
    } catch (error) {
      return null;
    }
  };

  const SaltStatusSchema = z.object({
    RunningUpdate: z.boolean(), // Required field

    // Optional fields
    RunningArgs: z
      .union([
        z.string(), // Replace with the actual type if known
        z.number(),
        z.boolean(),
        z.array(z.any()),
        z.null(),
      ])
      .optional(),

    LastCallOut: z.string().optional(),
    LastCallSuccess: z.boolean().optional(),
    LastCallNodegroup: z.string().optional(),
    LastCallArgs: z.array(z.string()).optional(),

    // Validate LastUpdate as a datetime string in ISO 8601 format
    LastUpdate: z.string().datetime({ offset: true }).optional(),

    UpdateProgressPercentage: z.number().int().optional(),
    UpdateProgressStr: z.string().optional(),
  });
  type SaltStatus = z.infer<typeof SaltStatusSchema>;
  const updatingDevice = new ReactiveMap<
    DeviceId,
    {
      pending?: boolean;
      interval?: NodeJS.Timeout;
    } & Partial<SaltStatus>
  >();
  const runUpdateCheck = leading(debounce, (deviceId: DeviceId) => {
    if (updatingDevice.has(deviceId)) return;
    const device = devices.get(deviceId);
    if (!device || !device.isConnected) return;
    const { url } = device;
    updatingDevice.set(deviceId, { pending: true });
    const interval = setInterval(async () => {
      try {
        const res = await CapacitorHttp.get({
          url: `${url}/api/salt-update`,
          headers: { ...headers, "Content-Type": "application/json" },
          webFetchExtra: {
            credentials: "include",
          },
        });
        if (res.status === 200) {
          console.log("Parsing Update", res.data);
          const statusRes = SaltStatusSchema.safeParse(JSON.parse(res.data));
          if (statusRes.success) {
            const { data } = statusRes;
            console.log("Check Updating", data);
            updatingDevice.set(deviceId, { pending: false, interval, ...data });
            if (data.RunningUpdate === false) {
              clearInterval(interval);
              updatingDevice.delete(deviceId);
            }
          } else {
            console.error("Check Updating Error", statusRes.error, res.data);
          }
        }
      } catch (error) {
        console.error("Check Updating Error", error);
        updatingDevice.delete(deviceId);
      }
    }, 5000);
  });

  // Update
  const updateDevice = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const existing = updatingDevice.get(deviceId);

      if (existing) {
        if (existing.RunningUpdate) return null;
        clearInterval(existing.interval);
        updatingDevice.delete(deviceId);
      }
      const res = await CapacitorHttp.post({
        url: `${url}/api/salt-update`,
        headers: { ...headers, "Content-Type": "application/json" },
        webFetchExtra: {
          credentials: "include",
        },
        data: { force: true },
      });
      console.log("Update Device", res);
      if (res.status === 200) {
        runUpdateCheck(deviceId);
        log.logEvent("Trigged update for device", {
          id: device.id,
        });
        return true;
      }
    } catch (error) {
      console.error(error);
      log.logError({ message: "Failed to update for device", error });
    }
    return false;
  };

  const getUpdateError = (deviceId: DeviceId) => {
    const device = devices.get(deviceId);
    if (!device || !device.isConnected) return null;
    const existing = updatingDevice.get(deviceId);
    if (!existing?.RunningUpdate) return null;
    const lastCallOut = existing?.LastCallOut;
    if (lastCallOut?.includes("accepted?"))
      return "Contact support to accept your device.";
  };

  const checkDeviceUpdate = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await CapacitorHttp.get({
        url: `${url}/api/salt-update`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      const data =
        res.status === 200
          ? SaltStatusSchema.parse(JSON.parse(res.data))
          : null;
      console.log("Check For Update", data);
      if (data?.RunningUpdate && !updatingDevice.has(deviceId)) {
        runUpdateCheck(deviceId);
      }
      return data;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const isDeviceUpdating = (deviceId: DeviceId) => {
    const device = updatingDevice.get(deviceId);
    debugger;
    return (
      device?.pending ||
      (device?.RunningUpdate && device?.LastCallSuccess !== false)
    );
  };

  const didDeviceUpdate = (deviceId: DeviceId): boolean | null => {
    const foundDevice = updatingDevice.get(deviceId);
    return foundDevice?.LastCallSuccess ?? null;
  };

  const getDeviceUpdating = (deviceId: DeviceId) => {
    return updatingDevice.get(deviceId);
  };

  const setLowPowerMode = async (deviceId: DeviceId, enabled: boolean) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await DevicePlugin.setDeviceConfig({
        url,
        section: "thermal-recorder",
        config: JSON.stringify({ "use-low-power-mode": enabled }),
      });

      return res.success ? enabled : !enabled;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const rebootDevice = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return null;
      const { url } = device;
      const res = await CapacitorHttp.post({
        url: `${url}/api/reboot`,
        headers,
        webFetchExtra: {
          credentials: "include",
        },
      });
      return res.status === 200;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const deviceHasInternet = async (deviceId: DeviceId) => {
    try {
      const device = devices.get(deviceId);
      if (!device || !device.isConnected) return false;

      const wifi = await getCurrentWifiNetwork(deviceId);
      if (wifi?.SSID !== "") return true;
      const modemConnection = await checkDeviceModemInternetConnection(
        deviceId
      );
      return modemConnection;
    } catch (error) {
      console.error("While checking device has internet", error);
      return false;
    }
  };

  const deviceTypes = z.enum([
    "audio",
    "thermal",
    "trailcam",
    "trapcam",
    "hybrid-thermal-audio",
    "unknown",
  ]);

  createEffect(
    on(
      () => [...devices.values()],
      async (devices) => {
        if (apState() === "connected") return;
        for (const device of devices) {
          await storage.syncWithServer(device.id, device.isProd);
        }
      }
    )
  );

  return {
    devices,
    isDiscovering,
    devicesDownloading,
    deviceHasInternet,
    stopSaveItems,
    deviceRecordings,
    deviceEventKeys,
    startDiscovery,
    stopDiscovery,
    setRecordingWindow,
    deleteUploadedRecordings,
    getDeviceConfig,
    getEvents,
    saveItems,
    setCurrEvents,
    saveEvents,
    changeGroup,
    rebootDevice,
    // Location
    locationDisabled,
    locationPermission: permission,
    refetchLocationPermission,
    refetchDeviceLocToUpdate,
    setDeviceToCurrLocation,
    locationBeingSet,
    getLocationCoords,
    getLocationByDevice,
    devicesLocToUpdate,
    shouldDeviceUpdateLocation,
    // Wifi
    getDeviceInterfaces,
    getWifiNetworks,
    getCurrentWifiNetwork,
    connectToWifi,
    disconnectFromWifi,
    forgetWifi,
    checkDeviceWifiInternetConnection,
    saveWifiNetwork,
    getSavedWifiNetworks,
    hasNetworkEndpoints,
    // Modem
    getModemSignalStrength,
    getModem,
    turnOnModem,
    checkDeviceModemInternetConnection,
    // Access point
    connectToDeviceAP,
    disconnectFromDeviceAP,
    apState,
    searchDevice,
    // Camera
    takeTestRecording,
    getDeviceCamera,
    setLowPowerMode,
    //Audio
    getAudioMode,
    getAudioStatus,
    setAudioMode,
    takeAudioRecording,
    getAudioFiles,
    hasAudioCapabilities,
    // Update
    checkDeviceUpdate,
    updateDevice,
    getDeviceUpdating,
    getUpdateError,
    isDeviceUpdating,
    didDeviceUpdate,
    saveAPN,
    getBattery,
    devicesConnectingToWifi,
  };
});
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const defineUseDevice = () => useDevice()!;
export { defineUseDevice as useDevice, DeviceProvider };
