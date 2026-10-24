import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev:https` serves over https with a self-signed certificate, so phones on the same Wi-Fi
// get Google sign-in, the live camera preview and the mic (browsers only allow those on https).
// Open it as https://<laptop-ip-with-dashes>.nip.io:5174 — see docs/demo.md.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "https" ? [basicSsl({ name: "hisaabkitaab", domains: ["*.nip.io", "localhost"] })] : [])],
  server: {
    // Frontend calls /api/...; Vite forwards it to FastAPI so there are no CORS issues in dev.
    proxy: {
      "/api": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
    },
  },
}));
