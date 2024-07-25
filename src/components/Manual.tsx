import {
  RiArrowsArrowLeftSLine,
  RiArrowsArrowRightSLine,
} from "solid-icons/ri";
import { createSignal, For, JSX, Match, Show, Switch } from "solid-js";
import { useDevice } from "~/contexts/Device";
import {
  ColorType,
  DeviceType,
  DeviceTypeButton,
  Light,
  LightSequence,
  StartupProcess,
  colorClasses,
  getStartupSteps,
} from "./SetupWizard";
import {
  NativeSettings,
  AndroidSettings,
  IOSSettings,
} from "capacitor-native-settings";
import { Motion } from "solid-motionone";
export default function Manual() {
  const [selectedTab, setSelectedTab] = createSignal("connectionMethods");
  const [selectedConnectionMethod, setSelectedConnectionMethod] =
    createSignal<string>("");
  const tabs = [
    { id: "connectionMethods", label: "Connection Methods" },
    { id: "aiDocCam", label: "AI Doc Cam/ Bird Monitor" },
    { id: "classicThermal", label: "Classic Thermal Camera" },
  ];

  const connectionMethods = [
    {
      id: "directConnect",
      label: "Direct Connect",
      tooltip:
        "Connects to camera's hotspot. Use when offline/remote locations to download recordings without using your data.",
    },
    {
      id: "phoneHotspot",
      label: "Phone Hotspot",
      tooltip:
        "Use to update the camera software if the device has no modem. Will upload recordings and events automatically.",
    },
    { id: "wifiConnection", label: "WiFi Connection" },
  ];

  const getInstructions = (method: string): JSX.Element => {
    const deviceContext = useDevice();
    const connectionStatus = () => deviceContext.apState();
    const [deviceType, setDeviceType] = createSignal<DeviceType>(
      "AI Doc Cam / Bird Monitor"
    );
    switch (method) {
      case "directConnect":
        return (
          <>
            <button
              onClick={() => setSelectedConnectionMethod("")}
              class="flex items-center justify-center py-2 text-xl text-blue-500"
            >
              <RiArrowsArrowLeftSLine size={32} />
              Direct Conncetion
            </button>
            <div class="mb-4 flex w-full items-center justify-center space-x-2">
              <DeviceTypeButton
                isSelected={deviceType() === "AI Doc Cam / Bird Monitor"}
                onClick={() => setDeviceType("AI Doc Cam / Bird Monitor")}
              >
                AI Doc Cam / Bird Monitor
              </DeviceTypeButton>
              <DeviceTypeButton
                isSelected={deviceType() === "Classic"}
                onClick={() => setDeviceType("Classic")}
              >
                Classic
              </DeviceTypeButton>
            </div>
            <ol class="list-decimal pl-5">
              <li>Wait for the light on your device shows indicates 1 flash</li>
              <li>Press the "Connect to Camera" button below.</li>
              <li>If prompted, confirm the connection to "bushnet"</li>
            </ol>
            <StartupProcess steps={getStartupSteps(deviceType())} />
            <button
              class="mb-4 w-full rounded bg-blue-500 py-2 text-white"
              onClick={() => {
                deviceContext.connectToDeviceAP();
                deviceContext.searchDevice();
              }}
              disabled={connectionStatus() !== "default"}
            >
              <Switch>
                <Match when={connectionStatus() === "default"}>
                  Connect To Camera
                </Match>
                <Match when={connectionStatus() === "loading"}>
                  Connecting to device...
                </Match>
                <Match when={connectionStatus() === "connected"}>
                  Connected To Camera
                </Match>
              </Switch>
            </button>
          </>
        );
      case "phoneHotspot":
        return (
          <>
            <button
              onClick={() => setSelectedConnectionMethod("")}
              class="flex items-center justify-center py-2 text-xl text-blue-500"
            >
              <RiArrowsArrowLeftSLine size={32} />
              Phone Hotspot
            </button>
            <ol class="list-decimal pl-5">
              <li>Set up Personal Hotspot</li>
              <li>
                Go to Settings {">"} Personal Hotspot (or Portable Hotspot)
              </li>
              <li>Tap the slider next to Allow Others to Join</li>
              <li>Enable Maximize Compatibility if on iOS</li>
            </ol>
            <button
              onClick={() => {
                NativeSettings.open({
                  optionAndroid: AndroidSettings.Wireless,
                  optionIOS: IOSSettings.Tethering,
                });
              }}
              class="mt-4 rounded bg-blue-500 px-4 py-2 text-white"
            >
              Hotspot Settings
            </button>
          </>
        );
      case "wifiConnection":
        return (
          <>
            <button
              onClick={() => setSelectedConnectionMethod("")}
              class="flex items-center justify-center py-2 text-xl text-blue-500"
            >
              <RiArrowsArrowLeftSLine size={32} />
              Wifi Connection
            </button>
            <p>If your device is already connected to WiFi:</p>
            <ol class="list-decimal pl-5">
              <li>Connect to the same network as your device</li>
            </ol>
            <p class="mt-2">
              Otherwise, use another connection method and add the WiFi network
              to the device's WiFi settings.
            </p>
            <button
              onClick={() => {
                NativeSettings.open({
                  optionAndroid: AndroidSettings.Wifi,
                  optionIOS: IOSSettings.WiFi,
                });
              }}
              class="mt-4 rounded bg-blue-500 px-4 py-2 text-white"
            >
              WiFi Settings
            </button>
          </>
        );
      default:
        return <p>Select a connection method to see instructions.</p>;
    }
  };

  const LightStatus = (props: {
    status: string;
    sequence: LightSequence;
    sequenceText: string;
    color: ColorType;
  }) => (
    <li class="flex items-center space-x-2">
      <span>
        <LightSequence sequence={props.sequence} color={props.color} />
      </span>
      <div>
        <p>
          <b>Status:</b> {props.status}
        </p>
        <p>
          <b>Sequence:</b> {props.sequenceText}
        </p>
      </div>
    </li>
  );

  return (
    <>
      <div class="flex pb-2">
        <For each={tabs}>
          {(tab) => (
            <button
              class={`mx-1 rounded px-1 py-1 text-sm ${
                selectedTab() === tab.id
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200"
              }`}
              onClick={() => setSelectedTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <Switch>
        <Match when={selectedTab() === "connectionMethods"}>
          <Show
            when={!selectedConnectionMethod()}
            fallback={getInstructions(selectedConnectionMethod())}
          >
            <p class="text-md text-center text-gray-700">
              In case you are unable to connect to your camera you can try an
              alternative method.
            </p>
            <div class="mb-4 flex flex-col gap-y-2">
              <For each={connectionMethods}>
                {(method) => (
                  <div class="border-2 border-gray-200 p-2">
                    <button
                      class={`flex w-full justify-between rounded border-2 border-blue-400 bg-white px-3 py-2 text-lg text-blue-400`}
                      onClick={() => setSelectedConnectionMethod(method.id)}
                    >
                      <span>{method.label}</span>
                      <RiArrowsArrowRightSLine size={32} />
                    </button>
                    <p class="px-4">{method.tooltip}</p>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Match>
        <Match when={selectedTab() === "aiDocCam"}>
          <h3 class="mb-2 ml-2 font-bold">Light Status</h3>
          <ul class="max-h-80 list-disc overflow-scroll pl-5">
            <h1>Bootup</h1>
            <LightStatus
              sequence={["short"]}
              color="blue"
              status="Booting up Device"
              sequenceText="(slow pulse)"
            />
            <LightStatus
              sequence={[]}
              color="blue"
              status="Booted up Device"
              sequenceText="(Solid light)"
            />
            <h1>WiFi</h1>
            <LightStatus
              sequence={["short"]}
              color="green"
              status="Connecting to WiFi"
              sequenceText="(Short pulse)"
            />
            <LightStatus
              sequence={[]}
              color="green"
              status="Connected to WiFi"
              sequenceText="(Solid light)"
            />
            <h1>Hotspot</h1>
            <LightStatus
              sequence={["short"]}
              color="yellow"
              status="Setting up hotspot"
              sequenceText="(Short pulse)"
            />
            <LightStatus
              sequence={[]}
              color="yellow"
              status="Hotspot available"
              sequenceText="(Solid light)"
            />
            <h1>Power</h1>
            <LightStatus
              sequence={["long"]}
              color="red"
              status="Low Battery"
              sequenceText="(Slow pulse)"
            />
            <LightStatus
              sequence={["long"]}
              color="red"
              status="Device is Off"
              sequenceText="(Solid Light)"
            />
            <LightStatus
              sequence={[]}
              color="gray"
              status="Press to find status"
              sequenceText="(No Light)"
            />
          </ul>
        </Match>
        <Match when={selectedTab() === "classicThermal"}>
          <h3 class="mb-2 ml-2 max-h-80 overflow-scroll font-bold">
            Light Status
          </h3>
          <ul class="list-disc pl-5">
            <LightStatus
              sequence={["long", "blink", "blink"]}
              color="blue"
              status="Booting up Device"
              sequenceText="(One slow pulse, two flashes)"
            />
            <br />
            <LightStatus
              sequence={["long", "blink"]}
              color="blue"
              status="Conneting to WiFi"
              sequenceText="(One slow pulse, one flash)"
            />
            <br />
            <LightStatus
              sequence={["long"]}
              color="blue"
              status="Conneted to WiFi or Setup hotspot"
              sequenceText="(One slow pulse)"
            />
            <br />
            <li>
              <LightStatus
                sequence={[]}
                color="gray"
                status="Press to find status"
                sequenceText="(No Light)"
              />
            </li>
          </ul>
        </Match>
      </Switch>
    </>
  );
}
