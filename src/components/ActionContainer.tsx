import type { IconTypes } from "solid-icons";
import { type JSX, Show } from "solid-js";

const ActionContainer = (props: {
  icon?: IconTypes;
  disabled?: boolean;
  header?: string;
  children: JSX.Element;
  action?: JSX.Element;
}) => {
  return (
    <div
      classList={{
        "bg-neutral-100": props.disabled,
        "bg-white": !props.disabled,
      }}
      class="h-min-2 relative mb-2 mt-2 flex flex-row items-center justify-between rounded-xl px-3 py-4"
    >
      <div class="flex w-full flex-row items-center gap-x-4">
        {props.icon && (
          <div class="text-gray-700">
            <props.icon size={38} class="text-4xl" />
          </div>
        )}
        <div class="w-full">
          <Show when={props.header}>
            <h1 class="text-base font-semibold text-gray-500">
              {props.header}
            </h1>
          </Show>
          {props.children}
        </div>
      </div>
      <div class="z-30 flex items-center justify-center">
        <Show when={props.action}>{props.action}</Show>
      </div>
    </div>
  );
};

export default ActionContainer;
