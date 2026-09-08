import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { countries, polygonArea, type Country } from './geography';

type Point = { longitude: number; latitude: number };
type Answer = Point & { correct: boolean };
const radians = Math.PI / 180;

function position(point: Point, radius = 1): THREE.Vector3 {
  const latitude = point.latitude * radians;
  const longitude = point.longitude * radians;
  return new THREE.Vector3(Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)).multiplyScalar(radius);
}

function geographic(point: THREE.Vector3): Point {
  return { longitude: Math.atan2(point.x, point.z) / radians, latitude: Math.asin(THREE.MathUtils.clamp(point.y / point.length(), -1, 1)) / radians };
}

// Only geographic coordinates cross this presentation boundary. Evaluation,
// learning-item identity, assistance, and scheduling remain in LearnerSession.
export class Globe {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
  // OrbitControls owns the input position; the rendered camera eases its
  // distance because native damping only smooths rotation, not dollying.
  private readonly orbitCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
  private controls: OrbitControls;
  private readonly texture: THREE.CanvasTexture;
  private readonly surface: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly pinTexture: THREE.CanvasTexture;
  private readonly pin: THREE.Sprite;
  private hasSelection = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly observer: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly pointers = new Set<number>();
  private readonly rotationStep = new THREE.Quaternion();
  private readonly nativeFrom = new THREE.Vector3();
  private readonly nativeTo = new THREE.Vector3();
  private readonly nativeRotation = new THREE.Quaternion();
  private frame?: number;
  private lastFrameTime = 0;
  private updatingControls = false;
  private zoomTarget = 3;
  private zoomMotion?: { altitude: number; velocity: number; time: number };
  private rotationMotion?: { from: THREE.Vector3; to: THREE.Vector3; rotation: THREE.Quaternion; start: number; duration: number };
  private active = false;
  private disposed = false;
  private highlighted?: Country;

