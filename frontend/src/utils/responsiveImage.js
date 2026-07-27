/**
 * Splits "logo.png" into ["logo", ".png"] so density variants can be built
 * from a single base path.
 */
function splitExtension(basePath) {
  const dotIndex = basePath.lastIndexOf('.');
  if (dotIndex === -1) return [basePath, ''];
  return [basePath.slice(0, dotIndex), basePath.slice(dotIndex)];
}

/**
 * Builds a `srcset` value for a raster asset that ships 1x/2x/3x density
 * variants under the `name.png` / `name@2x.png` / `name@3x.png` convention
 * (see CONTRIBUTING.md's "Image Assets" section). 1x displays still request
 * the 1x file, so there's no bandwidth regression for them.
 */
export function buildSrcSet(basePath) {
  const [name, ext] = splitExtension(basePath);
  return `${basePath} 1x, ${name}@2x${ext} 2x, ${name}@3x${ext} 3x`;
}

/**
 * Builds a CSS `image-set()` value for the same 1x/2x/3x naming convention,
 * for use in `background-image` declarations.
 */
export function buildImageSet(basePath) {
  const [name, ext] = splitExtension(basePath);
  return `image-set(url("${basePath}") 1x, url("${name}@2x${ext}") 2x, url("${name}@3x${ext}") 3x)`;
}
