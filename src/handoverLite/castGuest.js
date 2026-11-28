import { prepareHead } from './castHead.js';
import { installActors } from './actors.js';
import { expandCoat } from './coatMotion.js';
import { registerGuestCoat } from './guestCoatTurn.js';

const colorfulCats = new Set(['siamese', 'ragdoll', 'orange-tabby', 'calico', 'tuxedo']);

/** Each performer owns its cached poses. Its paths, registration, choreography
 * and jaw transition are shared with the approved black guest. */
export async function prepareCastGuest(id, loadArt, loadData, nativeBody, restBody = nativeBody) {
  if (id === 'black') {
    const actor = installActors(
      path => path === 'base/black.webp' ? Promise.resolve(restBody) : loadArt(path), loadData,
    );
    await actor.prepareGuest();
    return actor.drawGuest;
  }
  if (!colorfulCats.has(id)) throw new RangeError('Unknown guest cat ' + id);
  const base = 'cast-guest/' + id + '/';
  const [motion, face, paintImage, layout, head, mesh] = await Promise.all([
    loadData('guest-part/motion.json'),
    loadData(base + 'face.json'),
    loadArt(base + 'coat.webp'), loadData(base + 'coat.json'), prepareHead(id, loadArt, loadData),
    loadData('cast-guest/seat-warp.json'),
  ]);
  const baseCoat = layout.motion
    ? await expandCoat(layout, await loadArt(base + 'coat-keys.webp'), paintImage)
    : paintImage;
  // Pose paths are still all distinct. Where another pose has matching paint,
  // point only its texture index at the same atlas cell.
  const paint = Array.from(atob(layout.poses), char => char.charCodeAt(0));
  const rects = layout.rects.slice();
  const coat = await registerGuestCoat(baseCoat, rects, paint, motion, mesh, nativeBody);
  const geometry = Object.fromEntries(Object.entries(motion.geometry).map(([name, rows]) =>
    [name, rows.map(([index, ...pose]) => [paint[index], ...pose])],
  ));
  const parts = {
    'guest-part/neck.webp': 'cast-guest/neck.webp',
    'guest-part/lids.webp': base + 'eyes.webp',
  };
  const actor = installActors(
    path => path === 'base/black.webp' ? Promise.resolve(restBody) :
      path === 'guest-part/face.webp' ? Promise.resolve(head.atlas) :
      path === 'guest-part/lighting.webp' ? Promise.resolve(coat) : loadArt(parts[path] || path),
    path => path === 'guest-part/motion.json' ? Promise.resolve({ ...motion, ...face, geometry, views: head.views, texture: layout.tile, coatRects: rects }) : loadData(path),
  );
  await actor.prepareGuest();
  return actor.drawGuest;
}

