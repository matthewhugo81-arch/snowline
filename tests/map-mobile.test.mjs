import test from 'node:test';
import assert from 'node:assert/strict';
import {setupMobileMap} from '../map-mobile.js';

test('cached HTML without mobile controls does not interrupt forecast startup or change the page',()=>{
 const previous=globalThis.document;
 let mutations=0;
 globalThis.document={
  querySelector:()=>({before(){mutations++;}}),
  getElementById:()=>null,
  createComment(){mutations++;},
  body:{classList:{add(){mutations++;}}}
 };
 try{assert.doesNotThrow(()=>setupMobileMap());assert.equal(mutations,0);}
 finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('browsers without expanded-dialog support retain the standard controls',()=>{
 const previous=globalThis.document;
 globalThis.document={querySelector:()=>({}),getElementById:()=>({})};
 try{assert.doesNotThrow(()=>setupMobileMap());}
 finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
