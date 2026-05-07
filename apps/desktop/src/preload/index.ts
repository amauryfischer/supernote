import { contextBridge } from "electron";

/**
 * ElectronAPI is the type-safe surface exposed to the renderer via window.electronAPI.
 * Currently empty — ready to receive tRPC IPC handlers as they are implemented.
 *
 * Example future shape:
 *   ipcInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>
 */
export interface ElectronAPI {
  // Reserved for tRPC-over-IPC bridge (to be added when @supernote/ipc is wired up)
  readonly _brand: "ElectronAPI";
}

const electronAPI: ElectronAPI = {
  _brand: "ElectronAPI",
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
