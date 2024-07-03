import { RiArrowsArrowRightSLine } from "solid-icons/ri";
import { createSignal, For, Switch, Match, JSX, Show } from "solid-js";

type HelpSectionProps = {
  onClose: () => void;
};

const HelpSection = (props: HelpSectionProps): JSX.Element => {
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
        "Use when offline/remote locations to download recordings or if your device has a modem.",
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
    switch (method) {
      case "directConnect":
        return (
          <>
            <ol class="list-decimal pl-5">
              <li>Wait for the light on your device shows indicates 1 flash</li>
              <li>Press the "Connect to Camera" button below.</li>
              <li>If prompted, confirm the connection to "bushnet"</li>
            </ol>
            <div class="mt-4">
              <h4 class="font-bold">Startup Process</h4>
              <div class="mt-2 flex items-center space-x-2">
                <div class="h-4 w-4 rounded-full bg-blue-500"></div>
                <span>30s Bootup</span>
                <div class="h-4 w-4 rounded-full bg-blue-500"></div>
                <span>10s Checks WiFi</span>
                <div class="h-4 w-4 rounded-full bg-blue-500"></div>
                <span>5m Can Connect</span>
                <div class="h-4 w-4 rounded-full bg-gray-500"></div>
                <span>Standby</span>
              </div>
            </div>
            <button class="mt-4 rounded bg-blue-500 px-4 py-2 text-white">
              Connect To Camera
            </button>
          </>
        );
      case "phoneHotspot":
        return (
          <>
            <ol class="list-decimal pl-5">
              <li>Set up Personal Hotspot</li>
              <li>
                Go to Settings {">"} Personal Hotspot (or Portable Hotspot)
              </li>
              <li>Tap the slider next to Allow Others to Join</li>
              <li>Enable Maximize Compatibility</li>
            </ol>
            <button class="mt-4 rounded bg-blue-500 px-4 py-2 text-white">
              Hotspot Settings
            </button>
          </>
        );
      case "wifiConnection":
        return (
          <>
            <p>If your device is already connected to WiFi:</p>
            <ol class="list-decimal pl-5">
              <li>Connect to the same network as your device</li>
            </ol>
            <p class="mt-2">
              Otherwise, use another connection method and add the WiFi network
              to the device's WiFi settings.
            </p>
            <button class="mt-4 rounded bg-blue-500 px-4 py-2 text-white">
              WiFi Settings
            </button>
          </>
        );
      default:
        return <p>Select a connection method to see instructions.</p>;
    }
  };

  return (
    <>
      <div class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-2xl font-bold">Help</h2>
          <button onClick={props.onClose} class="text-2xl">
            &times;
          </button>
        </div>
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
            <h3 class="mb-2 font-bold">Light Status</h3>
            <ul class="list-disc pl-5">
              <li>
                <span class="text-blue-500">Blue (Flashing)</span>: Turning on
              </li>
              <li>
                <span class="text-yellow-500">Yellow</span>: No Wi-Fi Connection
              </li>
              <li>
                <span class="text-green-500">Green</span>: Connected to Wi-Fi
              </li>
              <li>
                <span class="text-gray-500">Gray</span>: Standby
              </li>
              <li>
                <span class="text-red-500">Red (Slow Flash)</span>: Low Battery
              </li>
            </ul>
          </Match>
          <Match when={selectedTab() === "classicThermal"}>
            <h3 class="mb-2 font-bold">Light Status</h3>
            <ul class="list-disc pl-5">
              <li>
                <span class="text-blue-500">Blue (Flashing)</span>: Turning on
              </li>
              <li>
                <span class="text-blue-500">Blue</span>: No Wi-Fi Connection
              </li>
              <li>
                <span class="text-blue-500">Blue</span>: Connected to Wi-Fi
              </li>
              <li>
                <span class="text-gray-500">Gray</span>: Standby
              </li>
              <li>
                <span class="text-blue-500">Blue (Slow Flash)</span>: Low
                Battery
              </li>
            </ul>
          </Match>
        </Switch>
      </div>
    </>
  );
};

export default HelpSection;
