import { fileURLToPath } from "node:url";
import { syncNextNativeShims } from "../src/lib/next-native-shims.mjs";

const __filename = fileURLToPath(import.meta.url);
const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

syncNextNativeShims(APP_ROOT);
