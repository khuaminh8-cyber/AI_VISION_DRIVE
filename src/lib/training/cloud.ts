/** Cloud copy of training images, scoped per device: devices/{deviceId}/images/{id}.jpg. */
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "./device";

const BUCKET = "training-dataset";
const dir = () => `devices/${getDeviceId()}/images`;

export async function uploadImage(id: string, blob: Blob) {
  const { error } = await supabase.storage.from(BUCKET).upload(`${dir()}/${id}.jpg`, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
}
export async function listCloudIds(): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(dir(), { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
  if (error) throw error;
  return (data ?? []).filter((f) => f.name.endsWith(".jpg")).map((f) => f.name.replace(/\.jpg$/, ""));
}
export async function downloadImage(id: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(`${dir()}/${id}.jpg`);
  if (error) throw error;
  return data;
}
export async function deleteCloudImage(id: string) { await supabase.storage.from(BUCKET).remove([`${dir()}/${id}.jpg`]); }
export async function deleteCloudImages(ids: string[]) { if (ids.length) await supabase.storage.from(BUCKET).remove(ids.map((id) => `${dir()}/${id}.jpg`)); }
