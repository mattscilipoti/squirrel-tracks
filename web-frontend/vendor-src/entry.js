// Bundled into ../vendor/yjs.js by `npm run vendor`. Re-run it after bumping yjs,
// y-indexeddb, y-webrtc or qrcode-generator in package.json and commit the output.
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebrtcProvider } from "y-webrtc";
import qrcode from "qrcode-generator";

export { Y, IndexeddbPersistence, WebrtcProvider, qrcode };
