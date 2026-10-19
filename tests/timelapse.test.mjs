// Timelapse playback plan. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { timelapsePlan, videoSize } from '../web/js/timelapse.js';

test('short recordings play every frame, the last one held for the ending', () => {
  assert.deepEqual(timelapsePlan(3, 10, 60, 2), { indices: [0, 1, 2], holds: [1, 1, 21] });
  assert.deepEqual(timelapsePlan(0, 30, 60), { indices: [], holds: [] });
  assert.deepEqual(timelapsePlan(1, 30, 60, 0), { indices: [0], holds: [1] });
});

test('long recordings skip frames evenly, keeping the first and the last', () => {
  // 101 frames, room for 5 (5 fps x 1 s): 0, 25, 50, 75, 100
  assert.deepEqual(timelapsePlan(101, 5, 1, 0), { indices: [0, 25, 50, 75, 100], holds: [1, 1, 1, 1, 1] });
});

test('video size fits and is even', () => {
  assert.deepEqual(videoSize(1920, 1080), { w: 1280, h: 720 });
  assert.deepEqual(videoSize(1001, 333, 2000), { w: 1002, h: 334 });
  assert.deepEqual(videoSize(3000, 1, 1280), { w: 1280, h: 2 });
});
