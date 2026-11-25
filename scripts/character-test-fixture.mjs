// Test data only: reuse the four existing BigFish PNGs; never import into user data.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
export function characterFixture() {
  return JSON.parse(fs.readFileSync(new URL('./fixtures/dafeiyu-package.json',import.meta.url),'utf8'));
}
export function writeCharacterFixture(destination) {
  const manifest=characterFixture();
  fs.mkdirSync(destination,{recursive:true});
  for(const outfit of manifest.outfits) for(const asset of Object.values(outfit.bodySprites).filter(value=>value.endsWith('.png'))) {
    const target=path.join(destination,asset);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(root,'src/assets/dafeiyu',path.basename(asset)),target);
  }
  fs.writeFileSync(path.join(destination,'character.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
