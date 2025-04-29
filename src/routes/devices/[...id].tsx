import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "@solidjs/router";
import { Show, createEffect, createMemo, onMount } from "solid-js";
import { useHeaderContext } from "~/components/Header";
import { useDevice } from "~/contexts/Device";
import { App } from "@capacitor/app";
function DeviceSettings() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const context = useDevice();
  const nav = useNavigate();
  const device = createMemo(() => {
    const device = context.devices.get(params.id);
    if (!device || !device.isConnected) {
      console.log("navigate to devices");
      nav("/devices");
      return;
    }
    return device;
  });
  const location = useLocation();
  const childPath = () => {
    const path = location.pathname.split("/");
    const id = path.filter((p) => !isNaN(Number.parseInt(p)) && p.length > 0)[0];

    const childPath = path.slice(path.indexOf(id) + 1)[0];
    return [Number.parseInt(id), childPath] as const;
  };
  const url = createMemo(
    () =>
      (childPath()[1] ? device()?.url + "/" + childPath()[1] : device()?.url) ??
      "/devices"
  );
  const headerContext = useHeaderContext();
  onMount(() => {
    headerContext?.headerMap.set(location.pathname, [
      "Device Settings",
      undefined,
      `/devices?deviceSettings=${childPath()[0]}`,
    ]);
  });
  createEffect(() => {
    if (!device()?.isConnected) {
      console.log("navigate to devices");
      const params = searchParams;
      nav("/devices");
      setSearchParams(params);
    }
    App.addListener("appStateChange", async (state) => {
      const currDevice = device();
      if (state.isActive && currDevice && currDevice.isConnected) {
        // App has been brought back to the foreground
        const isConnected = context.apState() === "connected";
        if (!isConnected) {
          console.log("navigate to devices");
          const params = searchParams;
          setSearchParams(params);
        }
      }
    });
  });
  return (
    <>
      <section class="pb-bar pt-bar relative h-screen">
        <Show when={device()}>
          {(dev) => {
            return <iframe class="h-full w-full max-w-[100vw]" src={url()} />;
          }}
        </Show>
      </section>
    </>
  );
}

export default DeviceSettings;
