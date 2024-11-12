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
  createResource,
  createMemo,
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
import { TbPlugConnectedX } from "solid-icons/tb";
import { getSteps } from "../Manual";
export type ColorType = "blue" | "green" | "yellow" | "gray" | "red";
export type DeviceType = "DOC AI Cam / Bird Monitor" | "Classic";

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
export const DeviceTypeButton = (props: DeviceTypeButtonProps): JSX.Element => (
  <button
    class={`rounded px-4 py-2 ${
      props.isSelected
        ? "bg-white outline outline-2 outline-green-500"
        : "bg-gray-200"
    }`}
    onClick={props.onClick}
  >
    {props.children}
  </button>
);

type LightSequenceType = "short" | "long" | "blink";
export type LightSequence = LightSequenceType[];

type StepType = {
  color: ColorType;
  label: string;
  duration: string;
  sequence: LightSequence;
};

type StartupProcessProps = {
  steps: StepType[];
};

export const colorClasses: Record<ColorType, string> = {
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
        keyframes.push(0, 1);
        durations.push(1, 1);
        break;
      case "long":
        keyframes.push(0, 1);
        durations.push(2, 2);
        break;
      case "blink":
        keyframes.push(0, 1);
        durations.push(0.1, 0.2);
        break;
    }
  }

  const duration = durations.reduce((a, b) => a + b, 0);
  let offset = 0;
  return {
    opacity: keyframes,
    transition: {
      duration,
      ease: "ease-in-out",
      repeat: Infinity,
      opacity: {
        offset: durations.map((val) => {
          const value = val / duration;
          const offsetValue = value + offset;
          offset += value;
          return Math.min(offsetValue, 1);
        }),
      },
    },
  };
};

export const LightSequence = (props: {
  sequence: LightSequence;
  color: ColorType;
}) => {
  const { opacity, transition } = createLightAnimation(props.sequence);
  return (
    <Motion
      class={`h-4 w-4 rounded-full ${colorClasses[props.color]}`}
      animate={{ opacity }}
      transition={transition}
    />
  );
};

export const Light = (props: { step: StepType }) => (
  <div class="flex flex-col items-center">
    <LightSequence sequence={props.step.sequence} color={props.step.color} />
    <span class="mt-1 text-xs">{props.step.label}</span>
    <span class="mt-1 text-xs">{props.step.duration}</span>
  </div>
);

export const StartupProcess = (props: StartupProcessProps): JSX.Element => (
  <div class="mb-4">
    <h3 class="mb-2 font-bold">Startup Process</h3>
    <div class="flex items-center">
      <For each={props.steps}>
        {(step, index) => (
          <>
            <Light step={step} />
            {index() < props.steps.length - 1 && (
              <div class="mx-2 h-px flex-grow bg-gray-300" />
            )}
          </>
        )}
      </For>
    </div>
  </div>
);

