import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import * as CANNON from "cannon-es";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1016);
scene.fog = new THREE.Fog(0x0b1016, 30, 120);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, renderer.domElement);
const hudInfo = document.getElementById("info");
const statusEl = document.getElementById("status");

renderer.domElement.addEventListener("click", () => {
  if (!controls.isLocked) {
    controls.lock();
  }
});

controls.addEventListener("lock", () => {
  hudInfo.style.opacity = "0.55";
});

controls.addEventListener("unlock", () => {
  hudInfo.style.opacity = "1";
});

const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -24, 0)
});
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 20;
world.solver.tolerance = 0.0005;

const defaultMaterial = new CANNON.Material("default");
const slipperyMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
  friction: 0.1,
  restitution: 0
});
world.defaultContactMaterial = slipperyMaterial;

const GROUP_PLAYER = 1;
const GROUP_WORLD = 2;
const GROUP_TARGET = 4;
const GROUP_PROJECTILE = 8;

scene.add(new THREE.HemisphereLight(0x99ccff, 0x1f1f1f, 0.45));

const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(20, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
scene.add(sun);

const arenaRadius = 30;
const wallHeight = 7;
const wallThickness = 2;
const wallSegments = 40;

const floorGeometry = new THREE.CircleGeometry(arenaRadius, 72);
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x202a38,
  roughness: 0.85,
  metalness: 0.05
});
const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const floorBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Plane(),
  material: defaultMaterial
});
floorBody.collisionFilterGroup = GROUP_WORLD;
floorBody.collisionFilterMask = GROUP_PLAYER | GROUP_TARGET | GROUP_PROJECTILE;
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0x3a4657,
  roughness: 0.7,
  metalness: 0.1
});

for (let i = 0; i < wallSegments; i += 1) {
  const t = (i / wallSegments) * Math.PI * 2;
  const nextT = ((i + 1) / wallSegments) * Math.PI * 2;
  const x1 = Math.cos(t) * arenaRadius;
  const z1 = Math.sin(t) * arenaRadius;
  const x2 = Math.cos(nextT) * arenaRadius;
  const z2 = Math.sin(nextT) * arenaRadius;

  const centerX = (x1 + x2) * 0.5;
  const centerZ = (z1 + z2) * 0.5;
  const segLen = Math.hypot(x2 - x1, z2 - z1) + 0.15;
  const yaw = Math.atan2(z2 - z1, x2 - x1);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(segLen, wallHeight, wallThickness),
    wallMaterial
  );
  mesh.position.set(centerX, wallHeight * 0.5, centerZ);
  mesh.rotation.y = -yaw;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({
    mass: 0,
    material: defaultMaterial,
    shape: new CANNON.Box(
      new CANNON.Vec3(segLen * 0.5, wallHeight * 0.5, wallThickness * 0.5)
    )
  });
  body.collisionFilterGroup = GROUP_WORLD;
  body.collisionFilterMask = GROUP_PLAYER | GROUP_TARGET | GROUP_PROJECTILE;
  body.position.set(centerX, wallHeight * 0.5, centerZ);
  body.quaternion.setFromEuler(0, -yaw, 0);
  world.addBody(body);
}

const obstacleMaterial = new THREE.MeshStandardMaterial({
  color: 0x5fa3ff,
  roughness: 0.55,
  metalness: 0.05
});
const objects = [];
const targetsToRemove = new Set();
const targetsToAnchor = new Set();
const targetsToSpawn = [];
const pendingDamage = new Map();
let targetsRemaining = 0;

function anchorBlock(target) {
  if (!target.alive || target.anchored) {
    return;
  }
  target.anchored = true;
  target.body.velocity.set(0, 0, 0);
  target.body.angularVelocity.set(0, 0, 0);
  target.body.mass = 0;
  target.body.type = CANNON.Body.STATIC;
  target.body.updateMassProperties();
}

