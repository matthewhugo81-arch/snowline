import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../theme.js', import.meta.url), 'utf8');
function browser({saved=null, dark=false, blocked=false}={}) {
  const events = {}, storage = new Map(saved === null ? [] : [['snowline-theme-v1', saved]]);
  const select = {value:'system', disabled:true, addEventListener:(name, fn) => { events.select = fn; }};
  const root = {dataset:{}};
  const media = {matches:dark, addEventListener:(name, fn) => { events.media = fn; }};
  runInNewContext(source, {
    document:{documentElement:root, querySelectorAll:() => [select], addEventListener:(name, fn) => { events.ready = fn; }},
    window:{matchMedia:() => media, addEventListener:(name, fn) => { events.storage = fn; }},
    localStorage:{getItem:key => { if(blocked) throw Error('blocked'); return storage.get(key); }, setItem:(key,value) => { if(blocked) throw Error('blocked'); storage.set(key,value); }, removeItem:key => { if(blocked) throw Error('blocked'); storage.delete(key); }}
  });
  return {root, select, media, storage, events, choose(value){select.value=value;events.select();}};
}
test('first paint uses system preference, including invalid saved values', () => {
  for(const saved of [null, 'system', 'unexpected']) {
    const b = browser({saved,dark:true});
    assert.equal(b.root.dataset.theme, 'dark');
    b.events.ready();assert.equal(b.select.value, 'system');assert.equal(b.select.disabled,false);
    b.media.matches=false;b.events.media();assert.equal(b.root.dataset.theme,'light');
  }
});
test('explicit choice persists and takes precedence over OS changes', () => {
  const b=browser({saved:'light',dark:true});b.events.ready();
  assert.equal(b.root.dataset.theme,'light');
  b.choose('dark');assert.equal(b.storage.get('snowline-theme-v1'),'dark');
  b.media.matches=false;b.events.media();assert.equal(b.root.dataset.theme,'dark');
  const nextPage=browser({saved:b.storage.get('snowline-theme-v1')});
  assert.equal(nextPage.root.dataset.theme,'dark');
  b.choose('system');assert.equal(b.storage.has('snowline-theme-v1'),false);assert.equal(b.root.dataset.theme,'light');
});
test('blocked storage does not prevent switching', () => {
  const b=browser({blocked:true,dark:true});b.events.ready();b.choose('light');
  assert.equal(b.root.dataset.theme,'light');b.choose('system');assert.equal(b.root.dataset.theme,'dark');
});
test('other tabs synchronize preferences, including removal and cleared storage', () => {
  const b=browser({dark:true});b.events.ready();
  b.events.storage({key:'unrelated',newValue:'light'});assert.equal(b.root.dataset.theme,'dark');
  b.events.storage({key:'snowline-theme-v1',newValue:'light'});assert.equal(b.select.value,'light');assert.equal(b.root.dataset.theme,'light');
  b.events.storage({key:'snowline-theme-v1',newValue:null});assert.equal(b.select.value,'system');assert.equal(b.root.dataset.theme,'dark');
  b.choose('light');b.events.storage({key:null,newValue:null});assert.equal(b.root.dataset.theme,'dark');
});
