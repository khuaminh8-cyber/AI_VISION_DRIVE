/** One stable, random device ID per browser (localStorage). Scopes cloud training images to this device. */
const KEY = "adas_training_device_id";
export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id || !/^DEV-[a-f0-9-]{36}$/.test(id)) {
    id = `DEV-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
