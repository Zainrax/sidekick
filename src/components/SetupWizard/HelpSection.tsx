import { RiArrowsArrowLeftSLine } from "solid-icons/ri";
import { JSX } from "solid-js";
import Manual from "../Manual";

type HelpSectionProps = {
  onClose: () => void;
};

const HelpSection = (props: HelpSectionProps): JSX.Element => {
  return (
    <>
      <div class="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white">
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-x-1">
            <button class="text-blue-500" onClick={props.onClose}>
              <RiArrowsArrowLeftSLine size={32} />
            </button>
            <h2 class="text-2xl font-bold">Help</h2>
          </div>
          <button onClick={props.onClose} class="pr-4 text-2xl">
            &times;
          </button>
        </div>
        <div class="pb-bar">
          <Manual />
        </div>
      </div>
    </>
  );
};

export default HelpSection;
