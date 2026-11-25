import path from 'node:path';
import {writeCharacterFixture} from './character-test-fixture.mjs';
const destination=path.resolve(process.argv[2]??'tmp/character-fixture');
const manifest=writeCharacterFixture(destination);
console.log(JSON.stringify({path:destination,id:manifest.id,outfits:manifest.outfits.map(o=>o.id),testOnly:true}));
