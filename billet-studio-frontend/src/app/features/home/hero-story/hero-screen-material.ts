import { ShaderMaterial, type Texture, Vector4 } from 'three';

// The phone's display (docs/hero-story.md, "Materials the runtime replaces"): the lock screen with
// the message banner, then the billet page, all drawn in one shader so the banner is clipped to the
// glass by construction. toneMapped false: the billet screenshot shows its colours exactly as the
// real billet does; the paper card around it is tone-mapped as usual.

/** The message banner in the 390x844 window, CSS px: 358x120, centred, 16 px below the top. */
const WINDOW = { width: 390, height: 844 };
const BANNER_TOP_PX = 16;

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vViewNormal;
varying vec3 vViewPosition;

void main() {
  vUv = uv;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -viewPosition.xyz;
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewPosition;
}
`;

// UVs follow glTF: (0, 0) is the top-left corner of the window (textures are not flipped).
const FRAGMENT = /* glsl */ `
uniform sampler2D uLock;
uniform sampler2D uNotification;
uniform sampler2D uBilletA;
uniform sampler2D uBilletB;
uniform float uWake;
uniform float uNotif;
uniform float uBillet;
uniform float uBilletMix;
uniform vec4 uBanner;

varying vec2 vUv;
varying vec3 vViewNormal;
varying vec3 vViewPosition;

void main() {
  vec3 lock = texture2D(uLock, vUv).rgb;

  // The banner slides down from above the top edge and fades in with it.
  float slide = (1.0 - uNotif) * (uBanner.y + uBanner.w);
  vec2 bannerUv = (vUv - vec2(uBanner.x, uBanner.y - slide)) / uBanner.zw;
  vec2 inside = step(vec2(0.0), bannerUv) * step(bannerUv, vec2(1.0));
  vec4 banner = texture2D(uNotification, clamp(bannerUv, 0.0, 1.0));
  lock = mix(lock, banner.rgb, banner.a * inside.x * inside.y * uNotif);

  vec3 billet = mix(texture2D(uBilletA, vUv).rgb, texture2D(uBilletB, vUv).rgb, uBilletMix);
  vec3 color = mix(lock, billet, uBillet) * uWake;

  // Faint glass: a soft diagonal sheen that wanders with the view angle, stronger at grazing angles.
  vec3 view = normalize(vViewPosition);
  float facing = abs(dot(normalize(vViewNormal), view));
  float band = vUv.x * 0.7 + vUv.y * 0.3 + view.x * 0.8 - 0.5;
  float sheen = 0.03 * exp(-band * band / 0.02) + 0.05 * pow(1.0 - facing, 4.0);
  color += vec3(sheen);

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export interface ScreenTextures {
  readonly lock: Texture;
  readonly notification: Texture;
  /** The billet screen shown before a crossfade ends ... */
  readonly billetA: Texture;
  /** ... and the one it fades to. */
  readonly billetB: Texture;
}

export interface ScreenValues {
  /** Fx_Wake: 0 black glass, 1 the lock screen fully lit. */
  readonly wake: number;
  /** Fx_Notif: 0 banner above the top edge, 1 in place. */
  readonly notif: number;
  /** Fx_Billet: 0 lock screen and banner, 1 the billet page. */
  readonly billet: number;
  /** 0 billet A, 1 billet B. */
  readonly billetMix: number;
}

/** The display's ShaderMaterial; the stage owns it and disposes it (never its textures). */
export function createScreenMaterial(placeholder: Texture): ShaderMaterial {
  return new ShaderMaterial({
    name: 'HeroScreen',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    toneMapped: false,
    uniforms: {
      uLock: { value: placeholder },
      uNotification: { value: placeholder },
      uBilletA: { value: placeholder },
      uBilletB: { value: placeholder },
      uWake: { value: 0 },
      uNotif: { value: 0 },
      uBillet: { value: 0 },
      uBilletMix: { value: 0 },
      uBanner: { value: new Vector4(0, 0, 1, 1) },
    },
  });
}

/** Places the banner from the message texture's CSS size. */
export function setScreenBanner(
  material: ShaderMaterial,
  cssWidth: number,
  cssHeight: number,
): void {
  const width = cssWidth / WINDOW.width;
  (material.uniforms['uBanner'].value as Vector4).set(
    (1 - width) / 2,
    BANNER_TOP_PX / WINDOW.height,
    width,
    cssHeight / WINDOW.height,
  );
}

export function setScreenTextures(material: ShaderMaterial, textures: ScreenTextures): void {
  const { uniforms } = material;
  uniforms['uLock'].value = textures.lock;
  uniforms['uNotification'].value = textures.notification;
  uniforms['uBilletA'].value = textures.billetA;
  uniforms['uBilletB'].value = textures.billetB;
}

export function setScreenValues(material: ShaderMaterial, values: ScreenValues): void {
  const { uniforms } = material;
  uniforms['uWake'].value = values.wake;
  uniforms['uNotif'].value = values.notif;
  uniforms['uBillet'].value = values.billet;
  uniforms['uBilletMix'].value = values.billetMix;
}
