import { Dialog as Prompt } from "@capacitor/dialog";
import { debounce, leading } from "@solid-primitives/scheduled";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { AiOutlineUnorderedList } from "solid-icons/ai";
import { BiRegularCurrentLocation, BiSolidBattery } from "solid-icons/bi";
import { BsBattery, BsCameraVideoFill } from "solid-icons/bs";
import {
  FaSolidBatteryFull,
  FaSolidSpinner,
  FaSolidStop,
} from "solid-icons/fa";
import { FiDownload } from "solid-icons/fi";
import { ImCog, ImNotification, ImSearch } from "solid-icons/im";
import { RiDeviceRouterFill, RiArrowsArrowRightSLine } from "solid-icons/ri";
import {
  TbBatteryFilled,
  TbCurrentLocation,
  TbPlugConnectedX,
} from "solid-icons/tb";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import ActionContainer from "~/components/ActionContainer";
import BackgroundLogo from "~/components/BackgroundLogo";
import CircleButton from "~/components/CircleButton";
import { DeviceSettingsModal } from "~/components/DeviceSettings";
import { useHeaderContext } from "~/components/Header";
import SetupWizard from "~/components/SetupWizard";
import { useDevice } from "~/contexts/Device";
import { useStorage } from "~/contexts/Storage";
import { useUserContext } from "~/contexts/User";

interface DeviceDetailsProps {
  id: string;
  name: string;
  groupName: string;
  isConnected: boolean;
  url?: string;
  isProd: boolean;
  batteryPercentage?: string;
}

