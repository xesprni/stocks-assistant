import * as module from "node:module";
import { load, resolve } from "./test-loader.mjs";

if (typeof module.registerHooks !== "function") throw new Error("Frontend tests require Node.js 22.15 or newer.");
module.registerHooks({ load, resolve });
