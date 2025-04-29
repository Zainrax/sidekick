import { App } from "@capacitor/app";
import { createContextProvider } from "@solid-primitives/context";
import { ReactiveMap } from "@solid-primitives/map";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { RiArrowsArrowLeftSLine } from "solid-icons/ri";
import { type JSXElement, createEffect, createSignal, onMount } from "solid-js";

type Header = string;
type BackLink = string;
type HeaderButton = () => JSXElement;

export const [HeaderProvider, useHeaderContext] = createContextProvider(() => {
  const headerMap = new ReactiveMap<string, [Header, HeaderButton?, BackLink?]>(
    [
      ["/", ["Devices"]],
      ["/devices", ["Devices"]],
      ["/storage", ["Storage"]],
      ["/storage/recordings", ["Uploaded"]],
      ["/settings", ["Settings"]],
      ["/settings/user", ["User"]],
      ["/manual", ["Manual"]],
    ]
  );
  const location = useLocation();
  const [HeaderButton, setHeaderButton] = createSignal<HeaderButton>();
  const [header, setHeader] = createSignal<string>(
    headerMap.get(location.pathname)?.[0] ?? "Dashboard"
  );
  const [backNav, setBackNav] = createSignal<JSXElement>();
  const navigate = useNavigate();
  const [link, setLink] = createSignal("");
  onMount(() => {
    App.addListener("backButton", () => {
      navigate(link());
    });
  });
  createEffect(() => {
    if (headerMap.has(location.pathname)) {
      const newHeader = headerMap.get(location.pathname) ?? ["Dashboard"];
      setHeaderButton(() => newHeader[1]);
      setHeader(newHeader[0]);
      const newLink = newHeader[2];
      if (newLink) {
        setLink(newLink);
        setBackNav(
          <A href={link()} class="flex items-center text-xl text-blue-500">
            <RiArrowsArrowLeftSLine size={32} />
          </A>
        );
      } else {
        const link = location.pathname.split("/").slice(0, -1);
        if (link.length > 1) {
          setBackNav(
            <A
              href={link.join("/")}
              class="flex items-center text-xl text-blue-500"
            >
              <RiArrowsArrowLeftSLine size={32} />
            </A>
          );
          App.addListener("backButton", () => {
            navigate(link.join("/"));
          });
        } else {
          setBackNav();
          App.addListener("backButton", () => {
            if (location.pathname !== "/devices") {
              navigate("/devices");
            } else {
              App.exitApp();
            }
          });
        }
      }
    } else {
      setHeader("");
    }
  });
  const HeaderElement = () => (
    <div class="pt-safe fixed top-0 z-30 flex w-screen items-center justify-between bg-white px-6 pb-3">
      <div class="flex items-center justify-end">
        <div class="flex w-6 items-center justify-center">{backNav()}</div>
        <h2 class="ml-4 text-4xl font-bold text-gray-800">{header()}</h2>
      </div>
      {HeaderButton()?.()}
    </div>
  );
  return { headerMap, HeaderElement };
});