function spawnTarget({
  x,
  y,
  z,
  size = 1.75,
  health = 10,
  type = "big",
  velocity = null
}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    obstacleMaterial.clone()
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const massScale = Math.max(120, size * size * size * 80);
  const body = new CANNON.Body({
    mass: massScale,
    shape: new CANNON.Box(new CANNON.Vec3(size * 0.5, size * 0.5, size * 0.5)),
    material: defaultMaterial,
    linearDamping: 0.4,
    angularDamping: 1
  });
  body.fixedRotation = true;
  body.updateMassProperties();
  body.collisionFilterGroup = GROUP_TARGET;
  body.collisionFilterMask = GROUP_WORLD | GROUP_TARGET | GROUP_PROJECTILE | GROUP_PLAYER;
  body.position.set(x, y, z);
  if (velocity) {
    body.velocity.set(velocity.x, velocity.y, velocity.z);
  }
  world.addBody(body);

  objects.push({
    mesh,
    body,
    kind: "target",
    alive: true,
    anchored: false,
    type,
    size,
    health,
    maxHealth: health
  });
  const targetRef = objects[objects.length - 1];
  body.addEventListener("collide", (event) => {
    if (targetRef.anchored || !targetRef.alive) {
      return;
    }
    const group = event.body.collisionFilterGroup;
    if (group === GROUP_WORLD || group === GROUP_TARGET || event.body === playerBody) {
      targetsToAnchor.add(targetRef);
    }
  });
  targetsRemaining += 1;
}

for (let i = 0; i < 16; i += 1) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 5 + Math.random() * (arenaRadius - 10);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = 2 + Math.random() * 4;
  spawnTarget({ x, y, z, size: 1.75, health: 10, type: "big" });
}

const playerRadius = 0.45;
const playerBody = new CANNON.Body({
  mass: 80,
  shape: new CANNON.Sphere(playerRadius),
  position: new CANNON.Vec3(0, 2.2, 0),
  material: defaultMaterial,
  linearDamping: 0.08,
  fixedRotation: true
});
playerBody.collisionFilterGroup = GROUP_PLAYER;
playerBody.collisionFilterMask = GROUP_WORLD | GROUP_TARGET;
playerBody.allowSleep = false;
world.addBody(playerBody);

const eyeHeight = 0.7;
camera.position.set(0, playerBody.position.y + eyeHeight, 0);

const weaponRig = new THREE.Group();
weaponRig.position.set(0.34, -0.28, -0.56);
camera.add(weaponRig);
scene.add(camera);

const weaponMaterial = new THREE.MeshStandardMaterial({
  color: 0x262a30,
  roughness: 0.42,
  metalness: 0.55
});
const weaponAccentMaterial = new THREE.MeshStandardMaterial({
  color: 0x7f8c98,
  roughness: 0.35,
  metalness: 0.8
});
const weaponEmitterMaterial = new THREE.MeshStandardMaterial({
  color: 0x303943,
  emissive: 0xff5a1f,
  emissiveIntensity: 0.35,
  roughness: 0.3,
  metalness: 0.6
});

const launcherBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.18, 0.85),
  weaponMaterial
);
launcherBody.position.set(0, -0.02, -0.24);
weaponRig.add(launcherBody);

const launcherBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.065, 0.075, 0.55, 20),
  weaponAccentMaterial
);
launcherBarrel.rotation.x = Math.PI / 2;
launcherBarrel.position.set(0, 0.03, -0.62);
weaponRig.add(launcherBarrel);

const launcherNozzle = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.085, 0.11, 20),
  weaponEmitterMaterial
);
launcherNozzle.rotation.x = Math.PI / 2;
launcherNozzle.position.set(0, 0.03, -0.9);
weaponRig.add(launcherNozzle);

const launcherGrip = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 0.23, 0.13),
  weaponMaterial
);
launcherGrip.position.set(0, -0.18, -0.05);
launcherGrip.rotation.x = -0.22;
weaponRig.add(launcherGrip);

const launcherTopRail = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.035, 0.3),
  weaponAccentMaterial
);
launcherTopRail.position.set(0, 0.12, -0.3);
weaponRig.add(launcherTopRail);

const rearSight = new THREE.Mesh(
  new THREE.BoxGeometry(0.03, 0.08, 0.03),
  weaponAccentMaterial
);
rearSight.position.set(0, 0.15, -0.12);
weaponRig.add(rearSight);

const frontSight = new THREE.Mesh(
  new THREE.BoxGeometry(0.03, 0.08, 0.03),
  weaponAccentMaterial
);
frontSight.position.set(0, 0.15, -0.72);
weaponRig.add(frontSight);

const keys = {
  KeyW: false,
  KeyA: false,
  KeyS: false,
  KeyD: false,
  KeyQ: false,
  KeyE: false,
  Space: false
};

