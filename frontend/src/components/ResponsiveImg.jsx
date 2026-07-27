import { buildSrcSet } from '../utils/responsiveImage';

/**
 * Drop-in replacement for <img> that automatically requests the right pixel
 * density for the display it's rendered on, given a raster asset that ships
 * 1x/2x/3x variants (`logo.png`, `logo@2x.png`, `logo@3x.png`). See
 * CONTRIBUTING.md's "Image Assets" section for the asset requirements.
 */
export function ResponsiveImg({ src, alt, ...rest }) {
  return <img src={src} srcSet={buildSrcSet(src)} alt={alt} {...rest} />;
}
