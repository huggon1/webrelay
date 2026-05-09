import { cp, mkdir, rm } from "node:fs/promises";
import esbuild from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
};

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ["src/background.ts"],
    outfile: "dist/background.js",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/content.ts"],
    outfile: "dist/content.js",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/popup.ts"],
    outfile: "dist/popup.js",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/sandbox.ts"],
    outfile: "dist/sandbox.js",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/offscreen.ts"],
    outfile: "dist/offscreen.js",
  }),
]);

await cp("manifest.json", "dist/manifest.json");
await cp("src/popup.html", "dist/popup.html");
await cp("src/popup.css", "dist/popup.css");
await cp("src/sandbox.html", "dist/sandbox.html");
await cp("src/offscreen.html", "dist/offscreen.html");
