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

export const getSteps = (deviceType: DeviceType): JSX.Element => {
  return (
    <Show
      when={deviceType === "DOC AI Cam / Bird Monitor"}
      fallback={
        <>
          <ol class="mb-4 list-inside list-decimal">
            <li>Plug in and ensure the device is on.</li>
            <li>Wait until the light indicates a slow pulsing.</li>
            <li>
              Press the <span class="text-blue-500">"Connect to Camera"</span>{" "}
              button below.
            </li>
            <li>If prompted, confirm the connection to "bushnet"</li>
          </ol>
          <p class="mb-4 text-center text-sm">
            If your light does not match the process indicated below try reset
            the device pressing the power button.
          </p>
        </>
      }
    >
      <>
        <ol class="mb-4 list-inside list-decimal">
          <li>Plug in and ensure the device is on.</li>
          <li>
            Wait for the light on your device to turn{" "}
            <span class="text-yellow-600">yellow</span>.
          </li>
          <li>
            Press the <span class="text-blue-500">"Connect to Camera"</span>{" "}
            button.
          </li>
          <li>If prompted, confirm the connection to "bushnet".</li>
        </ol>
        <p class="mb-4 text-center text-sm">
          If your light is <span class="text-red-500">red</span> or in{" "}
          <span class="text-blue-500">standby</span>(not blinking), long press
          (3 seconds) wait until the light is off, and long press again the
          power button on your camera to restart the process.
        </p>
      </>
    </Show>
  );
};
export default function Manual() {
  const [selectedTab, setSelectedTab] = createSignal("connectionMethods");
  const [selectedConnectionMethod, setSelectedConnectionMethod] =
    createSignal<string>("");
  const tabs = [
    { id: "connectionMethods", label: "Connection Methods" },
    { id: "aiDocCam", label: "DOC AI Cam/ Bird Monitor" },
    { id: "classicThermal", label: "Classic Thermal Camera" },
  ];

  const connectionMethods = [
    {
      id: "directConnect",
      label: "Direct Connect",
      tooltip:
        "Connects to camera's hotspot. Use in offline/remote locations to download recordings without using your data.",
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
      "DOC AI Cam / Bird Monitor"
    );

    return (
      <div class="px-4">
        <Switch
          fallback={<p>Select a connection method to see instructions.</p>}
        >
          <Match when={method === "directConnect"}>
            <>
              <button
                onClick={() => setSelectedConnectionMethod("")}
                class="flex items-center justify-center py-2 text-xl text-blue-500"
              >
                <RiArrowsArrowLeftSLine size={32} />
                Direct Connection
              </button>
              <div class="mb-4 flex w-full items-center justify-center space-x-2">
                <DeviceTypeButton
                  isSelected={deviceType() === "DOC AI Cam / Bird Monitor"}
                  onClick={() => setDeviceType("DOC AI Cam / Bird Monitor")}
                >
                  DOC AI Cam / Bird Monitor
                </DeviceTypeButton>
                <DeviceTypeButton
                  isSelected={deviceType() === "Classic"}
                  onClick={() => setDeviceType("Classic")}
                >
                  Classic
                </DeviceTypeButton>
              </div>
              {getSteps(deviceType())}
              <StartupProcess steps={getStartupSteps(deviceType())} />
              <button
                class="mb-4 w-full rounded bg-blue-500 py-2 text-white"
                onClick={() => {
                  deviceContext.connectToDeviceAP();
                  deviceContext.searchDevice();
                }}
                disabled={
                  connectionStatus() !== "default" &&
                  connectionStatus() !== "disconnected"
                }
              >
                <Switch fallback={<>Connect To Camera</>}>
                  <Match
                    when={
                      connectionStatus() === "default" ||
                      connectionStatus() === "disconnected"
                    }
                  >
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
          </Match>
          <Match when={method === "phoneHotspot"}>
            <>
              <button
                onClick={() => setSelectedConnectionMethod("")}
                class="flex items-center justify-center py-2 text-xl text-blue-500"
              >
                <RiArrowsArrowLeftSLine size={32} />
                Phone Hotspot
              </button>
              <ol class="list-decimal px-6">
                <li>Set up Personal Hotspot</li>
                <li>
                  Go to Settings {">"} Personal Hotspot (or Portable Hotspot)
                </li>
                <li>Tap the slider next to Allow Others to Join</li>
                <li>Enable Maximize Compatibility if on iOS</li>
                <li>
                  Connect using direct connect and add your hotspot through the
                  WiFi settings
                </li>
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
          </Match>
          <Match when={method === "wifiConnection"}>
            <>
              <button
                onClick={() => setSelectedConnectionMethod("")}
                class="flex items-center justify-center py-2 text-xl text-blue-500"
              >
                <RiArrowsArrowLeftSLine size={32} />
                WiFi Connection
              </button>
              <ul>
                <li>
                  You will need to first either connect directly to the device
                  or use your phone's hotspot.
                </li>
                <li>
                  Follow the steps to add a WiFi network by clicking on the
                  device that appears.
                </li>
                <li>
                  <p>If your device is already connected to WiFi:</p>
                  <p>Connect to the same network as your device.</p>
                </li>
              </ul>
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
          </Match>
        </Switch>
      </div>
    );
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
              If you are unable to connect to your camera, you can try an
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
              status="Device Booted up"
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
              sequence={[]}
              color="red"
              status="Device is Off/in standby"
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
              status="Connecting to WiFi"
              sequenceText="(One slow pulse, one flash)"
            />
            <br />
            <LightStatus
              sequence={["long"]}
              color="blue"
              status="Connected to WiFi or Setup hotspot"
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
