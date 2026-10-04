export async function probeImageDimensions(
  env: Env,
  bytes: ArrayBuffer,
): Promise<{ width: number; height: number } | null> {
  try {
    const info = await env.IMAGES.info(new Blob([bytes]).stream());
    return "width" in info ? { width: info.width, height: info.height } : null;
  } catch (error) {
    console.warn("Could not probe image dimensions; upload will continue", error);
    return null;
  }
}
