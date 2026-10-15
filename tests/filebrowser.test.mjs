// File browser path helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPath, stripExt } from '../web/js/views/filebrowser.js';

test('joining paths keeps the folder\'s separator and handles roots', () => {
  assert.equal(joinPath('C:\\Users\\me', 'Art'), 'C:\\Users\\me\\Art');
  assert.equal(joinPath('C:\\', 'Art'), 'C:\\Art');
  assert.equal(joinPath('D:', 'Art'), 'D:\\Art');
  assert.equal(joinPath('/home/me/', 'Art'), '/home/me/Art');
  assert.equal(joinPath('/', 'tmp'), '/tmp');
});

test('the extension comes off only when it is the expected one', () => {
  assert.equal(stripExt('picture.PNG', 'png'), 'picture');
  assert.equal(stripExt('picture.png', 'jpg'), 'picture.png');
  assert.equal(stripExt('my.koe.koe', 'koe'), 'my.koe');
  assert.equal(stripExt('png', 'png'), 'png');
});