function DeviceDetails(props: DeviceDetailsProps) {
  const context = useDevice();
  const storage = useStorage();
  const userContext = useUserContext();
  const savedRecs = () =>
    storage
      .savedRecordings()
      .filter((rec) => rec.device === props.id && !rec.isUploaded);
  const device = () => context.devices.get(props.id);
  const needsSetup = () => device()?.group === "new";
  const deviceRecs = () => context.deviceRecordings.get(props.id) ?? [];
  const savedEvents = () =>
    storage
      .savedEvents()
      .filter((event) => event.device === props.id && !event.isUploaded);
  const eventKeys = () => context.deviceEventKeys.get(props.id) ?? [];
  const disabledDownload = () => {
    const hasRecsToDownload =
      deviceRecs().length > 0 && deviceRecs().length !== savedRecs().length;
    const hasEventsToDownload =
      eventKeys().length > 0 && savedEvents().length !== eventKeys().length;
    return !hasRecsToDownload && !hasEventsToDownload;
  };
  const [, setParams] = useSearchParams();

  const openDeviceInterface = leading(
    debounce,
    () => {
      if (!props.isConnected) return;
      if (!userContext.dev() && needsSetup()) {
        setParams({
          setupDevice: props.id,
          step: "wifiSetup",
        });
      } else {
        setParams({ deviceSettings: props.id });
      }
    },
    800
  );

  const [showTooltip, setShowTooltip] = createSignal(false);

  const updateLocState = () => context.shouldDeviceUpdateLocation(props.id);

  createEffect(() => {
    console.log("BATTERY", props.batteryPercentage);
  });

  return (
    <ActionContainer
      disabled={!props.isConnected}
      action={
        <Show when={props.isConnected}>
          <button
            class="flex items-center text-blue-500"
            onClick={() => openDeviceInterface()}
          >
            <Show when={needsSetup()}>
              <p>Setup</p>
            </Show>
            <RiArrowsArrowRightSLine size={32} />
          </button>
        </Show>
      }
    >
      <div class=" flex items-center justify-between px-2">
        <div class="w-full" onClick={() => openDeviceInterface()} role="button">
          <div class="flex items-center space-x-1 ">
            <Show when={!props.isProd}>
              <ImCog size={20} />
            </Show>
            <h1 class="break-all text-left text-sm">{props.name}</h1>
          </div>
          <Show
            when={
              props.batteryPercentage !== "0" &&
              props.batteryPercentage !== "" &&
              props.batteryPercentage
            }
          >
            {(percentage) => (
              <div class="mt-2 flex w-full items-center space-x-2 text-slate-700">
                <FaSolidBatteryFull size={20} />
                <p class="text-sm">Battery: {percentage()}%</p>
              </div>
            )}
          </Show>
          <div class="mt-2 flex w-full items-center space-x-2 text-slate-700">
            <BsCameraVideoFill size={20} />
            <p class="text-sm">
              Recordings Saved: {savedRecs().length}/{deviceRecs().length}{" "}
            </p>
          </div>
          <div class="mt-2 flex w-full items-center space-x-2 text-slate-700">
            <AiOutlineUnorderedList size={20} />
            <p class="text-sm">
              Events Saved:{" "}
              {
                storage.savedEvents().filter((val) => val.device === props.id)
                  .length
              }
              /{context.deviceEventKeys.get(props.id)?.length ?? 0}{" "}
            </p>
          </div>
        </div>
        <Show
          when={props.isConnected}
          fallback={
            <div class="px-8 text-neutral-700">
              <TbPlugConnectedX size={32} />
            </div>
          }
        >
          <div class=" flex items-center space-x-6 px-2 text-blue-500">
            <Show
              when={!context.devicesDownloading.has(props.id)}
              fallback={
                <button
                  class="text-red-500"
                  onClick={() => context.stopSaveItems(props.id)}
                >
                  <FaSolidStop size={28} />
                </button>
              }
            >
              <button
                class={`${
                  disabledDownload() ? "text-slate-300" : "text-blue-500"
                }`}
                disabled={disabledDownload()}
                onClick={() => context.saveItems(props.id)}
              >
                <FiDownload size={28} />
              </button>
            </Show>
            <button
              class="relative text-blue-500"
              disabled={
                context.locationBeingSet.has(props.id) ||
                ["loading", "unavailable"].includes(updateLocState())
              }
              title={
                updateLocState() === "unavailable"
                  ? "Please enable permissions in your settings."
                  : ""
              }
              onClick={() => {
                openDeviceInterface();
                setParams({ tab: "Location" });
              }}
              onTouchStart={() =>
                updateLocState() === "unavailable" && setShowTooltip(true)
              }
              onTouchEnd={() => setShowTooltip(false)}
              onMouseEnter={() =>
                updateLocState() === "unavailable" && setShowTooltip(true)
              }
              onMouseLeave={() => setShowTooltip(false)}
            >
              <Show when={showTooltip()}>
                <div class="relative">
                  <div class="absolute bottom-full right-0 mb-2 -translate-x-0.5 transform whitespace-nowrap rounded bg-gray-700 p-1 text-xs text-white">
                    Please enable permissions in your settings.
                  </div>
                </div>
              </Show>
              <Switch>
                <Match
                  when={
                    updateLocState() === "loading" ||
                    context.locationBeingSet.has(props.id)
                  }
                >
                  <FaSolidSpinner size={28} class="animate-spin" />
                </Match>
                <Match when={updateLocState() === "current"}>
                  <BiRegularCurrentLocation size={28} />
                </Match>
                <Match when={updateLocState() === "unavailable"}>
                  <div class="text-gray-200">
                    <BiRegularCurrentLocation size={28} />
                  </div>
                </Match>
                <Match when={updateLocState() === "needsUpdate"}>
                  <div class="text-yellow-400">
                    <TbCurrentLocation size={28} />
                  </div>
                </Match>
              </Switch>
            </button>
          </div>
        </Show>
      </div>
    </ActionContainer>
  );
}

export function isKeyOfObject<T extends object>(
  key: string | number | symbol,
  obj: T
): key is keyof T {
  return key in obj;
}