window.addEventListener("keydown", (event) => {
  if (event.code in keys) {
    keys[event.code] = true;
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code in keys) {
    keys[event.code] = false;
  }
});

const projectileMesh = new THREE.SphereGeometry(0.12, 8, 8);
const projectileMat = new THREE.MeshStandardMaterial({ color: 0xffd084 });
const projectiles = [];
let canShoot = true;
let weaponRecoil = 0;
const baseWeaponPos = weaponRig.position.clone();
const baseWeaponRot = weaponRig.rotation.clone();

function shoot() {
  if (!controls.isLocked || !canShoot) {
    return;
  }

  canShoot = false;
  setTimeout(() => {
    canShoot = true;
  }, 130);

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  const start = new THREE.Vector3(
    playerBody.position.x,
    playerBody.position.y + eyeHeight,
    playerBody.position.z
  );
  start.addScaledVector(direction, 0.9);

  const mesh = new THREE.Mesh(projectileMesh, projectileMat);
  mesh.castShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({
    mass: 0.35,
    shape: new CANNON.Sphere(0.12),
    position: new CANNON.Vec3(start.x, start.y, start.z),
    material: defaultMaterial,
    linearDamping: 0,
    collisionResponse: true
  });
  body.collisionFilterGroup = GROUP_PROJECTILE;
  body.collisionFilterMask = GROUP_WORLD | GROUP_TARGET;

  const speed = 70;
  body.velocity.set(direction.x * speed, direction.y * speed, direction.z * speed);
  world.addBody(body);
  weaponRecoil = Math.min(weaponRecoil + 0.095, 0.2);

  const projectile = {
    mesh,
    body,
    ttl: 2.8,
    dead: false
  };
  projectiles.push(projectile);

  body.addEventListener("collide", (event) => {
    if (projectile.dead) {
      return;
    }

    const hit = objects.find((obj) => obj.body === event.body && obj.kind === "target");
    if (hit && hit.alive) {
      pendingDamage.set(hit, (pendingDamage.get(hit) || 0) + 1);
    }

    projectile.dead = true;
  });
}

window.addEventListener("mousedown", (event) => {
  if (event.button === 0) {
    event.preventDefault();
    shoot();
  }
});

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const moveDir = new THREE.Vector3();
const weaponForward = new THREE.Vector3();
const upAxis = new CANNON.Vec3(0, 1, 0);
const groundRayStart = new CANNON.Vec3();
const groundRayEnd = new CANNON.Vec3();
const groundRayResult = new CANNON.RaycastResult();
const weaponRayStart = new CANNON.Vec3();
const weaponRayEnd = new CANNON.Vec3();
const weaponRayResult = new CANNON.RaycastResult();

function isPlayerGrounded() {
  groundRayStart.set(playerBody.position.x, playerBody.position.y, playerBody.position.z);
  groundRayEnd.set(
    playerBody.position.x,
    playerBody.position.y - (playerRadius + 0.2),
    playerBody.position.z
  );
  groundRayResult.reset();
  world.raycastClosest(groundRayStart, groundRayEnd, {
    collisionFilterMask: GROUP_WORLD | GROUP_TARGET,
    skipBackfaces: true
  }, groundRayResult);
  if (groundRayResult.hasHit) {
    return true;
  }

  for (const contact of world.contacts) {
    let normalY = 0;

    if (contact.bi === playerBody) {
      normalY = contact.ni.dot(upAxis);
    } else if (contact.bj === playerBody) {
      normalY = -contact.ni.dot(upAxis);
    } else {
      continue;
    }

    if (normalY > 0.3) {
      return true;
    }
  }
  return false;
}

function getWeaponWallPushback() {
  camera.getWorldDirection(weaponForward);
  const eyeX = playerBody.position.x;
  const eyeY = playerBody.position.y + eyeHeight;
  const eyeZ = playerBody.position.z;
  const checkDistance = 1.05;
  weaponRayStart.set(eyeX, eyeY, eyeZ);
  weaponRayEnd.set(
    eyeX + weaponForward.x * checkDistance,
    eyeY + weaponForward.y * checkDistance,
    eyeZ + weaponForward.z * checkDistance
  );
  weaponRayResult.reset();
  world.raycastClosest(
    weaponRayStart,
    weaponRayEnd,
    {
      collisionFilterMask: GROUP_WORLD | GROUP_TARGET,
      skipBackfaces: true
    },
    weaponRayResult
  );

  if (!weaponRayResult.hasHit) {
    return 0;
  }

  const startPush = 0.95;
  const maxPush = 0.5;
  const distance = weaponRayResult.distance;
  if (distance >= startPush) {
    return 0;
  }
  return Math.min(maxPush, ((startPush - distance) / startPush) * maxPush);
}

