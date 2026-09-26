import { PMREMGenerator, type Scene, type WebGLRenderer } from 'three';
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
