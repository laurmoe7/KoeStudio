// Combined brushes (pure, tested): a second brush painting along the same stroke as the first, as Procreate's
// combined brushes do (Brush settings → Combined). Its settings are flat `combo…` keys on the brush; comboSettings
// turns them into an ordinary brush's settings, so the dab pipeline (stampAt, dabJitter, Painter, strokeStamps) draws
// it unchanged. Its size is a share of the main brush's, so the size slider scales both. Its dabs go into the same
// stroke canvas after the main brush's, through the composite operation of comboMode, so texture, wet edges, the
// dual brush, opacity and the selection treat the stroke as one.

/** Settings of the second brush, off ('none' tip) until it is given a tip. */
export const COMBO_DEFAULTS = {
  comboTip: 'none', comboMode: 'normal', comboSize: 1, comboFlow: 1, comboHardness: 0.8, comboSpacing: 0.1, comboThickness: 1,
  comboAngle: 0, comboRandom: 0, comboFollow: false, comboScatter: 0, comboSizeJitter: 0,
  comboPressureSize: true, comboMinSize: 0.3, comboPressureFlow: false, comboMinFlow: 0,
};

/** How the second brush's paint goes over the first: [id, label, canvas composite operation]. */
export const COMBO_MODES = [['normal', 'Normal'], ['multiply', 'Multiply'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['screen', 'Screen'], ['overlay', 'Overlay']];
const OPS = { normal: 'source-over', multiply: 'multiply', darken: 'darken', lighten: 'lighten', screen: 'screen', overlay: 'overlay' };

/** The composite operation the second brush's dabs are drawn with. */
export const comboOp = mode => OPS[mode] || 'source-over';

/** Whether brush settings s have a second brush. */
export const hasCombo = s => !!s && typeof s.comboTip === 'string' && s.comboTip !== 'none';

/**
 * The second brush of settings s as settings of a brush of its own, or null when there is none. It keeps the main
 * brush's pressure curve (gamma) and hard pixels; tapers, texture, colour jitter, tilt and speed stay with the main brush.
 */
export function comboSettings(s) {
  if (!hasCombo(s)) return null;
  return {
    size: Math.max(0.5, (s.size || 1) * (s.comboSize ?? 1)), flow: s.comboFlow ?? 1, hardness: s.comboHardness ?? 0.8, spacing: s.comboSpacing ?? 0.1,
    tip: s.comboTip, thickness: s.comboThickness ?? 1, tipAngle: s.comboAngle || 0, tipRandom: s.comboRandom || 0, tipFollow: !!s.comboFollow,
    scatter: s.comboScatter || 0, sizeJitter: s.comboSizeJitter || 0, flowJitter: 0, count: 1,
    pressureSize: s.comboPressureSize ?? true, minSize: s.comboMinSize ?? 0.3, pressureOpacity: !!s.comboPressureFlow, minFlow: s.comboMinFlow || 0,
    gamma: s.gamma ?? 1, sizeCurve: null, flowCurve: null, pixel: !!s.pixel,
    taperIn: 0, taperOut: 0, hueJitter: 0, satJitter: 0, valJitter: 0, colorJitterStroke: false,
    texture: 'none', textureAmount: 0, grainPressure: false, dualTip: 'none', wetEdges: 0, mix: 0,
    tiltSize: 0, tiltFlow: 0, tiltAngle: false, speedSize: 0, speedFlow: 0, opacity: 1,
  };
}

/**
 * The combo… settings that make brush b (another brush's settings) the second brush of a brush of size mainSize:
 * its tip, shape and dynamics, with its size as a share of mainSize (Combined → Copy…, and imported combined brushes).
 */
export function comboFrom(b, mainSize) {
  const share = (b.size || 1) / Math.max(0.5, mainSize || 1);
  return {
    comboTip: b.tip && b.tip !== 'none' ? b.tip : 'round', comboSize: Math.round(Math.max(0.05, Math.min(3, share)) * 100) / 100,
    comboFlow: b.flow ?? 1, comboHardness: b.hardness ?? 0.8, comboSpacing: b.spacing ?? 0.1, comboThickness: b.thickness ?? 1,
    comboAngle: b.tipAngle || 0, comboRandom: b.tipRandom || 0, comboFollow: !!b.tipFollow, comboScatter: Math.min(2, b.scatter || 0),
    comboSizeJitter: b.sizeJitter || 0, comboPressureSize: b.pressureSize ?? true, comboMinSize: b.minSize ?? 0.3,
    comboPressureFlow: !!b.pressureOpacity, comboMinFlow: b.minFlow || 0,
  };
}