function Devices() {
  const context = useDevice();
  const devices = () => [...context.devices.values()];
  const [groupPromptCancelled, setGroupCancelledPrompt] = createSignal(false);
  const [locPromptCancelled, setPromptCancel] = createSignal(false);
  const headerContext = useHeaderContext();

  onMount(() => {
    // Add delete button to header
    const header = headerContext?.headerMap.get("/devices");
    if (!header || header?.[1]) return;
    headerContext?.headerMap.set("/devices", [
      header[0],
      () => (
        <Show
          when={context.apState() !== "loading" && context.apState()}
          fallback={
            <span class="text-blue-500">
              <FaSolidSpinner size={28} class="animate-spin" />
            </span>
          }
        >
          {(state) => (
            <button
              onClick={async () => {
                if (state() === "connected") {
                  const dialog = await Prompt.confirm({
                    title: "Disconnect from Device",
                    message:
                      "You are currently connected to the device's WiFi network. Disconnect from the device to connect to another network?",
                  });
                  if (dialog.value) {
                    context.disconnectFromDeviceAP();
                  }
                } else {
                  context.connectToDeviceAP();
                }
              }}
              classList={{
                "text-blue-500":
                  state() === "default" || state() === "disconnected",
                "text-highlight": state() === "connected",
              }}
            >
              <RiDeviceRouterFill size={28} />
            </button>
          )}
        </Show>
      ),
    ]);
  });

  onMount(async () => {
    context.searchDevice();
    const search = setInterval(() => {
      context.searchDevice();
    }, 6 * 1000);

    onCleanup(() => {
      clearInterval(search);
    });
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [isDialogOpen, setIsDialogOpen] = createSignal(false);
  createEffect(
    on(
      () => {
        if (context.devicesLocToUpdate.loading) return false;
        return [context.devicesLocToUpdate()] as const;
      },
      async (sources) => {
        if (!sources) return;
        const [devices] = sources;
        if (!devices) return;

        const devicesToUpdate = devices.filter(
          (val) => !context.locationBeingSet.has(val)
        );
        if (
          devicesToUpdate.length === 0 ||
          locPromptCancelled() ||
          isDialogOpen() ||
          searchParams.setupDevice
        )
          return;
        if (devicesToUpdate.length === 1) {
          const device = context.devices.get(devicesToUpdate[0]);
          if (device) {
            // if it's new and not in the setup wizard prompt the user to do so.
            if (device.group === "new") {
              if (groupPromptCancelled()) return;
              const message = `Looks like ${device.name} needs to be setup. Would you like to setup the group and location?`;
              setIsDialogOpen(true);
              const { value } = await Prompt.confirm({
                title: "Setup Device",
                message,
              });
              if (value) {
                setSearchParams({
                  setupDevice: devicesToUpdate[0],
                  step: "wifiSetup",
                });
              } else {
                setGroupCancelledPrompt(true);
              }
              setIsDialogOpen(false);
            } else {
              const message = `${
                context.devices.get(devicesToUpdate[0])?.name
              } has a different location stored. Would you like to update it to your current location?`;

              setIsDialogOpen(true);
              const { value } = await Prompt.confirm({
                title: "Update Location",
                message,
              });

              if (value) {
                await context.setDeviceToCurrLocation(devicesToUpdate[0]);
                setSearchParams({
                  deviceSettings: devicesToUpdate[0],
                  tab: "Location",
                });
              } else {
                setPromptCancel(true);
              }
              setIsDialogOpen(false);
            }
          }
        } else {
          const message = `${devicesToUpdate
            .map((val) => context.devices.get(val)?.name)
            .join(
              ", "
            )} have different location stored. Would you like to update them to the current location?`;

          setIsDialogOpen(true);
          const { value } = await Prompt.confirm({
            title: "Update Location",
            message,
          });
          setIsDialogOpen(false);
          if (value) {
            for (const device of devicesToUpdate) {
              await context.setDeviceToCurrLocation(device);
            }
            setSearchParams({
              deviceSettings: devicesToUpdate[0],
              tab: "Location",
            });
          } else {
            setPromptCancel(true);
          }
        }
      }
    )
  );

  const findDevice = () => {
    setSearchParams({ step: "chooseDevice" });
  };

  return (
    <>
      <section class="pb-bar pt-bar relative z-20 space-y-2 overflow-y-auto px-2">
        <For
          each={devices().sort((dev) =>
            dev.isConnected ? -1 : dev.isProd ? 1 : 0
          )}
        >
          {(device) => (
            <DeviceDetails
              id={device.id}
              name={device.name}
              url={device.isConnected ? device.url : ""}
              isProd={device.isProd}
              isConnected={device.isConnected}
              groupName={device.group}
              batteryPercentage={device.batteryPercentage}
            />
          )}
        </For>
        <div class="h-32" />
        <Portal>
          <div class="pb-bar fixed inset-x-0 bottom-2 z-20 mx-auto flex justify-center">
            <button
              class="flex rounded-md bg-white px-4 py-4"
              onClick={findDevice}
            >
              <div class="text-blue-500">
                <ImSearch size={28} />
              </div>
              <p>Find Device</p>
            </button>
          </div>
        </Portal>
        <Portal>
          <>
            <SetupWizard />
            <DeviceSettingsModal />
          </>
        </Portal>
      </section>
      <div class="pt-bar fixed inset-0 z-0 flex flex-col pb-32">
        <div class="my-auto">
          <BackgroundLogo />
          <div class="flex h-32 w-full justify-center">
            <Show when={context.devices.size <= 0}>
              <p class="mt-4 max-w-sm px-4 text-center text-sm text-neutral-600">
                No devices detected.
                <br />
                Follow the instructions in "Find Device" below. You can connect
                to a device using the top right
                <span class="mx-1 inline-block text-blue-500">
                  <RiDeviceRouterFill />
                </span>
                button.
              </p>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}

export default Devices;
