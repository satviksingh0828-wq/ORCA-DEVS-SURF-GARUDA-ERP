import { defineConfig } from "vite";
import { vibedit } from "@vibedit/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig(({ command }) => ({
  plugins: [
    // tanstackStart includes the TanStack Router plugin internally —
    // do NOT add TanStackRouterVite separately or plugins will duplicate.
    tanstackStart({
      server: { entry: "server" },
    }),
    react(),
    command === "serve" && vibedit(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  optimizeDeps: {
    include: ["@puckeditor/core"],
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    strictPort: false,
  },
  // Bundle all node_modules into the SSR output during build so the Vercel
  // function is self-contained (no node_modules dir exists in the function).
  // Only applied on `vite build` — dev mode uses Vite's default SSR behaviour.
  ssr: command === "build" ? { noExternal: true } : {},
}));
