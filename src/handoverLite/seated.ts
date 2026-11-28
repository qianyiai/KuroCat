import { castIds, type CastId } from './cast';

type Rect = [number, number, number, number, number, number];

interface SeatLayout {
  regions: [Rect, Rect];
  patches: Record<string, Rect[]>;
}

/** The unmodified body supplies coat samples. Both seated actors use the full rest pose. */
export async function prepareSeat(
  id: CastId,
  image: (path: string) => Promise<HTMLImageElement>,
  layout: Promise<SeatLayout>,
) {
  const [coat, coverage, paws, { regions, patches }] = await Promise.all([
    image('seats/' + id + '.webp'), image('seats/coverage.webp'), image('seats/tucked.webp'), layout,
  ]);
  const [sx, sy, w, h, x, y] = regions[0];
  const body = document.createElement('canvas');
  body.width = x + w;
  body.height = y + h;
  const ctx = body.getContext('2d')!;
  ctx.drawImage(coverage, sx, sy, w, h, x, y, w, h);
  for (const [px, py, pw, ph, left, top] of patches[id]) {
    if (left < sx || left >= sx + w || top < sy || top >= sy + h) continue;
    const dx = x + left - sx, dy = y + top - sy;
    ctx.clearRect(dx, dy, pw, ph);
    ctx.drawImage(coverage, px, py, pw, ph, dx, dy, pw, ph);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(coat, sx, sy, w, h, x, y, w, h);
  const rest = document.createElement('canvas');
  rest.width = body.width;
  rest.height = body.height;
  const seated = rest.getContext('2d')!;
  seated.drawImage(body, 0, 0);
  const width = paws.width / castIds.length;
  const sourceX = castIds.indexOf(id) * width;
  seated.drawImage(paws, sourceX, 0, width, paws.height, 422, 529, width, paws.height);
  function drawLiftingPaw(ctx: CanvasRenderingContext2D, progress: number) {
    // On the first two rise cels the far toes are still in front of the belly.
    // The rising chest foreshortens the pad before the standing legs take over.
    const lift = progress * progress * (3 - 2 * progress);
    const w = width * (1 - .43 * lift), h = paws.height * (1 - lift);
    ctx.drawImage(paws, sourceX, 0, width, paws.height,
      422 + (width - w) / 2 + 7 * lift, 529 + paws.height - h - 11 * lift, w, h);
  }
  return { body, rest, drawLiftingPaw };
}