function updatePlayerMotion(delta) {
  const inputForward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const inputRight =
    (keys.KeyD ? 1 : 0) -
    (keys.KeyA ? 1 : 0) +
    (keys.KeyE ? 1 : 0) -
    (keys.KeyQ ? 1 : 0);

  moveDir.set(0, 0, 0);

  if (controls.isLocked) {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    right.crossVectors(forward, camera.up).normalize();

    moveDir.addScaledVector(forward, inputForward);
    moveDir.addScaledVector(right, inputRight);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }
  }

  const desiredSpeed = 12;
  const accel = 42;

  const targetVx = moveDir.x * desiredSpeed;
  const targetVz = moveDir.z * desiredSpeed;

  const blend = Math.min(1, accel * delta);
  playerBody.velocity.x += (targetVx - playerBody.velocity.x) * blend;
  playerBody.velocity.z += (targetVz - playerBody.velocity.z) * blend;

  const isGrounded = isPlayerGrounded();
  if (keys.Space && isGrounded) {
    playerBody.velocity.y = 8.8;
  }

  const horizontalLimit = 20;
  const speedXZ = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
  if (speedXZ > horizontalLimit) {
    const ratio = horizontalLimit / speedXZ;
    playerBody.velocity.x *= ratio;
    playerBody.velocity.z *= ratio;
  }
}

const clock = new THREE.Clock();
let accumulator = 0;
const fixedStep = 1 / 120;
const arenaEventInterval = 4;
const blockEvolutionDuration = 120;
let arenaEventTimer = 0;
let arenaProgressLevel = 0;
let matchTime = 0;

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function enqueueArenaRandomization() {
  const aliveBig = objects.filter(
    (obj) => obj.alive && obj.kind === "target" && obj.type === "big"
  );
  const highPattern = arenaProgressLevel % 2 === 0;
  const splitSizeMin = highPattern ? 0.45 : 0.75;
  const splitSizeMax = highPattern ? 1.15 : 1.55;
  const splitHeightBoost = highPattern ? 2.8 : 0.9;

  const splitCount = Math.min(aliveBig.length, 2 + Math.floor(Math.random() * 3));
  for (let i = 0; i < splitCount; i += 1) {
    if (aliveBig.length === 0) {
      break;
    }

    const idx = Math.floor(Math.random() * aliveBig.length);
    const target = aliveBig.splice(idx, 1)[0];
    targetsToRemove.add(target);

    const childCount = 2 + Math.floor(Math.random() * 3);
    for (let c = 0; c < childCount; c += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randRange(4.5, 9);
      targetsToSpawn.push({
        x: target.body.position.x + randRange(-0.5, 0.5),
        y: Math.max(1.2, target.body.position.y + randRange(0.2, 1.2 + splitHeightBoost)),
        z: target.body.position.z + randRange(-0.5, 0.5),
        size: randRange(splitSizeMin, splitSizeMax),
        health: 10,
        type: "small",
        velocity: {
          x: Math.cos(angle) * speed,
          y: randRange(2, highPattern ? 8 : 5.5),
          z: Math.sin(angle) * speed
        }
      });
    }
  }

  const skyDropBase = 3 + Math.floor(arenaProgressLevel * 0.6);
  const skyDropCount = Math.min(22, skyDropBase + Math.floor(Math.random() * 4));
  for (let i = 0; i < skyDropCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = randRange(2, arenaRadius - 6);
    const sizeMin = highPattern ? 0.95 : 1.55;
    const sizeMax = highPattern ? 2.85 : 2.25;
    const spawnYMin = highPattern ? 18 : 10;
    const spawnYMax = highPattern ? 36 : 24;
    targetsToSpawn.push({
      x: Math.cos(angle) * radius,
      y: randRange(spawnYMin, spawnYMax),
      z: Math.sin(angle) * radius,
      size: randRange(sizeMin, sizeMax),
      health: 10,
      type: "big",
      velocity: {
        x: randRange(-1.6, 1.6),
        y: randRange(-2.5, -0.3),
        z: randRange(-1.6, 1.6)
      }
    });
  }
}

