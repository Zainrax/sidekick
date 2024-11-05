import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "path";
import worktank from "worktank-vite-plugin";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
  plugins: [
    solid(),
    sentryVitePlugin({
      org: "sentry",
      project: "sidekick",
      url: "https://sentry.crittergames.co.nz/",
    }),
  ],
});
