/* @refresh reload */
import { render } from "solid-js/web";
import "./root.css";
import App from "./root";
const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got mispelled?"
  );
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
render(() => <App />, root!);