function animate() {
  const dt = Math.min(0.033, clock.getDelta());
  accumulator += dt;
  const elapsed = clock.elapsedTime;

  while (accumulator >= fixedStep) {
    updatePlayerMotion(fixedStep);
    world.step(fixedStep);
    accumulator -= fixedStep;
    matchTime += fixedStep;
    arenaEventTimer += fixedStep;

    for (const obj of objects) {
      if (!obj.alive) {
        continue;
      }
      obj.mesh.position.copy(obj.body.position);
      obj.mesh.quaternion.copy(obj.body.quaternion);
    }

    if (pendingDamage.size > 0) {
      for (const [target, damage] of pendingDamage) {
        if (!target.alive) {
          continue;
        }
        target.health -= damage;
        const healthRatio = Math.max(0, target.health / target.maxHealth);
        target.mesh.material.color.setRGB(
          1 - healthRatio * 0.55,
          0.28 + healthRatio * 0.36,
          0.28 + healthRatio * 0.72
        );
        if (target.health <= 0) {
          targetsToRemove.add(target);
        }
      }
      pendingDamage.clear();
    }

    if (targetsToAnchor.size > 0) {
      for (const target of targetsToAnchor) {
        anchorBlock(target);
      }
      targetsToAnchor.clear();
    }

    if (targetsToRemove.size > 0) {
      for (const target of targetsToRemove) {
        if (!target.alive) {
          continue;
        }
        target.alive = false;
        targetsRemaining -= 1;
        scene.remove(target.mesh);
        world.removeBody(target.body);
      }
      targetsToRemove.clear();
    }

    if (matchTime < blockEvolutionDuration && arenaEventTimer >= arenaEventInterval) {
      arenaEventTimer = 0;
      arenaProgressLevel += 1;
      enqueueArenaRandomization();
    }

    if (targetsToSpawn.length > 0) {
      for (const spawn of targetsToSpawn) {
        spawnTarget(spawn);
      }
      targetsToSpawn.length = 0;
    }

    for (const projectile of projectiles) {
      if (projectile.dead) {
        continue;
      }

      projectile.ttl -= fixedStep;
      if (projectile.ttl <= 0) {
        projectile.dead = true;
      }

      projectile.mesh.position.copy(projectile.body.position);
      projectile.mesh.quaternion.copy(projectile.body.quaternion);
    }

    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = projectiles[i];
      if (!projectile.dead) {
        continue;
      }
      scene.remove(projectile.mesh);
      world.removeBody(projectile.body);
      projectiles.splice(i, 1);
    }
  }

  camera.position.set(
    playerBody.position.x,
    playerBody.position.y + eyeHeight,
    playerBody.position.z
  );

  const horizontalSpeed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
  const swayIntensity = Math.min(horizontalSpeed / 14, 1);
  const swayX = Math.sin(elapsed * 9.5) * 0.012 * swayIntensity;
  const swayY = Math.abs(Math.cos(elapsed * 19)) * 0.01 * swayIntensity;
  const wallPushback = getWeaponWallPushback();

  weaponRecoil = Math.max(0, weaponRecoil - dt * 0.28);
  weaponRig.position.x = baseWeaponPos.x + swayX;
  weaponRig.position.y =
    baseWeaponPos.y - swayY + weaponRecoil * 0.18 - wallPushback * 0.05;
  weaponRig.position.z = baseWeaponPos.z + weaponRecoil + wallPushback;
  weaponRig.rotation.x = baseWeaponRot.x - weaponRecoil * 0.85 + wallPushback * 0.15;
  weaponRig.rotation.y = baseWeaponRot.y + swayX * 0.8;
  weaponRig.rotation.z = baseWeaponRot.z - swayX * 1.8;

  statusEl.textContent =
    targetsRemaining > 0
      ? `Targets left: ${targetsRemaining} | ${
          matchTime < blockEvolutionDuration
            ? `4s event in ${Math.max(0, Math.ceil(arenaEventInterval - arenaEventTimer))}s`
            : "Block changes stopped"
        }`
      : `Targets left: 0 | ${
          matchTime < blockEvolutionDuration
            ? `4s event in ${Math.max(0, Math.ceil(arenaEventInterval - arenaEventTimer))}s`
            : "Block changes stopped"
        }`;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