export const getStartupSteps = (deviceType: DeviceType): StepType[] => {
  if (deviceType === "DOC AI Cam / Bird Monitor") {
    return [
      { color: "blue", label: "Bootup", duration: "30s", sequence: ["long"] },
      {
        color: "green",
        label: "Checks WiFi",
        duration: "10s",
        sequence: ["long"],
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
        sequence: ["long", "blink", "blink"],
      },
      {
        color: "blue",
        label: "Checks WiFi",
        duration: "10s",
        sequence: ["short", "short"],
      },
      {
        color: "blue",
        label: "Can Connect",
        duration: "5m",
        sequence: ["long"],
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
  const device = () => deviceContext.devices.get(searchParams.setupDevice);
  const setStep = (step: Steps): void => {
    setSearchParams({ step });
  };
  const close = () => setSearchParams({ step: "" });
  const finishSetup = () => {
    close();
  };
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
    <div class="mb-2 flex items-center justify-between px-4">
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
    <div class="flex-end mt-4 flex items-center border-t-2 border-gray-200 px-2 pt-2">
      <HelpButton />
    </div>
  );
  const DirectConnectStep = (): JSX.Element => (
    <>
      <Title title="Connect To Device" />
      <div class="mb-4 flex space-x-2">
        <DeviceTypeButton
          isSelected={store.deviceType === "DOC AI Cam / Bird Monitor"}
          onClick={() => setStore("deviceType", "DOC AI Cam / Bird Monitor")}
        >
          DOC AI Cam / Bird Monitor
        </DeviceTypeButton>
        <DeviceTypeButton
          isSelected={store.deviceType === "Classic"}
          onClick={() => setStore("deviceType", "Classic")}
        >
          Classic
        </DeviceTypeButton>
      </div>
      {store.deviceType && getSteps(store.deviceType)}
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
        <Switch fallback={<>Connect To Camera</>}>
          <Match when={connectionStatus() === "default"}>
            Connect To Camera
          </Match>
          <Match when={connectionStatus() === "loadingConnect"}>
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

  const AIDocSVG = () => (
    <svg
      height="150"
      viewBox="0 0 148 190"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 14C0 6.26801 6.26801 0 14 0H120.91C123.581 0 126.196 0.764147 128.447 2.20225L140.093 9.64297C142.003 10.8628 143.587 12.5277 144.711 14.4948L144.964 14.9373C146.293 17.2635 146.927 19.9223 146.791 22.598L139.627 162.74C139.268 169.756 133.766 175.42 126.764 175.981L24.1672 184.206C21.7632 184.399 19.3502 183.967 17.162 182.953L8.11355 178.76C3.16609 176.467 0 171.51 0 166.058V14Z"
        fill="#8CA58D"
      />
      <rect x="9" y="9" width="139" height="175" rx="14" fill="#486C49" />
      <rect
        width="56.0954"
        height="53.7699"
        rx="26.8849"
        transform="matrix(0.991488 0.130198 0.130198 -0.991488 51 115.312)"
        fill="#729E73"
      />
      <path
        d="M95 184.059C101.227 173.229 100.458 132.662 95 116.5L86.5 66C121.618 67.3159 129 147.5 129 184.059L95 184.059Z"
        fill="#729E73"
      />
      <g filter="url(#filter0_d_0_1)">
        <path
          d="M69 80C69 79.4477 69.4477 79 70 79H93.5C94.0523 79 94.5 79.4477 94.5 80V104C94.5 104.552 94.0523 105 93.5 105H70C69.4477 105 69 104.552 69 104V80Z"
          fill="#F4FFEF"
        />
      </g>
      <path
        d="M9 144H70C74.4183 144 78 147.582 78 152V152C78 156.418 74.4183 160 70 160H9V144Z"
        fill="#363636"
      />
      <rect x="59" y="146" width="12" height="12" rx="6" fill="#71EF45" />
      <rect
        x="47.5"
        y="148.5"
        width="7"
        height="7"
        rx="3.5"
        fill="#71EF45"
        stroke="url(#paint0_linear_0_1)"
      />
      <rect x="14" y="146" width="22" height="12" fill="white" />
      <rect x="25" y="34" width="28" height="28" rx="14" fill="#729E73" />
      <path
        d="M53.5 9C55.9 14.2 51.5 30.5 49 38L40.5 62C55 62 64.1667 26.3333 67.5 9H53.5Z"
        fill="#729E73"
      />
      <defs>
        <filter
          id="filter0_d_0_1"
          x="64.2"
          y="74.2"
          width="35.1"
          height="35.6"
          filterUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feFlood flood-opacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="2.4" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0"
          />
          <feBlend
            mode="normal"
            in2="BackgroundImageFix"
            result="effect1_dropShadow_0_1"
          />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="effect1_dropShadow_0_1"
            result="shape"
          />
        </filter>
        <linearGradient
          id="paint0_linear_0_1"
          x1="51"
          y1="148"
          x2="51"
          y2="156"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="#EDEDED" />
          <stop offset="1" stop-color="#EEEEEE" />
        </linearGradient>
      </defs>
    </svg>
  );

  const ClassicSVG = () => (
    <svg
      height="150"
      viewBox="0 0 160 194"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 2C3 0.895435 3.89543 0 5 0H127.431C127.803 0 128.168 0.103707 128.484 0.29947L158.553 18.9136C159.142 19.2782 159.5 19.9215 159.5 20.6141V26.5L142.18 173.476C142.074 174.375 141.377 175.091 140.482 175.221L22.9428 192.363C22.3464 192.449 21.7425 192.263 21.2992 191.855L3.64505 175.594C3.23391 175.215 3 174.682 3 174.123V2Z"
        fill="#A9A9A9"
      />
      <path d="M2.5 33H6.5H7.5V35L2.5 33Z" fill="#D9D9D9" />
      <rect x="21" y="19" width="139" height="175" rx="2" fill="#CBCBCB" />
      <rect x="37" y="52" width="110" height="59" fill="#F2F2F2" />
      <path
        d="M7 33L13.5 35L18 46.5V60L13.5 71L7 67L4.5 53.5V40L7 33Z"
        fill="#D9D9D9"
      />
      <path d="M9 71H13.2353L18 60H13.2353L9 71Z" fill="#D9D9D9" />
      <path
        d="M2.5 33L9 35L13.5 46.5V60L9 71L2.5 67L0 53.5V40L2.5 33Z"
        fill="#D9D9D9"
      />
      <path
        d="M3.22222 36L9 37.7895L13 48.0789V60.1579L9 70L3.22222 66.4211L1 54.3421V42.2632L3.22222 36Z"
        fill="#B6B6B6"
      />
      <path
        d="M3.22222 36L9 37.7895L13 48.0789V60.1579L9 70L3.22222 66.4211L1 54.3421V42.2632L3.22222 36Z"
        fill="#B6B6B6"
      />
      <path
        d="M14 90.5C14 96.299 11.9853 101 9.5 101C7.01472 101 2.5 96.299 2.5 90.5C2.5 84.701 7.01472 80 9.5 80C11.9853 80 14 84.701 14 90.5Z"
        fill="url(#paint0_radial_0_1)"
      />
      <ellipse
        cx="6.59191"
        cy="52.1868"
        rx="5"
        ry="15"
        transform="rotate(-2.27661 6.59191 52.1868)"
        fill="url(#paint1_radial_0_1)"
      />
      <ellipse cx="3.5" cy="90.5" rx="0.5" ry="1.5" fill="#6A67F0" />
      <defs>
        <radialGradient
          id="paint0_radial_0_1"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(9.5 90) scale(4.5 11)"
        >
          <stop stop-color="#818181" />
          <stop offset="1" stop-color="#494949" />
        </radialGradient>
        <radialGradient
          id="paint1_radial_0_1"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(6.59191 52.1868) rotate(90) scale(15 5)"
        >
          <stop offset="0.71" stop-color="#CDCDCD" />
          <stop offset="1" stop-color="#8B8B8B" />
        </radialGradient>
      </defs>
    </svg>
  );
  const devices = () => [...deviceContext.devices.values()];

  const ChooseDeviceStep = () => (
    <>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="pl-4 text-xl font-bold">Choose your Device</h2>
        <CloseButton onClick={() => navigate("/devices")} />
      </div>
      <Show when={devices().length}>
        <div class="mb-2">
          <h1 class="text-md font-medium text-slate-700">Existing Devices</h1>
          <FoundDevices />
        </div>
      </Show>
      <div>
        <h2 class="text-md pl-1  font-medium text-slate-700">
          Connect To Device
        </h2>
        <p class="mb-4 text-center">
          Turn on your device and choose the device that matches
        </p>
        <div class="flex justify-center space-x-4">
          <button
            class="flex flex-col items-center rounded-lg bg-green-200 p-4"
            onClick={() => {
              setStore("deviceType", "DOC AI Cam / Bird Monitor");
              setStep("directConnect");
            }}
          >
            <AIDocSVG />
            <span>DOC AI Cam/ Bird Monitor</span>
          </button>
          <button
            class="flex flex-col items-center rounded-lg bg-gray-200 p-4"
            onClick={() => {
              setStore("deviceType", "Classic");
              setStep("directConnect");
            }}
          >
            <ClassicSVG />
            <span>Classic Thermal Camera</span>
          </button>
        </div>
      </div>
      <Additional />
    </>
  );

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
  const FoundDevices = () => (
    <div class="space-y-1 rounded-lg bg-gray-200 p-1">
      <Show when={!!devices()} fallback={<div>No devices found...</div>}>
        <For each={devices().filter((device) => device.isConnected)}>
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
  );
  const SearchingDeviceStep = () => (
    <>
      <Title title="Searching For Device" />
      <p class="text-center text-sm text-gray-800">
        If your device does not show ensure your phone/tablet is connected to
        the “bushnet” network in your WiFi settings, if not join the network
        with password “feathers”
      </p>
      <FoundDevices />
      <Additional />
    </>
  );

  const StepProgressIndicator = (props: {
    nextStep?: Steps;
    canProcceed?: boolean;
    requirementText?: string;
    place: number;
  }) => {
    const totalSteps = 4;
    const canProcceed = () =>
      props.canProcceed === undefined || props.canProcceed === true;
    return (
      <div class="flex w-full flex-col items-center justify-center">
        <div class="flex w-full items-center justify-center gap-x-2">
          <For each={new Array(totalSteps)}>
            {(_, index) => (
              <div class="flex items-center justify-center">
                <div class="relative flex h-4 w-4 rounded-full bg-gray-300" />
                <Show when={props.place === index()}>
                  <div class="absolute h-3 w-3 rounded-full bg-white" />
                </Show>
              </div>
            )}
          </For>
        </div>
        <Show
          when={props.place === totalSteps - 1}
          fallback={
            <div class="flex flex-col items-center">
              <button
                onClick={() => {
                  setStep(props.nextStep!);
                }}
                classList={{
                  "text-blue-500": canProcceed(),
                  "text-gray-400": props.canProcceed === false,
                }}
                class="text-md relative flex items-center justify-center p-2"
                disabled={!canProcceed()}
              >
                Next Step
                <div class="absolute right-[-1em]"></div>
              </button>
              <Show when={props.canProcceed === false && props.requirementText}>
                {(requirementText) => (
                  <p class="text-sm text-gray-800">{requirementText()}</p>
                )}
              </Show>
            </div>
          }
        >
          <div class="flex flex-col items-center justify-center">
            <button
              onClick={() => finishSetup()}
              class="relative flex items-center justify-center p-2 text-lg text-blue-500"
            >
              Finish Setup
            </button>
          </div>
        </Show>
      </div>
    );
  };

  const WifiSetup = () => {
    const context = useDevice();
    const [hasConnection] = createResource(async () => {
      const res = await context.deviceHasInternet(searchParams.setupDevice);
      return res;
    });
    return (
      <>
        <Title title="Wifi Setings" back="searchingDevice" />
        <div class="flex flex-col gap-y-2 text-xs">
          <p class="text-center">
            The camera/bird monitor may temporarily disconnect, ensure that your
            phone is connected to the same WiFi.
          </p>
          <p class="text-center">
            Follow instructions in Help {">"} Connection Method {">"} Phone
            hotspot to connect device to hotspot.
          </p>
        </div>
        <WifiSettingsTab deviceId={searchParams.setupDevice} />
        <StepProgressIndicator
          canProcceed={!hasConnection.loading && hasConnection()}
          requirementText={"Internet connection required to setup."}
          nextStep="group"
          place={0}
        />
        <Additional />
      </>
    );
  };

  const GroupSettings = () => {
    const device = () => deviceContext.devices.get(searchParams.setupDevice);
    const group = () => device()?.group;
    return (
      <>
        <Title title="Set Device Group" back="wifiSetup" />
        <div class="flex flex-col gap-y-2 px-8 text-center text-sm">
          Assign your device to a group so that you can view it in
          browse.cacophony.org.nz
        </div>
        <div class="space-y-4 px-4">
          <GroupSelect deviceId={searchParams.setupDevice} />
          <StepProgressIndicator
            nextStep="location"
            place={1}
            requirementText={"Group assignment required."}
            canProcceed={group() !== "new"}
          />
        </div>
        <Additional />
      </>
    );
  };

  const LocationSettings = () => {
    const shouldUpdateLocState = () =>
      deviceContext.shouldDeviceUpdateLocation(searchParams.setupDevice);

    const [locationRes, { refetch: refetchLocation }] =
      deviceContext.getLocationByDevice(searchParams.setupDevice);
    const location = createMemo(() => locationRes());
    createEffect(() => {
      on(
        () => shouldUpdateLocState(),
        async (shouldUpdate) => {
          if (shouldUpdate === "loading") return;
          refetchLocation();
        }
      );
    });

    const [locCoords, { refetch }] = createResource(
      () => searchParams.setupDevice,
      async (id) => {
        const res = await deviceContext.getLocationCoords(id);
        if (res.success) return res.data;
        return null;
      }
    );
    const lat = () => locCoords()?.latitude ?? "...";
    const lng = () => locCoords()?.longitude ?? "...";
    const hasLocation = () =>
      location() !== null || (lat() !== 0 && lng() !== 0);

    return (
      <>
        <Title title="Location Settings" back="group" />
        <LocationSettingsTab deviceId={searchParams.setupDevice} />
        <StepProgressIndicator
          nextStep="camera"
          place={2}
          canProcceed={hasLocation()}
        />
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
            <div class="flex w-full items-center gap-x-2 bg-gray-100 px-1">
              <button
                onClick={() => turnOnLowPowerMode(false)}
                classList={{
                  "bg-white outline outline-2 outline-green-500":
                    lowPowerMode() === false,
                  "bg-gray-100": lowPowerMode() !== false,
                }}
                class="flex w-full appearance-none items-center justify-center rounded-lg p-1"
              >
                High
              </button>
              <button
                classList={{
                  "bg-white outline outline-2 outline-green-500":
                    lowPowerMode() === true,
                  "bg-gray-100": lowPowerMode() !== true,
                }}
                onClick={() => turnOnLowPowerMode(true)}
                class="flex w-full appearance-none items-center justify-center rounded-lg p-1"
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
        <StepProgressIndicator place={3} />
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
      <div class="fixed left-1/2 top-[70px] z-40 h-auto w-11/12 -translate-x-1/2 transform rounded-xl border bg-white px-2 py-4 shadow-lg">
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
          <Match
            when={
              !device()?.isConnected &&
              !deviceContext.devicesConnectingToWifi.has(device()?.id) &&
              device()
            }
          >
            {(device) => (
              <>
                <Title
                  title="Device Disconnected"
                  back={
                    deviceContext.apState() === "default"
                      ? "chooseDevice"
                      : "searchingDevice"
                  }
                />
                <div class="flex w-full flex-col items-center">
                  <div class="px-8 text-neutral-700">
                    <TbPlugConnectedX size={82} />
                  </div>
                  <p class="text-center text-lg font-bold text-gray-600">
                    Device "{device().name}" Disconnected
                  </p>
                </div>
              </>
            )}
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
