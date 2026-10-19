export type DeviceOption = { deviceId: string; label: string; isDefault: boolean };

type DeviceLike = Pick<MediaDeviceInfo, "deviceId" | "groupId" | "label">;

/** Chrome lists pseudo devices that alias a real one. */
const PSEUDO_IDS = new Set(["default", "communications"]);

/**
 * Real devices only, with the OS default marked (Chrome's "default" pseudo
 * entry shares its groupId; elsewhere the first device is the default).
 */
export function deviceOptions(devices: DeviceLike[], fallbackLabel: string): DeviceOption[] {
  const pseudo = devices.find((d) => d.deviceId === "default");
  const real = devices.filter((d) => d.deviceId && !PSEUDO_IDS.has(d.deviceId));
  const defaultId =
    (pseudo && real.find((d) => d.groupId === pseudo.groupId)?.deviceId) ?? real[0]?.deviceId;
  return real.map((d, i) => ({
    deviceId: d.deviceId,
    label: d.label || `${fallbackLabel} ${i + 1}`,
    isDefault: d.deviceId === defaultId,
  }));
}

/**
 * Which option is in use: the explicit choice, else the device the live track
 * opened, else the OS default ("" means "follow the OS default").
 */
export function selectedDevice(
  options: DeviceOption[],
  chosenId: string,
  trackDeviceId: string | undefined,
): string {
  if (chosenId && options.some((o) => o.deviceId === chosenId)) return chosenId;
  if (trackDeviceId && options.some((o) => o.deviceId === trackDeviceId)) return trackDeviceId;
  return options.find((o) => o.isDefault)?.deviceId ?? "";
}
