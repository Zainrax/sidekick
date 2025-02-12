import { Browser } from "@capacitor/browser";
import { Dialog } from "@capacitor/dialog";
import { BsCameraVideoFill } from "solid-icons/bs";
import {
  FaRegularTrashCan,
  FaSolidAngleDown,
  FaSolidMusic,
} from "solid-icons/fa";
import { RiArrowsArrowRightSLine } from "solid-icons/ri";
import { For, Show, createMemo, createSignal, mergeProps } from "solid-js";
import ActionContainer from "~/components/ActionContainer";
import { useStorage } from "~/contexts/Storage";
import { useUserContext } from "~/contexts/User";
import { UploadedRecording } from "~/database/Entities/Recording";

interface DeviceRecordingsProps {
  deviceName: string;
  deviceId: string;
  recordings: UploadedRecording[];
  initialOpen?: boolean;
}

function DeviceRecordingsDisplay(props: DeviceRecordingsProps) {
  const merged = mergeProps({ open: false }, props);
  const [toggle, setToggle] = createSignal(merged.initialOpen);

  // Separate good vs corrupted
  const goodRecordings = createMemo(() =>
    props.recordings.filter((r) => r.uploadId !== null)
  );
  const corruptedCount = createMemo(
    () => props.recordings.filter((r) => r.uploadId === null).length
  );

  const openRecording = (id: string, isProd: boolean) => {
    Browser.open({
      url: `https://browse${
        isProd ? "" : "-test"
      }.cacophony.org.nz/recording/${id}`,
    });
  };
  const storage = useStorage();
  const user = useUserContext();
  return (
    <div class="mt-2 rounded-lg bg-white p-3 shadow">
      <div
        class="flex cursor-pointer items-center justify-between"
        onClick={() => setToggle(!toggle())}
      >
        <h1 class="text-xl font-semibold text-gray-800">{props.deviceName}</h1>
        <FaSolidAngleDown
          size={20}
          class={`transition-transform duration-300 ${
            toggle() ? "rotate-180" : ""
          }`}
        />
        <Show when={user.dev()}>
          <button
            class="text-red-500"
            onClick={async (e) => {
              const res = await Dialog.confirm({
                message: "Are you sure you want to delete recordings?",
              });
              if (res.value) {
                await storage.deleteUploadedRecordings(props.deviceId);
              }
            }}
          >
            <FaRegularTrashCan size={24} />
          </button>
        </Show>
      </div>
      <Show when={toggle()}>
        {/* Corrupted Counter */}
        <Show when={corruptedCount() > 0}>
          <div class="mt-2 font-medium text-red-600">
            Corrupted Files: {corruptedCount()}
          </div>
        </Show>
        <Show when={goodRecordings().length > 0}>
          <For each={goodRecordings()}>
            {(recording) => (
              <div
                onClick={() =>
                  openRecording(recording.uploadId!, recording.isProd)
                }
                class="cursor-pointer"
              >
                <ActionContainer
                  icon={
                    recording.name.endsWith("aac")
                      ? FaSolidMusic
                      : BsCameraVideoFill
                  }
                  action={
                    <>
                      <button class="text-blue-500">
                        <RiArrowsArrowRightSLine size={24} />
                      </button>
                    </>
                  }
                >
                  {recording.uploadId}
                </ActionContainer>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

function Recordings() {
  const storage = useStorage();

  // Group all uploaded recordings by device
  const Devices = createMemo(() => {
    const devicesMap = new Map<string, string>();
    for (const rec of storage.uploadedRecordings()) {
      if (!devicesMap.has(rec.device)) {
        devicesMap.set(rec.device, rec.deviceName);
      }
    }
    return devicesMap;
  });
  const DeviceNames = createMemo(() => {
    const devices = new Set(
      storage
        .uploadedRecordings()
        .map((rec) => ({ deviceName: rec.deviceName, deviceId: rec.device }))
    );
    return [...devices];
  });

  return (
    <section class="pb-bar pt-bar relative h-full space-y-2 overflow-y-auto bg-gray-100 px-2">
      <For each={[...Devices().entries()]}>
        {([deviceId, deviceName]) => (
          <DeviceRecordingsDisplay
            deviceId={deviceId}
            deviceName={deviceName}
            recordings={storage
              .uploadedRecordings()
              .filter((rec) => rec.deviceName === deviceName)}
            {...(Devices().size === 1 && { initialOpen: true })}
          />
        )}
      </For>
    </section>
  );
}

export default Recordings;