  constructor(private readonly container: HTMLElement, onSelect: (point: Point) => void, onUnavailable: () => void) {
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Interactive globe');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.copy(position({ longitude: 0, latitude: 15 }, 3));
    this.orbitCamera.position.copy(this.camera.position);
    this.controls = this.createControls();
    this.camera.lookAt(this.controls.target);
    const atlas = document.createElement('canvas');
    atlas.width = Math.min(8192, this.renderer.capabilities.maxTextureSize);
    atlas.height = atlas.width / 2;
    this.texture = new THREE.CanvasTexture(atlas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshBasicMaterial({ map: this.texture }));
    // Three's sphere UV seam starts on -X; the geographic seam is 180°.
    this.surface.rotation.y = -Math.PI / 2;
    const marker = document.createElement('canvas');
    marker.width = marker.height = 64;
    const markerContext = marker.getContext('2d')!;
    markerContext.fillStyle = '#fff';
    markerContext.beginPath();
    markerContext.arc(32, 32, 32, 0, Math.PI * 2);
    markerContext.fill();
    this.pinTexture = new THREE.CanvasTexture(marker);
    this.pin = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.pinTexture, color: '#d6ef87', depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.pin.renderOrder = 1;
    this.scene.add(this.surface, this.pin);
    this.pin.visible = false;
    this.paint();
    container.prepend(canvas);
    this.reducedMotion.addEventListener('change', this.motionPreferenceChanged);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      onUnavailable();
    });
    // A drag, pinch, or cancelled gesture must never drop an answer pin.
    let origin = { x: 0, y: 0 };
    let moved = false;
    canvas.addEventListener('pointerdown', event => {
      if (!this.active || this.disposed) return;
      this.stopMotion();
      this.pointers.add(event.pointerId);
      if (this.pointers.size === 1) {
        origin = { x: event.clientX, y: event.clientY };
        moved = event.button !== 0;
      } else moved = true;
    }, { capture: true });
    canvas.addEventListener('pointermove', event => {
      if (this.pointers.has(event.pointerId) && this.rotationMotion) this.stopMotion();
      if (this.pointers.has(event.pointerId) && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5) moved = true;
      // OrbitControls suppresses small change events with a world-space epsilon.
      // Keep every native delta; visible direction settles once per frame.
      if (this.pointers.has(event.pointerId)) this.requestFrame();
    });
    canvas.addEventListener('pointercancel', event => { this.pointers.delete(event.pointerId); moved = true; });
    canvas.addEventListener('lostpointercapture', event => {
      if (this.pointers.delete(event.pointerId)) moved = true;
    });
    canvas.addEventListener('wheel', () => {
      if (this.rotationMotion) this.stopMotion();
    }, { capture: true, passive: true });
    canvas.addEventListener('pointerup', event => {
      const wasDown = this.pointers.delete(event.pointerId);
      if (!wasDown || moved || this.pointers.size || !this.active || this.disposed) return;
      const bounds = canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), this.camera);
      // Intersect the mathematical sphere, not the tessellated display mesh.
      const hit = this.raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
      if (hit) onSelect(geographic(hit));
    });
    canvas.addEventListener('keydown', event => {
      if (!this.active || this.disposed) return;
      const point = geographic(event.key.startsWith('Arrow') ? this.rotationMotion?.to ?? this.camera.position : this.camera.position);
      if (event.key === 'ArrowLeft') point.longitude -= 15;
      else if (event.key === 'ArrowRight') point.longitude += 15;
      else if (event.key === 'ArrowUp') point.latitude = Math.min(85, point.latitude + 15);
      else if (event.key === 'ArrowDown') point.latitude = Math.max(-85, point.latitude - 15);
      else if (event.key === '+' || event.key === '=') this.zoom(0.8);
      else if (event.key === '-') this.zoom(1.25);
      else if (event.key === 'Enter' || event.key === ' ') onSelect(point);
      else return;
      event.preventDefault();
      if (event.key.startsWith('Arrow')) {
        this.moveTo(position(point, this.zoomTarget));
      }
    });
  }

  private createControls() {
    const controls = new OrbitControls(this.orbitCamera, this.renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.15;
    controls.maxDistance = 4;
    // Native damping integrates once per event AND per update, so touch event
    // frequency changes both response and travel. Accumulate native rotation
    // exactly, then smooth the rendered direction only once per frame.
    controls.enableDamping = false;
    controls.enabled = this.active;
    controls.addEventListener('change', this.controlsChanged);
    return controls;
  }

  private controlsChanged = () => {
    if (this.updatingControls || this.disposed) return;
    const distance = this.orbitCamera.position.length();
    if (Math.abs(distance - this.zoomTarget) > 1e-8) this.easeZoom(distance);
    if (this.reducedMotion.matches || !this.active) {
      this.camera.position.copy(this.orbitCamera.position);
      this.camera.lookAt(this.controls.target);
      this.render();
    } else this.requestFrame();
  };

  private requestFrame() {
    if (!this.active || this.disposed || this.frame !== undefined) return;
    if (!this.lastFrameTime) this.lastFrameTime = performance.now();
    this.frame = requestAnimationFrame(this.animate);
  }

  private animate = (time: number) => {
    this.frame = undefined;
    if (!this.active || this.disposed) return;
    const elapsed = Math.max(0, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;
    const programmatic = !!this.rotationMotion;
    this.updatingControls = true;
    if (this.rotationMotion) {
      const motion = this.rotationMotion;
      const progress = THREE.MathUtils.clamp((time - motion.start) / motion.duration, 0, 1);
      const eased = progress ** 3 * (10 + progress * (-15 + 6 * progress));
      this.rotationStep.identity().slerp(motion.rotation, eased);
      this.orbitCamera.position.copy(motion.from).applyQuaternion(this.rotationStep).setLength(this.zoomTarget);
      if (progress === 1) this.rotationMotion = undefined;
    }
    this.controls.update();
    this.updatingControls = false;
    let distance = this.zoomTarget;
    if (this.zoomMotion) {
      const motion = this.zoomMotion;
      const elapsed = Math.max(0, (time - motion.time) / 1000);
      motion.time = time;
      const target = Math.log(this.zoomTarget - 1);
      const near = THREE.MathUtils.clamp((target - Math.log(0.15)) / Math.log(20), 0, 1);
      const frequency = 12 + 8 * near;
      // Exact critically damped integration in log altitude. Retargeting keeps
      // velocity, and equal ratios of visible surface scale feel equally fast.
      const offset = motion.altitude - target;
      const impulse = motion.velocity + frequency * offset;
      const decay = Math.exp(-frequency * elapsed);
      motion.altitude = target + (offset + impulse * elapsed) * decay;
      motion.velocity = (motion.velocity - frequency * impulse * elapsed) * decay;
      const minimum = Math.log(this.controls.minDistance - 1);
      const maximum = Math.log(this.controls.maxDistance - 1);
      if (motion.altitude < minimum || motion.altitude > maximum) {
        motion.altitude = THREE.MathUtils.clamp(motion.altitude, minimum, maximum);
        motion.velocity = 0;
      }
      distance = 1 + Math.exp(motion.altitude);
      // Stop below a fraction of a CSS pixel, including residual velocity, so
      // the final snap is invisible without keeping an idle RAF alive.
      const pixels = Math.max(1, this.renderer.domElement.clientHeight) / 2;
      if (Math.abs(motion.altitude - target) * pixels < 0.05 && Math.abs(motion.velocity) * pixels < 0.5) {
        distance = this.zoomTarget;
        this.zoomMotion = undefined;
      }
    }
    let rotating = false;
    if (!programmatic && !this.reducedMotion.matches) {
      this.nativeFrom.copy(this.camera.position).normalize();
      this.nativeTo.copy(this.orbitCamera.position).normalize();
      const angle = this.nativeFrom.angleTo(this.nativeTo);
      const altitude = this.camera.position.length() - 1;
      const pixelsPerRadian = this.renderer.domElement.clientHeight / (2 * altitude * Math.tan(this.camera.fov * radians / 2));
      rotating = angle * pixelsPerRadian > 0.02;
      if (rotating) {
        const lag = 0.035 + 0.02 * (1 - THREE.MathUtils.clamp(altitude / 2, 0, 1));
        this.nativeRotation.setFromUnitVectors(this.nativeFrom, this.nativeTo);
        this.rotationStep.identity().slerp(this.nativeRotation, 1 - Math.exp(-elapsed / lag));
        this.camera.position.copy(this.nativeFrom).applyQuaternion(this.rotationStep).setLength(distance);
      } else this.camera.position.copy(this.orbitCamera.position).setLength(distance);
    } else this.camera.position.copy(this.orbitCamera.position).setLength(distance);
    this.camera.lookAt(this.controls.target);
    this.render();
    if (rotating || this.rotationMotion || this.zoomMotion) this.requestFrame();
    else this.lastFrameTime = 0;
  };

  private easeZoom(distance: number) {
    this.zoomTarget = THREE.MathUtils.clamp(distance, this.controls.minDistance, this.controls.maxDistance);
    if (this.active && !this.reducedMotion.matches) {
      this.zoomMotion ??= { altitude: Math.log(this.camera.position.length() - 1), velocity: 0, time: performance.now() };
    } else this.zoomMotion = undefined;
  }

  private stopMotion() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.lastFrameTime = 0;
    this.rotationMotion = undefined;
    this.zoomMotion = undefined;
    this.orbitCamera.position.copy(this.camera.position);
    this.zoomTarget = this.camera.position.length();
    this.updatingControls = true;
    this.controls.update();
    this.updatingControls = false;
  }

  private moveTo(destination: THREE.Vector3) {
    if (this.disposed) return;
    this.easeZoom(destination.length());
    if (!this.active || this.reducedMotion.matches) {
      this.rotationMotion = undefined;
      this.orbitCamera.position.copy(destination).setLength(this.zoomTarget);
      this.controls.update();
      this.controlsChanged();
      return;
    }
    const from = this.camera.position.clone().normalize();
    const to = destination.clone().normalize();
    const angle = from.angleTo(to);
    const altitude = Math.min(this.camera.position.length(), this.zoomTarget) - 1;
    const duration = Math.min(1400, 180 + angle / radians * 4 * Math.max(1, Math.sqrt(1 / altitude)));
    this.rotationMotion = { from, to, rotation: new THREE.Quaternion().setFromUnitVectors(from, to), start: performance.now(), duration };
    this.orbitCamera.position.copy(this.camera.position).setLength(this.zoomTarget);
    this.requestFrame();
  }

  private motionPreferenceChanged = () => {
    if (this.disposed) return;
    if (!this.reducedMotion.matches) return;
    if (this.rotationMotion) this.orbitCamera.position.copy(this.rotationMotion.to);
    this.orbitCamera.position.setLength(this.zoomTarget);
    this.camera.position.copy(this.orbitCamera.position);
    this.camera.lookAt(this.controls.target);
    this.stopMotion();
    this.render();
  };

  private paint() {
    const canvas = this.texture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    const scale = canvas.width / 360;
    context.fillStyle = '#172d3b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#304956';
    context.lineWidth = 1;
    context.beginPath();
    for (let longitude = -180; longitude <= 180; longitude += 30) {
      const x = (longitude + 180) * scale;
      context.moveTo(x, 0); context.lineTo(x, canvas.height);
    }
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const y = (90 - latitude) * scale;
      context.moveTo(0, y); context.lineTo(canvas.width, y);
    }
    context.stroke();
    for (const country of countries) {
      const highlighted = country === this.highlighted;
      context.fillStyle = highlighted ? '#a2c472' : '#334c57';
      context.strokeStyle = highlighted ? '#e3f5b1' : '#63777f';
      context.lineWidth = highlighted ? 3 : 1.5;
      const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
      for (const polygon of polygons) {
        context.beginPath();
        for (const ring of polygon) {
          ring.forEach(([longitude, latitude], index) => {
            const x = (longitude + 180) * scale;
            const y = (90 - latitude) * scale;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.closePath();
        }
        context.fill('evenodd');
        context.stroke();
      }
    }
    this.texture.needsUpdate = true;
  }

  private render = () => {
    // OrbitControls uses radians per canvas height. Match the visible surface
    // scale using altitude above the unit sphere, not distance to its centre.
    const distance = this.camera.position.length();
    this.controls.rotateSpeed = (distance - 1) * Math.tan(this.camera.fov * radians / 2) / Math.PI;
    if (!this.active || this.disposed) return;
    // A unit surface point faces this perspective camera iff n·camera > 1.
    // Cull the entire billboard behind the tangent plane so even its halo can
    // never peek through from the far side. Depth testing a tangent billboard
    // would instead clip/distort the circle against the globe at oblique angles.
    this.pin.visible = this.hasSelection && this.pin.position.dot(this.camera.position) > 1;
    if (this.pin.visible) {
      const depth = distance - this.pin.position.dot(this.camera.position) / distance;
      this.pin.scale.setScalar(28 * depth / (this.renderer.domElement.clientHeight * this.camera.projectionMatrix.elements[5]));
    }
    this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    if (!this.active || this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  setVisible(visible: boolean) {
    if (this.disposed) return;
    if (this.active && !visible) {
      this.stopMotion();
      this.pointers.clear();
      // Recreate native controls to discard any in-progress pointer/pinch state,
      // not just their momentum, before this surface can be shown again.
      this.controls.removeEventListener('change', this.controlsChanged);
      this.controls.dispose();
      this.active = false;
      this.controls = this.createControls();
    }
    this.active = visible;
    this.controls.enabled = visible;
    if (visible) this.resize();
  }

  setSelection(point: Point | null, correct = true) {
    this.hasSelection = !!point;
    if (point) this.pin.position.copy(position(point));
    this.pin.material.color.set(correct ? '#d6ef87' : '#ea947b');
    this.render();
  }

  showAnswer(country?: Country, answer?: Answer) {
    if (country !== this.highlighted) {
      this.highlighted = country;
      this.paint();
      if (country) {
        const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
        const primary = polygons.reduce((largest, polygon) => polygonArea(polygon) > polygonArea(largest) ? polygon : largest);
        const center = new THREE.Vector3();
        for (const [longitude, latitude] of primary[0]) center.add(position({ longitude, latitude }));
        this.moveTo(center.normalize().multiplyScalar(3));
      }
    }
    this.setSelection(answer ?? null, answer?.correct);
  }

  zoom(factor: number) {
    if (this.disposed) return;
    this.orbitCamera.position.setLength(THREE.MathUtils.clamp(this.zoomTarget * factor, this.controls.minDistance, this.controls.maxDistance));
    this.controls.update();
    this.controlsChanged();
  }

  reset() {
    this.moveTo(position({ longitude: 0, latitude: 15 }, 3));
  }

  dispose() {
    if (this.disposed) return;
    this.stopMotion();
    this.disposed = true;
    this.observer.disconnect();
    this.pointers.clear();
    this.reducedMotion.removeEventListener('change', this.motionPreferenceChanged);
    this.controls.removeEventListener('change', this.controlsChanged);
    this.controls.dispose();
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.pinTexture.dispose();
    this.pin.material.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
