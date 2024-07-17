import { createStore } from "solid-js/store";
import { useSearchParams, useNavigate } from "@solidjs/router";
import {
  Switch,
  Match,
  createSignal,
  Show,
  JSX,
  For,
  createEffect,
  onMount,
  on,
} from "solid-js";
import { Motion } from "solid-motionone";
import HelpSection from "./HelpSection";
import { Device, DeviceName, useDevice } from "~/contexts/Device";
import {
  RiArrowsArrowLeftSLine,
  RiArrowsArrowRightSLine,
} from "solid-icons/ri";
import { BsCameraVideoFill } from "solid-icons/bs";
import {
  CameraSettingsTab,
  GroupSelect,
  LocationSettingsTab,
  WifiSettingsTab,
} from "../DeviceSettings";
import { useUserContext } from "~/contexts/User";
import { Dialog } from "@capacitor/dialog";
import FieldWrapper from "../Field";
import { AiOutlineInfoCircle } from "solid-icons/ai";
type ColorType = "blue" | "green" | "yellow" | "gray" | "red";
type DeviceType = "AI Doc Cam / Bird Monitor" | "Classic";

type StoreType = {
  deviceType: DeviceType | null;
};

type ConnectionStatus = "idle" | "connecting" | "connected";

type CloseButtonProps = {
  onClick: () => void;
};

type DeviceTypeButtonProps = {
  isSelected: boolean;
  onClick: () => void;
  children: string;
};

// Common Components
const CloseButton = (props: CloseButtonProps): JSX.Element => (
  <button onClick={props.onClick} class="text-2xl">
    &times;
  </button>
);

const DontShowAgainCheckbox = (): JSX.Element => (
  <label class="flex items-center">
    <input type="checkbox" class="mr-2" />
    Don't show again
  </label>
);

const DeviceTypeButton = (props: DeviceTypeButtonProps): JSX.Element => (
  <button
    class={`rounded px-4 py-2 ${props.isSelected ? "bg-gray-200" : "bg-white"}`}
    onClick={props.onClick}
  >
    {props.children}
  </button>
);

type LightSequenceType = "short" | "long" | "blink";
type LightSequence = LightSequenceType[];

type StepType = {
  color: ColorType;
  label: string;
  duration: string;
  sequence: LightSequence;
};

type StartupProcessProps = {
  steps: StepType[];
};

const colorClasses: Record<ColorType, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  gray: "bg-gray-500",
  red: "bg-red-500",
};

const createLightAnimation = (sequence: LightSequence) => {
  const keyframes = [];
  const durations = [];

  for (const light of sequence) {
    switch (light) {
      case "short":
        keyframes.push(0, 1, 0);
        durations.push(0.5, 0.5, 0.5);
        break;
      case "long":
        keyframes.push(0, 1, 1, 0);
        durations.push(0.5, 1, 1, 0.5);
        break;
      case "blink":
        keyframes.push(0, 1, 0);
        durations.push(0.1, 0.1, 0.1);
        break;
    }
  }

  // Add a pause at the end if the sequence is not empty
  if (sequence.length > 0) {
    keyframes.push(0);
    durations.push(1);
  } else {
    // If the sequence is empty, keep the light on
    keyframes.push(1);
    durations.push(1);
  }

  return {
    opacity: keyframes,
    transition: {
      duration: durations.reduce((a, b) => a + b, 0),
      ease: durations.map(() => "linear"),
      times: durations.map((_, i) => i / durations.length),
      repeat: Infinity,
    },
  };
};

const StartupProcess = (props: StartupProcessProps): JSX.Element => (
  <div class="mb-4">
    <h3 class="mb-2 font-bold">Startup Process</h3>
    <div class="flex items-center">
      <For each={props.steps}>
        {(step, index) => (
          <>
            <div class="flex flex-col items-center">
              <Motion
                animate={createLightAnimation(step.sequence)}
                class={`h-4 w-4 rounded-full ${colorClasses[step.color]}`}
              />
              <span class="mt-1 text-xs">{step.label}</span>
              <span class="mt-1 text-xs">{step.duration}</span>
            </div>
            {index() < props.steps.length - 1 && (
              <div class="mx-2 h-px flex-grow bg-gray-300" />
            )}
          </>
        )}
      </For>
    </div>
  </div>
);

