import {
  AmbientLight,
  DirectionalLight,
  PMREMGenerator,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// The original card's environment (muttertag_threejs/index.html).
const ENVIRONMENT_SIGMA = 0.04;

/**
 * Bakes three's RoomEnvironment into `scene.environment`, replacing and disposing the previous one.
 * A lost context loses the baked texture, so a stage calls this again on restore.
 */
export function buildRoomEnvironment(renderer: WebGLRenderer, scene: Scene): void {
  // PMREM's shader trips an ANGLE (Windows) optimisation note that three reports as a warning
  // while diagnostics are on; it is not ours to fix, so they pause for it.
  const diagnostics = renderer.debug.checkShaderErrors;
  renderer.debug.checkShaderErrors = false;
  const generator = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const previous = scene.environment;
  try {
    scene.environment = generator.fromScene(room, ENVIRONMENT_SIGMA).texture;
  } finally {
    renderer.debug.checkShaderErrors = diagnostics;
    room.dispose();
    generator.dispose();
  }
  previous?.dispose();
}

/**
 * The original card's lights (muttertag_threejs/index.html): a warm key, a faint fill and an
 * ambient term. Returns the directional lights, which the stage disposes.
 */
export function addBilletLights(scene: Scene): readonly DirectionalLight[] {
  const key = new DirectionalLight(0xfff0e8, 0.4);
  key.position.set(1.5, 3, 2.5);
  const fill = new DirectionalLight(0xf0e8e0, 0.08);
  fill.position.set(-2, 1, 1);
  scene.add(new AmbientLight(0xfff8f4, 0.15), key, fill);
  return [key, fill];
}
