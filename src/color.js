// sRGB relative luminance and contrast ratio, written out in full.
//
// The formula is the one in WCAG 2.x, which is the sRGB transfer function from IEC 61966-2-1:
//
//   c    = channel / 255
//   lin  = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
//   L    = 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B)
//   ratio = (Llighter + 0.05) / (Ldarker + 0.05)
//
// Three parts of that are load bearing and are the three that get dropped when somebody
// "simplifies" it:
//
//   - the 0.03928 linear segment near black. Without it, very dark colours come out too dark
//     and every ratio involving them is inflated.
//   - the per channel weights. Equal weights are wrong for every colour that is not grey.
//   - the +0.05 offsets, which model ambient flare off the surface. Removing them turns
//     failing dark-on-dark pairs into passing ones.
//
// scripts/sabotage.py removes each of the three in turn and requires something to notice.

/** Parse #rgb, #rrggbb, or rgb()/rgba() into {r,g,b,a} with 0..255 channels. Returns null on
 *  anything it does not understand, because "could not read this colour" and "black" are
 *  different answers and collapsing them is how an unreadable colour becomes a pass. */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === '') return null;

  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [a, b, c] = m[1];
    return { r: parseInt(a + a, 16), g: parseInt(b + b, 16), b: parseInt(c + c, 16), a: 1 };
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
      a: 1
    };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    let alpha = 1;
    if (m[4] !== undefined) {
      alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    }
    return { r: +m[1], g: +m[2], b: +m[3], a: alpha };
  }
  return null;
}

/** The sRGB transfer function, inverted. */
export function channelToLinear(channel255) {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb) {
  return 0.2126 * channelToLinear(rgb.r)
       + 0.7152 * channelToLinear(rgb.g)
       + 0.0722 * channelToLinear(rgb.b);
}

/** Composite a translucent colour over an opaque one, so the ratio describes what is painted
 *  rather than what is declared. */
export function composite(over, under) {
  const a = over.a === undefined ? 1 : over.a;
  if (a >= 1) return { r: over.r, g: over.g, b: over.b, a: 1 };
  return {
    r: over.r * a + under.r * (1 - a),
    g: over.g * a + under.g * (1 - a),
    b: over.b * a + under.b * (1 - a),
    a: 1
  };
}

export function contrastRatio(foreground, background) {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const painted = composite(fg, bg);
  const lf = relativeLuminance(painted);
  const lb = relativeLuminance(bg);
  const light = Math.max(lf, lb);
  const dark = Math.min(lf, lb);
  return (light + 0.05) / (dark + 0.05);
}