function SetupWizard(): JSX.Element {
  const deviceContext = useDevice();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDevice, setSelectedDevice] = createSignal<string>();
  const [store, setStore] = createStore<StoreType>({
    deviceType: null,
  });
  const connectionStatus = () => deviceContext.apState();
  type Steps =
    | "directConnect"
    | "chooseDevice"
    | "searchingDevice"
    | "checkWifi"
    | "wifiSetup"
    | "connectionSetup"
    | "group"
    | "location"
    | "camera";
  const currentStep = () => searchParams.step as Steps;
  const setStep = (step: Steps): void => {
    setSearchParams({ step });
  };
  const close = () => setSearchParams({ step: "" });
  const [showHelp, setShowHelp] = createSignal(false);

  const user = useUserContext();

  const toggleHelp = () => setShowHelp(!showHelp());
  const HelpButton = (): JSX.Element => (
    <button
      class="rounded bg-gray-200 px-4 py-2 text-gray-800"
      onClick={toggleHelp}
    >
      Help
    </button>
  );
  const getStartupSteps = (deviceType: DeviceType): StepType[] => {
    if (deviceType === "AI Doc Cam / Bird Monitor") {
      return [
        { color: "blue", label: "Bootup", duration: "30s", sequence: ["long"] },
        {
          color: "green",
          label: "Checks WiFi",
          duration: "10s",
          sequence: ["long", "long"],
        },
        {
          color: "yellow",
          label: "Can Connect",
          duration: "5m",
          sequence: [],
        },
        { color: "gray", label: "Standby", duration: "", sequence: [] },
      ];
    } else {
      return [
        {
          color: "blue",
          label: "Bootup",
          duration: "30s",
          sequence: ["long", "short", "short"],
        },
        {
          color: "blue",
          label: "Checks WiFi",
          duration: "10s",
          sequence: ["short"],
        },
        {
          color: "blue",
          label: "Can Connect",
          duration: "5m",
          sequence: ["long", "long"],
        },
        {
          color: "gray",
          label: "Standby",
          duration: "",
          sequence: [],
        },
      ];
    }
  };
  createEffect(() => {
    console.log("CONNECTION", connectionStatus());
    if (
      connectionStatus() === "connected" &&
      (currentStep() === "directConnect" || currentStep() === "chooseDevice")
    ) {
      setStep("searchingDevice");
      deviceContext.searchDevice();
    }
  });
  const Title = (props: { title: string; back?: Steps }) => (
    <div class="mb-4 flex items-center justify-between px-4">
      <div class="flex items-center gap-x-2">
        <Show when={props.back}>
          {(back) => (
            <button class="text-blue-400" onClick={() => setStep(back())}>
              <RiArrowsArrowLeftSLine size={32} />
            </button>
          )}
        </Show>
        <h2 class="text-xl font-bold">{props.title}</h2>
      </div>
      <CloseButton onClick={close} />
    </div>
  );
  const Additional = () => (
    <div class="mt-4 flex items-center justify-between border-t-2 border-gray-200 px-2 pt-2">
      <DontShowAgainCheckbox />
      <HelpButton />
    </div>
  );
  const getInstructions = (deviceType: DeviceType): JSX.Element => {
    return (
      <Show
        when={deviceType === "AI Doc Cam / Bird Monitor"}
        fallback={
          <ol class="mb-4 list-inside list-decimal">
            <li>Wait for the light on your device shows indicates 1 flash</li>
            <li>
              Press the <span class="text-blue-500">"Connect to Camera"</span>{" "}
              button below.
            </li>
            <li>If prompted, confirm the connection to "bushnet"</li>
          </ol>
        }
      >
        <ol class="mb-4 list-inside list-decimal">
          <li>Plug in and ensure the device is on.</li>
          <li>
            Wait for the light on your device to turn{" "}
            <span class="text-yellow-600">yellow</span>
          </li>
          <li>
            Press the <span class="text-blue-500">"Connect to Camera"</span>{" "}
            button
          </li>
          <li>If prompted, confirm the connection to "bushnet"</li>
        </ol>
      </Show>
    );
  };

  const DirectConnectStep = (): JSX.Element => (
    <>
      <Title title="Connect To Device" />
      <div class="mb-4 flex space-x-2">
        <DeviceTypeButton
          isSelected={store.deviceType === "AI Doc Cam / Bird Monitor"}
          onClick={() => setStore("deviceType", "AI Doc Cam / Bird Monitor")}
        >
          AI Doc Cam / Bird Monitor
        </DeviceTypeButton>
        <DeviceTypeButton
          isSelected={store.deviceType === "Classic"}
          onClick={() => setStore("deviceType", "Classic")}
        >
          Classic
        </DeviceTypeButton>
      </div>
      {store.deviceType && getInstructions(store.deviceType)}
      <p class="mb-4 text-center text-sm">
        If your light is <span class="text-red-500">red</span> or in{" "}
        <span class="text-blue-500">standby</span>(not blinking), long press (3
        seconds) wait till the light is off, and long press again the power
        button on your camera to restart the process.
        <br />
        Press "help" for more information
      </p>
      {store.deviceType && (
        <StartupProcess steps={getStartupSteps(store.deviceType)} />
      )}
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
      <Additional />
    </>
  );

  const ChooseDeviceStep = () => (
    <>
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-xl font-bold">Choose your Device</h2>
        <CloseButton onClick={() => navigate("/devices")} />
      </div>
      <p class="mb-4 text-center">
        Turn on your device and choose the device that matches
      </p>
      <div class="flex justify-center space-x-4">
        <button
          class="flex flex-col items-center rounded-lg bg-green-200 p-4"
          onClick={() => {
            setStore("deviceType", "AI Doc Cam / Bird Monitor");
            setStep("directConnect");
          }}
        >
          <div class="relative mb-2 h-48 w-32 bg-green-300">
            <div class="absolute left-2 top-2 h-4 w-4 rounded-full bg-white"></div>
            <div class="absolute bottom-2 left-2 h-4 w-4 rounded-full bg-green-500"></div>
          </div>
          <span>AI Doc Cam/ Bird Monitor</span>
        </button>
        <button
          class="flex flex-col items-center rounded-lg bg-gray-200 p-4"
          onClick={() => {
            setStore("deviceType", "Classic");
            setStep("directConnect");
          }}
        >
          <div class="relative mb-2 h-48 w-32 bg-gray-300">
            <div class="absolute left-2 top-2 h-4 w-4 rounded-full bg-white"></div>
            <div class="absolute bottom-2 left-2 h-4 w-4 rounded-full bg-blue-500"></div>
          </div>
          <span>Classic Thermal Camera</span>
        </button>
      </div>
      <Additional />
    </>
  );

  const devices = () => [...deviceContext.devices.values()];
  const openDevice = async (device: Device) => {
    if (device.group !== "new") {
      setSearchParams({
        deviceSettings: device.id,
        tab: "General",
        step: "",
      });
    } else {
      setSearchParams({
        setupDevice: device.id,
        step: "wifiSetup",
      });
    }
  };
  const SearchingDeviceStep = () => (
    <>
      <Title title="Searching For Device" />
      <p class="text-center text-sm text-gray-800">
        If your device does not show ensure your phone/tablet is connected to
        the “bushnet” network in your WiFi settings, if not join the network
        with password “feathers”
      </p>
      <div class="rounded-lg bg-gray-200 p-1">
        <Show when={!!devices()} fallback={<div>No devices found...</div>}>
          <For each={devices()}>
            {(device) => (
              <button
                onClick={() => openDevice(device)}
                class="flex w-full items-center justify-between rounded-md border-2 border-blue-400 bg-white p-2 text-blue-400"
              >
                <div class="flex items-center gap-x-2">
                  <BsCameraVideoFill /> <span>{device.name}</span>
                </div>
                <Show
                  when={device.group === "new"}
                  fallback={<RiArrowsArrowRightSLine size={24} />}
                >
                  <div class="flex">
                    <span>Setup</span>
                    <RiArrowsArrowRightSLine size={24} />
                  </div>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
      <Additional />
    </>
  );

  const WifiSetup = () => {
    return (
      <>
        <Title title="Wifi Setings" back="searchingDevice" />
        <div class="flex flex-col gap-y-2 text-sm">
          <p class="text-center">
            The device may temporarily disconnect, ensure that your phone is
            connected to the same WiFi.
          </p>
          <p class="text-center">
            Follow instructions in Help {">"} Connection Method {">"} Phone
            hotspot to connect device to hotspot.
          </p>
        </div>
        <WifiSettingsTab deviceId={searchParams.setupDevice} />
        <button
          onClick={() => setStep("group")}
          class="w-full p-1 text-lg text-blue-500"
        >
          Next
        </button>
        <Additional />
      </>
    );
  };

  const GroupSettings = () => {
    return (
      <>
        <Title title="Group Setings" back="wifiSetup" />
        <div class="flex flex-col gap-y-2 px-8 text-center text-sm">
          Assign your device to a group so that you can view it in
          browse.cacophony.org.nz
        </div>
        <GroupSelect deviceId={searchParams.setupDevice} />
        <button
          onClick={() => setStep("location")}
          class="w-full p-1 text-lg text-blue-500"
        >
          Next
        </button>
        <Additional />
      </>
    );
  };

  const LocationSettings = () => {
    return (
      <>
        <Title title="Location Setings" back="group" />
        <LocationSettingsTab deviceId={searchParams.setupDevice} />
        <button
          onClick={() => setStep("camera")}
          class="w-full p-1 text-lg text-blue-500"
        >
          Next
        </button>
        <Additional />
      </>
    );
  };

  const [lowPowerMode, setLowPowerMode] = createSignal<boolean | null>(null);

  createEffect(
    on(
      () => searchParams.setupDevice,
      async (id) => {
        if (!id) return;
        const res = await deviceContext.getDeviceConfig(id);
        if (!res) {
          setLowPowerMode(null);
          return;
        }
        setLowPowerMode(
          res.values.thermalRecorder?.UseLowPowerMode ??
            res.defaults["thermal-recorder"]?.UseLowPowerMode ??
            null
        );
      }
    )
  );
  const turnOnLowPowerMode = async (v: boolean) => {
    try {
      setLowPowerMode(v);
      const res = await deviceContext.setLowPowerMode(
        searchParams.setupDevice,
        v
      );
      if (res !== null) {
        setLowPowerMode(v);
      } else {
        console.error("Failed to set low power mode");
      }
    } catch (error) {
      console.log(error);
    }
  };
  const CameraSettings = () => {
    return (
      <>
        <Title title="Camera Setings" back="location" />
        <CameraSettingsTab deviceId={searchParams.setupDevice} />
        <Show when={lowPowerMode() !== null}>
          <FieldWrapper type="custom" title={"Power Mode"}>
            <div class="flex w-full items-center bg-gray-100 px-1">
              <button
                onClick={() => turnOnLowPowerMode(false)}
                classList={{
                  "bg-white": lowPowerMode() === false,
                  "bg-gray-100": lowPowerMode() !== false,
                }}
                class="flex w-full appearance-none items-center justify-center rounded-lg bg-white p-1"
              >
                High
              </button>
              <button
                classList={{
                  "bg-white": lowPowerMode() === true,
                  "bg-gray-100": lowPowerMode() !== true,
                }}
                onClick={() => turnOnLowPowerMode(true)}
                class="flex w-full appearance-none items-center justify-center rounded-lg bg-white p-1"
              >
                Low
              </button>
            </div>
          </FieldWrapper>
          <div class="flex items-center space-x-2 px-2 text-sm text-gray-500">
            <AiOutlineInfoCircle size={18} />
            <Switch>
              <Match when={lowPowerMode() === true}>
                <p>Low power mode only uploads once per day.</p>
              </Match>
              <Match when={lowPowerMode() === false}>
                <p>High power mode uploads after every recording.</p>
              </Match>
            </Switch>
          </div>
        </Show>
        <button
          onClick={() => close()}
          class="w-full p-1 text-lg text-blue-500"
        >
          Finish Setup
        </button>
        <Additional />
      </>
    );
  };

  const show = () => showHelp() || currentStep();
  const [cancelledPrompt, setCancelledPrompt] = createSignal(false);
  createEffect(
    on(show, async (show) => {
      if (!cancelledPrompt() && show && !user.data()) {
        const { value } = await Dialog.confirm({
          title: "Login",
          message:
            "It's recommended that you login before proceeding. Would you like to login?",
        });
        if (!value) {
          setCancelledPrompt(true);
          return;
        }
        await user.logout();
      }
      if (!show) {
        setCancelledPrompt(false);
      }
    })
  );
  return (
    <Show when={show()}>
      <div class="shadow-lgm fixed left-1/2 top-20 z-40 h-auto w-11/12 -translate-x-1/2 transform rounded-xl border bg-white px-2 py-4">
        <Switch>
          <Match when={showHelp()}>
            <HelpSection onClose={toggleHelp} />
          </Match>
          <Match when={currentStep() === "chooseDevice"}>
            <ChooseDeviceStep />
          </Match>
          <Match when={currentStep() === "directConnect"}>
            <DirectConnectStep />
          </Match>
          <Match when={currentStep() === "searchingDevice"}>
            <SearchingDeviceStep />
          </Match>
          <Match when={currentStep() === "wifiSetup"}>
            <WifiSetup />
          </Match>
          <Match when={currentStep() === "group"}>
            <GroupSettings />
          </Match>
          <Match when={currentStep() === "location"}>
            <LocationSettings />
          </Match>
          <Match when={currentStep() === "camera"}>
            <CameraSettings />
          </Match>
        </Switch>
      </div>
    </Show>
  );
}

export default SetupWizard;
