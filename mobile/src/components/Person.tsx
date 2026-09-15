/**
 * The bystander from the banner scenes, as a standalone figure.
 *
 * Transcribed from `assets/out/app/assets/views/person.svg` — the drop ships
 * it as SVG only, with no PNG at any density, and Metro here has no SVG
 * transformer, so the paths live in JSX the way the icon set does.
 *
 * The paths are the export's, unchanged. Only the window onto them differs:
 * the exported `viewBox` is 240×250 to seat the figure in the banner layout,
 * which leaves close to half the box empty. `VIEW_BOX` below is cropped to the
 * art's own bounds (stroke included) so the component measures as what it
 * draws. Re-cropping is the one liberty taken; re-exporting is not.
 */
import * as React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * The figure's own palette, straight from the export. Deliberately not wired
 * to the theme tokens: this is illustration that has to keep matching the
 * banner PNGs it was drawn alongside, so it does not follow the UI colours.
 */
const C = {
  INK: '#1A1A1A',
  INK_BLUE: '#2C5BB5',
  COAT: '#F5372B',
  CUFF: '#FFE0DC',
  SKIN: '#FFE3C9',
  SCARF: '#F2C230',
} as const;

/** Art bounds are x 49.7–174.8, y 20.3–233.0; padded by 2 on every side. */
const VIEW_BOX = '47.7 18.3 129.1 216.7';
const ASPECT = 129.1 / 216.7;

export interface PersonProps {
  /**
   * Height in dp. Width follows the figure's aspect, so it is never stretched
   * — pass the height you have room for and let the width fall out.
   */
  size?: number;
}

export function Person({ size = 96 }: PersonProps) {
  return (
    <Svg width={size * ASPECT} height={size} viewBox={VIEW_BOX}>
      <Path d="M 88.0 148.0 L 110.0 148.0 L 110.0 212.0 L 113.0 214.0 L 116.0 226.0 L 115.0 230.0 L 86.0 230.0 L 85.0 214.0 L 88.0 212.0 Z" fill={C.INK_BLUE} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Path d="M 116.0 148.0 L 138.0 148.0 L 138.0 212.0 L 141.0 214.0 L 144.0 226.0 L 143.0 230.0 L 114.0 230.0 L 113.0 214.0 L 116.0 212.0 Z" fill={C.INK_BLUE} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Path d="M 134.0 93.5 L 127.5 98.2 L 124.2 103.3 L 121.2 104.4 L 113.1 102.5 L 109.7 104.2 L 114.8 150.5 L 117.6 153.0 L 130.2 150.2 L 148.0 149.4 L 150.1 147.7 L 137.2 97.1 Z" fill={C.INK} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Path d="M 150.2 51.5 L 109.7 56.3 L 60.1 81.3 L 76.2 120.4 L 69.4 171.9 L 115.6 165.4 L 109.9 103.0 L 91.9 73.8 L 115.4 60.1 L 138.0 63.8 L 133.8 89.9 L 152.3 155.3 L 171.8 152.5 L 151.0 94.1 Z" fill={C.COAT} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Path d="M 92.7 75.8 L 75.2 78.2 L 62.1 88.5 L 65.6 91.3 L 72.1 88.8 L 76.9 83.4 L 89.0 82.3 L 92.9 79.6 Z" fill={C.CUFF} stroke={C.INK} strokeWidth={3.6} strokeLinejoin="round" />
      <Path d="M 145.7 50.6 L 142.9 48.2 L 133.4 47.5 L 133.6 42.7 L 131.5 38.1 L 128.9 35.9 L 123.4 35.5 L 116.9 44.5 L 113.2 47.2 L 102.0 48.4 L 94.9 51.7 L 89.1 58.1 L 88.0 62.7 L 89.7 64.8 L 92.1 65.1 L 104.8 59.0 L 116.9 56.0 L 142.0 55.9 L 145.2 53.2 Z" fill={C.INK} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Path d="M 104.5 63.1 L 102.4 70.0 L 95.4 76.8 L 99.1 87.3 L 102.6 90.1 L 110.6 91.6 L 114.3 104.0 L 120.6 105.5 L 126.1 103.6 L 127.3 101.1 L 125.3 94.6 L 125.7 91.3 L 133.9 84.9 L 135.2 82.4 L 136.1 75.1 L 132.2 64.1 L 122.9 63.5 L 120.5 62.0 L 113.2 66.5 Z" fill={C.SKIN} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Circle cx="109.7" cy="75.6" r="3.2" fill={C.INK} />
      <Circle cx="120.3" cy="75.0" r="3.4" fill={C.INK} />
      <Path d="M 129.5 79.6 L 114.4 83.9" stroke={C.INK} strokeWidth={4.2} strokeLinecap="round" fill="none" />
      <Path d="M 147.7 58.3 L 137.3 55.2 L 111.3 56.3 L 92.9 63.8 L 88.4 69.5 L 111.3 60.5 L 144.2 61.5 Z" fill={C.SCARF} stroke={C.INK} strokeWidth={3.6} strokeLinejoin="round" />
      <Path d="M 62.5 41.1 L 59.8 44.6 L 56.8 44.6 L 56.6 48.1 L 53.5 49.4 L 52.7 55.6 L 53.9 58.3 L 58.2 62.0 L 68.6 63.4 L 72.7 70.9 L 78.9 69.0 L 80.0 67.1 L 77.8 60.7 L 82.2 55.8 L 83.0 49.4 L 81.2 44.6 L 78.0 41.1 L 75.9 41.2 L 73.2 44.9 L 71.9 41.9 L 69.2 40.8 L 65.9 42.1 Z" fill={C.SKIN} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Path d="M 63.6 44.0 L 62.3 54.9" stroke={C.INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d="M 69.6 44.7 L 68.3 55.6" stroke={C.INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d="M 75.6 45.4 L 74.2 56.4" stroke={C.INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d="M 127.8 24.8 L 124.0 28.8 L 125.4 31.4 L 122.7 35.1 L 124.3 36.5 L 130.0 36.5 L 132.4 42.6 L 132.6 48.1 L 142.4 49.3 L 143.3 47.5 L 142.0 42.3 L 147.3 35.8 L 146.0 33.0 L 147.3 32.2 L 146.8 28.8 L 145.1 27.4 L 143.0 28.8 L 139.8 23.6 L 138.1 23.6 L 136.6 25.7 L 133.4 23.3 L 130.0 25.0 Z" fill={C.SKIN} stroke={C.INK} strokeWidth={6.0} strokeLinejoin="round" />
      <Path d="M 131.3 25.5 L 129.9 36.4" stroke={C.INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d="M 137.2 26.3 L 135.9 37.2" stroke={C.INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d="M 143.2 27.0 L 141.8 37.9" stroke={C.INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
