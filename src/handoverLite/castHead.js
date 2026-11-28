/** Restore the photographed angles on their original grid so eyelids and neck
 * masks stay registered. The held 45° view uses its full-resolution color. */
export async function prepareHead(id, loadArt, loadData) {
  const [color, coverage, layout] = await Promise.all([
    loadArt('cast-guest/' + id + '/face.webp'),
    loadArt('cast-guest/head-coverage.webp'),
    loadData('cast-guest/head-layout.json'),
  ]);
  const atlas = document.createElement('canvas');
  atlas.width = layout.width;
  atlas.height = layout.height;
  const ctx = atlas.getContext('2d');
  // Three distinct silhouettes are stored in the lossless RGB channels of one
  // image. Select the breed's original opacity once before the animation starts.
  ctx.drawImage(coverage, 0, 0);
  const mask = ctx.getImageData(0, 0, atlas.width, atlas.height);
  const pixels = mask.data, channel = layout.channels[id];
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = pixels[i + channel];
  ctx.putImageData(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.imageSmoothingQuality = 'high';
  for (const [i, [, x, y, w, h]] of layout.views.entries()) {
    ctx.drawImage(color, ...layout.tiles[i], x, y, w, h);
  }
  return {atlas, views: layout.views};
}
