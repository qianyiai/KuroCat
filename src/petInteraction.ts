export type PetEmotionId =
  | 'happy'
  | 'angry'
  | 'boop'
  | 'chin'
  | 'dizzy'
  | 'sleep'
  | 'curious'
  | 'wake';

export type PetTapZone = 'nose' | 'tail' | 'head' | 'chin' | 'body';

export type PetInteractionEvent =
  | {
      kind: 'emotion';
      emotion: PetEmotionId | string;
      source?: 'hotkey' | 'menu' | 'desktop';
      durationMs?: number;
    }
  | {
      kind: 'pet';
      zone: 'head' | 'chin';
      petX?: number;
    }
  | {
      kind: 'tap';
      zone: PetTapZone;
    }
  | {
      kind: 'drag';
      active: boolean;
      vx?: number;
      vy?: number;
    };

export interface PetInteractionTarget {
  triggerHappyDemo(duration?: number): void;
  triggerCrossDemo(): void;
  triggerBoopDemo(): void;
  triggerChinScratchDemo(duration?: number): void;
  triggerDizzyDemo(duration?: number): void;
  triggerSleepDemo(): void;
  triggerCuriousDemo(duration?: number): void;
  triggerWakeDemo(): void;
  applyRemotePet(zone: 'head' | 'chin', petX?: number): void;
  applyRemoteTap(zone: PetTapZone): void;
  setDragging(dragging: boolean, velX?: number): void;
  updateDragVelocity(velX: number, velY?: number): void;
}

export function applyPetInteraction(
  target: PetInteractionTarget | null,
  is3d: boolean,
  ev: PetInteractionEvent | null | undefined,
): void {
  if (!target || !ev || typeof ev !== 'object') return;
  switch (ev.kind) {
    case 'emotion': {
      const durMs = ev.durationMs ?? 2800;
      const dur = is3d ? durMs / 1000 : durMs;
      switch (String(ev.emotion || '').toLowerCase()) {
        case 'happy':
        case 'pet':
          target.triggerHappyDemo(dur);
          break;
        case 'angry':
        case 'cross':
          target.triggerCrossDemo();
          break;
        case 'boop':
        case 'sneeze':
          target.triggerBoopDemo();
          break;
        case 'chin':
        case 'heart':
        case 'hearts':
          target.triggerChinScratchDemo(dur);
          break;
        case 'dizzy':
          target.triggerDizzyDemo(is3d ? 3.8 : 3800);
          break;
        case 'sleep':
        case 'nap':
          target.triggerSleepDemo();
          break;
        case 'curious':
          target.triggerCuriousDemo(is3d ? 3.4 : 3400);
          break;
        case 'wake':
        case 'reset':
          target.triggerWakeDemo();
          break;
      }
      break;
    }
    case 'pet':
      target.applyRemotePet(ev.zone === 'chin' ? 'chin' : 'head', ev.petX ?? 0);
      break;
    case 'tap':
      if (
        ev.zone === 'nose' ||
        ev.zone === 'tail' ||
        ev.zone === 'head' ||
        ev.zone === 'chin' ||
        ev.zone === 'body'
      ) {
        target.applyRemoteTap(ev.zone);
      }
      break;
    case 'drag':
      if (typeof ev.vx === 'number' || typeof ev.vy === 'number') {
        target.setDragging(true, ev.vx ?? 0);
        target.updateDragVelocity(ev.vx ?? 0, ev.vy ?? 0);
      } else {
        target.setDragging(Boolean(ev.active));
      }
      break;
  }
}
