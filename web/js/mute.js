// Silences every sound the page could make when the app runs muted (python app.py --muted, or KOE_MUTE=1).
// Used while testing. It patches the browser's audio entry points, so any sound code added later is covered too.

export let MUTED = false;

export function applyMute() {
  MUTED = true;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    this.muted = true;
    this.volume = 0;
    return play.apply(this, a);
  };
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = window[name];
    if (!Orig) continue;
    window[name] = class extends Orig {
      constructor(...a) {
        super(...a);
        super.suspend();
      }
      resume() { return Promise.resolve(); }
    };
  }
  window.speechSynthesis && (window.speechSynthesis.speak = () => {});
}
