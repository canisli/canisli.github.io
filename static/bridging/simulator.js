(() => {
  'use strict';

  const F = Math.fround;
  const GAME_VERSION = '1.8.9-surrogate-js';
  const PLAYER_WIDTH = 0.6;
  const PLAYER_HEIGHT = 1.8;
  const EYE_HEIGHT = 1.62;
  const SNEAK_EYE_HEIGHT = 1.54;
  const REACH = 4.5;
  const WALK_SPEED = F(0.1);
  const SPRINT_SPEED = F(WALK_SPEED * (1 + F(0.3)));
  const AIR_SPEED = F(0.02);
  const SPRINT_AIR_SPEED = F(AIR_SPEED + AIR_SPEED * 0.3);
  const AIR_DRAG = F(0.91);
  const REWARD_DISCOUNT = 0.99;
  const TICK_COST = 0.001;
  const SUCCESS_BONUS = 5;
  const FAILURE_PENALTY = 1;
  const PLATFORM_WIDTH = 5;
  const PLATFORM_LENGTH = 3;
  const PLATFORM_MIN_X = -Math.floor(PLATFORM_WIDTH / 2);
  const COURSE_CENTER_X = PLATFORM_MIN_X + PLATFORM_WIDTH / 2;
  const COURSE_LANE_HALF_WIDTH = PLATFORM_WIDTH / 2 - PLAYER_WIDTH / 2;
  const DEFAULT_DISTANCE = 30;
  const DEFAULT_ACTION = Object.freeze({
    forward: 0,
    strafe: 0,
    yaw_delta: 0,
    pitch_delta: 0,
    jump: false,
    sprint: false,
    sneak: false,
    use: false,
    use_click: false,
  });

  const key = (x, y, z) => `${x},${y},${z}`;
  const vectorKey = vector => key(vector[0], vector[1], vector[2]);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function minecraftSin(angle) {
    const index = (Math.trunc(F(angle * F(10430.378))) & 65535) >>> 0;
    return F(Math.sin(index * Math.PI * 2 / 65536));
  }

  function minecraftCos(angle) {
    const index = (Math.trunc(F(angle * F(10430.378) + F(16384))) & 65535) >>> 0;
    return F(Math.sin(index * Math.PI * 2 / 65536));
  }

  function minecraftYawTrig(yaw) {
    const yawDegrees = F(yaw * 180 / Math.PI);
    const yawRadians = F(F(yawDegrees * F(Math.PI)) / F(180));
    return [minecraftSin(yawRadians), minecraftCos(yawRadians)];
  }

  function minecraftSprintJumpYawTrig(yaw) {
    const yawDegrees = F(yaw * 180 / Math.PI);
    const yawRadians = F(yawDegrees * F(0.017453292));
    return [minecraftSin(yawRadians), minecraftCos(yawRadians)];
  }

  class BrowserBridgeEnvironment {
    constructor(distance = DEFAULT_DISTANCE) {
      this.distance = distance;
      this.maxTicks = 2 ** 31 - 1;
      this.reset();
    }

    reset() {
      this.startX = COURSE_CENTER_X;
      this.startZ = 0.5;
      this.player = {
        x: this.startX,
        y: 1,
        z: this.startZ,
        vx: 0,
        vy: -0.0784000015258789,
        vz: 0,
        yaw: 0,
        yawHead: 0,
        pitch: 0,
        onGround: true,
        sprinting: false,
        collidedHorizontally: false,
        jumpMovementFactor: AIR_SPEED,
      };
      this.destinationStartZ = PLATFORM_LENGTH + this.distance;
      this.startPlatformBlocks = new Set();
      this.destinationPlatformBlocks = new Set();
      for (let x = PLATFORM_MIN_X; x < PLATFORM_MIN_X + PLATFORM_WIDTH; x++) {
        for (let z = 0; z < PLATFORM_LENGTH; z++) {
          this.startPlatformBlocks.add(key(x, 0, z));
        }
        for (let z = this.destinationStartZ;
          z < this.destinationStartZ + PLATFORM_LENGTH; z++) {
          this.destinationPlatformBlocks.add(key(x, 0, z));
        }
      }
      this.blocks = new Set([
        ...this.startPlatformBlocks,
        ...this.destinationPlatformBlocks,
      ]);
      this.initialBlocks = new Set(this.blocks);
      this.inventory = Math.max(64, this.distance + 4);
      this.rightClickDelay = 0;
      this.sneaking = false;
      this.tick = 0;
      this.done = false;
      this.success = false;
      this.playCompleted = false;
      this.trace = [];
    }

    get courseProgress() {
      return Math.max(0, this.player.z - this.startZ);
    }

    get courseGoalProgress() {
      return this.destinationStartZ - this.startZ;
    }

    get inCourseLane() {
      return Math.abs(this.player.x - this.startX) <= COURSE_LANE_HALF_WIDTH;
    }

    connectedLevelBlocks() {
      const start = key(0, 0, 0);
      if (!this.blocks.has(start)) return new Set();
      const connected = new Set([start]);
      const frontier = [[0, 0, 0]];
      while (frontier.length) {
        const [x, y, z] = frontier.pop();
        for (const neighbor of [
          [x - 1, y, z], [x + 1, y, z],
          [x, y, z - 1], [x, y, z + 1],
        ]) {
          const neighborKey = vectorKey(neighbor);
          if (this.blocks.has(neighborKey) && !connected.has(neighborKey)) {
            connected.add(neighborKey);
            frontier.push(neighbor);
          }
        }
      }
      return connected;
    }

    get validSupportedProgress() {
      if (Math.abs(this.player.y - 1) >= 1e-6 || !this.inCourseLane) return 0;
      if (!this.hasSupportAt(
        this.player.x, this.player.z, this.connectedLevelBlocks())) return 0;
      return this.courseProgress;
    }

    get progressPotential() {
      if (this.distance <= 0) return 0;
      return Math.min(1, this.validSupportedProgress / this.courseGoalProgress);
    }

    normalizeAction(input) {
      const action = {...DEFAULT_ACTION, ...(input || {})};
      for (const name of ['forward', 'strafe']) {
        const value = Number(action[name]);
        if (!Number.isInteger(value) || value < -1 || value > 1) {
          throw new Error(`${name} must be -1, 0, or 1`);
        }
        action[name] = value;
      }
      for (const name of ['yaw_delta', 'pitch_delta']) {
        const value = Number(action[name]);
        if (!Number.isFinite(value) || Math.abs(value) > 36 * Math.PI / 180) {
          throw new Error(`${name} must be a finite angle no larger than 36 degrees`);
        }
        action[name] = value;
      }
      for (const name of ['jump', 'sprint', 'sneak', 'use', 'use_click']) {
        action[name] = Boolean(action[name]);
      }
      return action;
    }

    step(input) {
      if (this.done) throw new Error('episode ended; reset the simulator');
      const action = this.normalizeAction(input);
      const player = this.player;
      const oldPotential = this.progressPotential;
      const prePosition = [player.x, player.y, player.z];
      const preVelocity = [player.vx, player.vy, player.vz];
      const preOnGround = player.onGround;

      if (this.rightClickDelay > 0) this.rightClickDelay -= 1;
      player.yaw += action.yaw_delta;
      player.pitch = clamp(player.pitch + action.pitch_delta, -Math.PI / 2, Math.PI / 2);
      const raycastYaw = player.yawHead;
      const raycastEyeHeight = this.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
      let placed = null;
      if (action.use_click || (action.use && this.rightClickDelay === 0)) {
        this.rightClickDelay = 4;
        placed = this.place(raycastEyeHeight);
      }

      this.move(action);
      player.yawHead = player.yaw;
      this.sneaking = action.sneak;
      const eyeHeight = this.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
      this.tick += 1;

      const levelFinish = Math.abs(player.y - 1) < 1e-6;
      const reachedDestination = this.hasSupportAt(
        player.x, player.z, this.destinationPlatformBlocks);
      this.success = reachedDestination && levelFinish;
      const fallen = player.y < -3;
      this.done = this.success || fallen || this.tick >= this.maxTicks;

      const nextPotential = this.done ? 0 : this.progressPotential;
      const shaping = REWARD_DISCOUNT * nextPotential - oldPotential;
      let reward = shaping - TICK_COST;
      if (this.success) reward += SUCCESS_BONUS;
      else if (this.done) reward -= FAILURE_PENALTY;

      const tick = {
        tick: this.tick,
        action,
        pre_position: prePosition,
        pre_velocity: preVelocity,
        pre_on_ground: preOnGround,
        position: [player.x, player.y, player.z],
        velocity: [player.vx, player.vy, player.vz],
        on_ground: player.onGround,
        sprinting: player.sprinting,
        yaw: player.yaw,
        raycast_yaw: raycastYaw,
        pitch: player.pitch,
        eye_height: eyeHeight,
        placed,
        course_progress: this.courseProgress,
        lateral_offset: player.x - this.startX,
        valid_supported_progress: this.validSupportedProgress,
        progress_potential: this.progressPotential,
        reward,
        reward_components: {
          potential_shaping: shaping,
          tick_cost: -TICK_COST,
          terminal: this.success ? SUCCESS_BONUS : this.done ? -FAILURE_PENALTY : 0,
        },
      };
      this.trace.push(tick);
      return tick;
    }

    move(action) {
      const player = this.player;
      if (Math.abs(player.vx) < 0.005) player.vx = 0;
      if (Math.abs(player.vy) < 0.005) player.vy = 0;
      if (Math.abs(player.vz) < 0.005) player.vz = 0;
      const wasGrounded = player.onGround;
      let forward = F(action.forward);
      let strafe = F(action.strafe);
      if (action.sneak) {
        forward = F(forward * 0.3);
        strafe = F(strafe * 0.3);
      }

      if (player.sprinting && (forward < F(0.8) || player.collidedHorizontally)) {
        player.sprinting = false;
      }
      if (!player.sprinting && action.sprint && forward >= F(0.8)) {
        player.sprinting = true;
      }
      if (action.jump && wasGrounded) {
        player.vy = F(0.42);
        if (player.sprinting) {
          const [sinYaw, cosYaw] = minecraftSprintJumpYawTrig(player.yaw);
          player.vx -= F(F(sinYaw) * F(0.2));
          player.vz += F(F(cosYaw) * F(0.2));
        }
      }

      forward = F(forward * F(0.98));
      strafe = F(strafe * F(0.98));
      let inputMagnitude = F(F(strafe * strafe) + F(forward * forward));
      if (inputMagnitude >= F(1e-4)) {
        inputMagnitude = F(Math.sqrt(inputMagnitude));
        if (inputMagnitude < 1) inputMagnitude = F(1);
      }
      const speed = player.sprinting ? SPRINT_SPEED : WALK_SPEED;
      const groundDrag = F(F(0.6) * F(0.91));
      const groundFactor = F(F(0.16277136) /
        F(F(groundDrag * groundDrag) * groundDrag));
      const acceleration = wasGrounded ? F(speed * groundFactor) : F(player.jumpMovementFactor);
      if (inputMagnitude >= F(1e-4)) {
        const inputScale = F(acceleration / inputMagnitude);
        forward = F(forward * inputScale);
        strafe = F(strafe * inputScale);
      }
      const [sinYaw, cosYaw] = minecraftYawTrig(player.yaw);
      player.vx += F(F(strafe * F(cosYaw)) - F(forward * F(sinYaw)));
      player.vz += F(F(forward * F(cosYaw)) + F(strafe * F(sinYaw)));

      this.moveWithCollisions(action.sneak && wasGrounded);
      player.vy = (player.vy - 0.08) * 0.9800000190734863;
      const drag = wasGrounded ? groundDrag : AIR_DRAG;
      player.vx *= drag;
      player.vz *= drag;
      player.jumpMovementFactor = player.sprinting ? SPRINT_AIR_SPEED : AIR_SPEED;
    }

    moveWithCollisions(safeWalk) {
      const player = this.player;
      let dx = player.vx;
      let dy = player.vy;
      let dz = player.vz;
      if (safeWalk) {
        dx = this.clipSafeAxis(dx, 0);
        dz = this.clipSafeAxis(0, dz);
        while (Math.abs(dx) > 1e-9 && Math.abs(dz) > 1e-9
          && !this.hasSupportAt(player.x + dx, player.z + dz)) {
          dx = this.safeWalkTowardZero(dx);
          dz = this.safeWalkTowardZero(dz);
        }
      }
      const collisionDx = dx;
      const collisionDz = dz;
      const movedY = this.clipAxis(dy, 'y');
      player.y += movedY;
      dx = this.clipAxis(dx, 'x');
      player.x += dx;
      dz = this.clipAxis(dz, 'z');
      player.z += dz;
      const collidedX = dx !== collisionDx;
      const collidedZ = dz !== collisionDz;
      if (collidedX) player.vx = 0;
      if (movedY !== dy) player.vy = 0;
      if (collidedZ) player.vz = 0;
      player.collidedHorizontally = collidedX || collidedZ;
      player.onGround = movedY !== dy && dy < 0;
    }

    clipSafeAxis(dx, dz) {
      let amount = dx || dz;
      while (Math.abs(amount) > 1e-9 && !this.hasSupportAt(
        this.player.x + (dx ? amount : 0),
        this.player.z + (dz ? amount : 0))) {
        amount = this.safeWalkTowardZero(amount);
      }
      return amount;
    }

    safeWalkTowardZero(amount) {
      if (Math.abs(amount) < 0.05) return 0;
      return amount - Math.sign(amount) * 0.05;
    }

    clipAxis(amount, axis) {
      if (Math.abs(amount) < 1e-12) return amount;
      let low = amount > 0 ? 0 : amount;
      let high = amount > 0 ? amount : 0;
      if (!this.collidesShift(axis, amount)) return amount;
      for (let iteration = 0; iteration < 24; iteration++) {
        const middle = (low + high) / 2;
        if (this.collidesShift(axis, middle)) {
          if (amount > 0) high = middle;
          else low = middle;
        } else if (amount > 0) low = middle;
        else high = middle;
      }
      return amount > 0 ? low : high;
    }

    collidesShift(axis, amount) {
      return this.boxCollides(
        this.player.x + (axis === 'x' ? amount : 0),
        this.player.y + (axis === 'y' ? amount : 0),
        this.player.z + (axis === 'z' ? amount : 0));
    }

    boxCollides(x, y, z) {
      const epsilon = 1e-9;
      const minX = Math.floor(x - PLAYER_WIDTH / 2 + epsilon);
      const maxX = Math.floor(x + PLAYER_WIDTH / 2 - epsilon);
      const minY = Math.floor(y + epsilon);
      const maxY = Math.floor(y + PLAYER_HEIGHT - epsilon);
      const minZ = Math.floor(z - PLAYER_WIDTH / 2 + epsilon);
      const maxZ = Math.floor(z + PLAYER_WIDTH / 2 - epsilon);
      for (let bx = minX; bx <= maxX; bx++) {
        for (let by = minY; by <= maxY; by++) {
          for (let bz = minZ; bz <= maxZ; bz++) {
            if (this.blocks.has(key(bx, by, bz))) return true;
          }
        }
      }
      return false;
    }

    hasSupportAt(x, z, blocks = this.blocks) {
      const y = this.player.y - 0.01;
      const minX = Math.floor(x - PLAYER_WIDTH / 2 + 1e-9);
      const maxX = Math.floor(x + PLAYER_WIDTH / 2 - 1e-9);
      const minZ = Math.floor(z - PLAYER_WIDTH / 2 + 1e-9);
      const maxZ = Math.floor(z + PLAYER_WIDTH / 2 - 1e-9);
      for (let bx = minX; bx <= maxX; bx++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (blocks.has(key(bx, Math.floor(y), bz))) return true;
        }
      }
      return false;
    }

    place(eyeHeight = EYE_HEIGHT) {
      if (this.inventory <= 0) return null;
      const hit = this.raycast(eyeHeight);
      if (!hit) return null;
      const target = hit.block.map((value, axis) => value + hit.face[axis]);
      const targetKey = vectorKey(target);
      if (this.blocks.has(targetKey)) return null;
      this.blocks.add(targetKey);
      if (this.boxCollides(this.player.x, this.player.y, this.player.z)) {
        this.blocks.delete(targetKey);
        return null;
      }
      this.inventory -= 1;
      return target;
    }

    raycast(eyeHeight = EYE_HEIGHT) {
      const player = this.player;
      const origin = [player.x, player.y + eyeHeight, player.z];
      const yawDegrees = F(player.yawHead * 180 / Math.PI);
      const pitchDegrees = F(player.pitch * 180 / Math.PI);
      const radiansPerDegree = F(0.017453292);
      const yawAngle = F(F(-yawDegrees * radiansPerDegree) - F(Math.PI));
      const pitchAngle = F(-pitchDegrees * radiansPerDegree);
      const yawCos = minecraftCos(yawAngle);
      const yawSin = minecraftSin(yawAngle);
      const pitchCos = -minecraftCos(pitchAngle);
      const pitchSin = minecraftSin(pitchAngle);
      const direction = [
        F(yawSin * pitchCos),
        pitchSin,
        F(yawCos * pitchCos),
      ];
      const voxel = origin.map(Math.floor);
      const step = direction.map(Math.sign);
      const delta = direction.map(value => value === 0 ? Infinity : Math.abs(1 / value));
      const max = direction.map((value, axis) => {
        if (value === 0) return Infinity;
        const nextBoundary = voxel[axis] + (step[axis] > 0 ? 1 : 0);
        return (nextBoundary - origin[axis]) / value;
      });
      while (Math.min(...max) <= REACH) {
        let axis = 0;
        if (max[1] < max[axis]) axis = 1;
        if (max[2] < max[axis]) axis = 2;
        voxel[axis] += step[axis];
        const face = [0, 0, 0];
        face[axis] = -step[axis];
        if (this.blocks.has(vectorKey(voxel))) {
          return {block: [...voxel], face};
        }
        max[axis] += delta[axis];
      }
      return null;
    }
  }

  const sessions = new Map();

  function initialTick(environment) {
    const player = environment.player;
    return {
      tick: 0,
      action: {...DEFAULT_ACTION},
      pre_position: [player.x, player.y, player.z],
      pre_velocity: [player.vx, player.vy, player.vz],
      pre_on_ground: player.onGround,
      position: [player.x, player.y, player.z],
      velocity: [player.vx, player.vy, player.vz],
      on_ground: player.onGround,
      sprinting: player.sprinting,
      yaw: player.yaw,
      pitch: player.pitch,
      eye_height: EYE_HEIGHT,
      placed: null,
      reward: 0,
    };
  }

  function sortedBlocks(blocks) {
    return [...blocks]
      .map(blockKey => blockKey.split(',').map(Number))
      .sort((left, right) => left[0] - right[0]
        || left[1] - right[1] || left[2] - right[2]);
  }

  function resetSession() {
    const environment = new BrowserBridgeEnvironment();
    const sessionId = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    sessions.clear();
    sessions.set(sessionId, environment);
    return {
      session_id: sessionId,
      document: {
        benchmark: {
          game_version: GAME_VERSION,
          direction: '+Z',
          gap_blocks: environment.distance,
          platform_size: [5, 3],
        },
        initial_pose: {
          position: [environment.player.x, environment.player.y, environment.player.z],
          yaw: environment.player.yaw,
          pitch: environment.player.pitch,
        },
        initial_blocks: sortedBlocks(environment.initialBlocks),
        ticks: [initialTick(environment)],
      },
    };
  }

  function stepSession(payload) {
    const environment = sessions.get(payload?.session_id);
    if (!environment) throw new Error('play session not found; reset the simulator');
    const tick = environment.step(payload?.action);
    const completionEvent = environment.success && !environment.playCompleted;
    if (environment.success) {
      environment.playCompleted = true;
      environment.done = false;
      environment.success = false;
    }
    return {
      tick,
      done: environment.done,
      success: completionEvent,
      blocks_used: Math.max(64, environment.distance + 4) - environment.inventory,
    };
  }

  window.BridgeSimulator = Object.freeze({
    Environment: BrowserBridgeEnvironment,
    async post(path, payload = {}) {
      if (path === '/api/play/reset') return resetSession();
      if (path === '/api/play/step') return stepSession(payload);
      throw new Error(`Unsupported local simulator route: ${path}`);
    },
  });
})();
