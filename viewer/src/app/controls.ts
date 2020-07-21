import {
  EventDispatcher,
  MOUSE,
  Quaternion,
  Spherical,
  TOUCH,
  Vector2,
  Vector3,
  PerspectiveCamera,
} from 'three';

class Controls extends EventDispatcher {
  enabled = true;
  target = new Vector3();
  minDistance = 0;
  maxDistance = Infinity;
  minZoom = 0;
  maxZoom = Infinity;
  minPolarAngle = 0;
  maxPolarAngle = Math.PI;
  minAzimuthAngle = -Infinity;
  maxAzimuthAngle = Infinity;
  enableDamping = false;
  dampingFactor = 0.05;
  enableZoom = true;
  zoomSpeed = 1.0;
  enableRotate = true;
  rotateSpeed = 1.0;
  enablePan = true;
  panSpeed = 1.0;
  screenSpacePanning = true;
  keyPanSpeed = 7.0;
  autoRotate = false;
  autoRotateSpeed = 2.0;
  enableKeys = true;
  keys = {LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40};
  grabbing = false;
  mouseButtons = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.PAN,
    RIGHT: MOUSE.PAN,
  };
  touches = {ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN};
  target0 = this.target.clone();
  position0 = this.object.position.clone();
  zoom0 = this.object.zoom;

  private changeEvent = {type: 'change'};
  private startEvent = {type: 'start'};
  private endEvent = {type: 'end'};
  private STATE = {
    NONE: -1,
    ROTATE: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
    TOUCH_PAN: 4,
    TOUCH_DOLLY_PAN: 5,
    TOUCH_DOLLY_ROTATE: 6,
  };
  private state = this.STATE.NONE;
  private EPS = 0.000001;
  private spherical = new Spherical();
  private sphericalDelta = new Spherical();
  private scale = 1;
  private panOffset = new Vector3();
  private zoomChanged = false;
  private rotateStart = new Vector2();
  private rotateEnd = new Vector2();
  private rotateDelta = new Vector2();
  private panStart = new Vector2();
  private panEnd = new Vector2();
  private panDelta = new Vector2();
  private dollyStart = new Vector2();
  private dollyEnd = new Vector2();
  private dollyDelta = new Vector2();

  constructor(private object: PerspectiveCamera, private domElement: HTMLElement) {
    super();

    this.domElement.addEventListener('contextmenu', e => this.onContextMenu(e), false);
    this.domElement.addEventListener('mousedown', e => this.onMouseDown(e), false);
    this.domElement.addEventListener('wheel', e => this.onMouseWheel(e), false);
    this.domElement.addEventListener('touchstart', e => this.onTouchStart(e), false);
    this.domElement.addEventListener('touchend', e => this.onTouchEnd(e), false);
    this.domElement.addEventListener('touchmove', e => this.onTouchMove(e), false);
    this.domElement.addEventListener('keydown', e => this.onKeyDown(e), false);

    if (this.domElement.tabIndex === -1) {
      this.domElement.tabIndex = 0;
    }

    this.update();
  }

  getPolarAngle() {
    return this.spherical.phi;
  }

  getAzimuthalAngle() {
    return this.spherical.theta;
  }

  saveState() {
    this.target0.copy(this.target);
    this.position0.copy(this.object.position);
    this.zoom0 = this.object.zoom;
  }

  reset() {
    this.target.copy(this.target0);
    this.object.position.copy(this.position0);
    this.object.zoom = this.zoom0;
    this.object.updateProjectionMatrix();
    this.dispatchEvent(this.changeEvent);
    this.update();
    this.state = this.STATE.NONE;
  }

  dispose() {
    this.domElement.removeEventListener('contextmenu', e => this.onContextMenu(e), false);
    this.domElement.removeEventListener('mousedown', e => this.onMouseDown(e), false);
    this.domElement.removeEventListener('wheel', e => this.onMouseWheel(e), false);
    this.domElement.removeEventListener('touchstart', e => this.onTouchStart(e), false);
    this.domElement.removeEventListener('touchend', e => this.onTouchEnd(e), false);
    this.domElement.removeEventListener('touchmove', e => this.onTouchMove(e), false);
    this.domElement.ownerDocument.removeEventListener('mousemove', e => this.onMouseMove(e), false);
    this.domElement.ownerDocument.removeEventListener('mouseup', e => this.onMouseUp(e), false);
    this.domElement.removeEventListener('keydown', e => this.onKeyDown(e), false);

    //this.dispatchEvent( { type: 'dispose' } ); // should this be added here?
  }

  update() {
    var offset = new Vector3();

    // so camera.up is the orbit axis
    var quat = new Quaternion().setFromUnitVectors(this.object.up, new Vector3(0, 1, 0));
    var quatInverse = quat.clone().inverse();
    var lastPosition = new Vector3();
    var lastQuaternion = new Quaternion();
    var twoPI = 2 * Math.PI;
    var position = this.object.position;
    offset.copy(position).sub(this.target);

    // rotate offset to "y-axis-is-up" space
    offset.applyQuaternion(quat);
    // angle from z-axis around y-axis
    this.spherical.setFromVector3(offset);
    if (this.autoRotate && this.state === this.STATE.NONE) {
      this.rotateLeft(this.getAutoRotationAngle());
    }

    if (this.enableDamping) {
      this.spherical.theta += this.sphericalDelta.theta * this.dampingFactor;
      this.spherical.phi += this.sphericalDelta.phi * this.dampingFactor;
    } else {
      this.spherical.theta += this.sphericalDelta.theta;
      this.spherical.phi += this.sphericalDelta.phi;
    }

    // restrict theta to be between desired limits

    var min = this.minAzimuthAngle;
    var max = this.maxAzimuthAngle;

    if (isFinite(min) && isFinite(max)) {
      if (min < -Math.PI) min += twoPI;
      else if (min > Math.PI) min -= twoPI;
      if (max < -Math.PI) max += twoPI;
      else if (max > Math.PI) max -= twoPI;
      if (min < max) {
        this.spherical.theta = Math.max(min, Math.min(max, this.spherical.theta));
      } else {
        this.spherical.theta =
          this.spherical.theta > (min + max) / 2
            ? Math.max(min, this.spherical.theta)
            : Math.min(max, this.spherical.theta);
      }
    }

    // restrict phi to be between desired limits
    this.spherical.phi = Math.max(
      this.minPolarAngle,
      Math.min(this.maxPolarAngle, this.spherical.phi),
    );
    this.spherical.makeSafe();
    this.spherical.radius *= this.scale;

    // restrict radius to be between desired limits
    this.spherical.radius = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.spherical.radius),
    );

    // move target to panned location

    if (this.enableDamping === true) {
      this.target.addScaledVector(this.panOffset, this.dampingFactor);
    } else {
      this.target.add(this.panOffset);
    }
    offset.setFromSpherical(this.spherical);

    // rotate offset back to "camera-up-vector-is-up" space
    offset.applyQuaternion(quatInverse);
    position.copy(this.target).add(offset);
    this.object.lookAt(this.target);

    if (this.enableDamping === true) {
      this.sphericalDelta.theta *= 1 - this.dampingFactor;
      this.sphericalDelta.phi *= 1 - this.dampingFactor;
      this.panOffset.multiplyScalar(1 - this.dampingFactor);
    } else {
      this.sphericalDelta.set(0, 0, 0);
      this.panOffset.set(0, 0, 0);
    }

    this.scale = 1;

    // update condition is:
    // min(camera displacement, camera rotation in radians)^2 > EPS
    // using small-angle approximation cos(x/2) = 1 - x^2 / 8

    if (
      this.zoomChanged ||
      lastPosition.distanceToSquared(this.object.position) > this.EPS ||
      8 * (1 - lastQuaternion.dot(this.object.quaternion)) > this.EPS
    ) {
      this.dispatchEvent(this.changeEvent);
      lastPosition.copy(this.object.position);
      lastQuaternion.copy(this.object.quaternion);
      this.zoomChanged = false;
      return true;
    }

    return false;
  }

  private getAutoRotationAngle() {
    return ((2 * Math.PI) / 60 / 60) * this.autoRotateSpeed;
  }

  private getZoomScale() {
    return Math.pow(0.95, this.zoomSpeed);
  }

  private rotateLeft(angle) {
    this.sphericalDelta.theta -= angle;
  }

  private rotateUp(angle) {
    this.sphericalDelta.phi -= angle;
  }

  private panLeft(distance, objectMatrix) {
    var v = new Vector3();
    v.setFromMatrixColumn(objectMatrix, 0); // get X column of objectMatrix
    v.multiplyScalar(-distance);
    this.panOffset.add(v);
    return function panLeft() {};
  }

  private panUp(distance, objectMatrix) {
    var v = new Vector3();
    if (this.screenSpacePanning === true) {
      v.setFromMatrixColumn(objectMatrix, 1);
    } else {
      v.setFromMatrixColumn(objectMatrix, 0);
      v.crossVectors(this.object.up, v);
    }
    v.multiplyScalar(distance);
    this.panOffset.add(v);
  }

  // deltaX and deltaY are in pixels; right and down are positive
  private pan(deltaX, deltaY) {
    var offset = new Vector3();
    var element = this.domElement;
    if (this.object.isPerspectiveCamera) {
      // perspective
      var position = this.object.position;
      offset.copy(position).sub(this.target);
      var targetDistance = offset.length();

      // half of the fov is center to top of screen
      targetDistance *= Math.tan(((this.object.fov / 2) * Math.PI) / 180.0);

      // we use only clientHeight here so aspect ratio does not distort speed
      this.panLeft((2 * deltaX * targetDistance) / element.clientHeight, this.object.matrix);
      this.panUp((2 * deltaY * targetDistance) / element.clientHeight, this.object.matrix);
    } else if ((this.object as any).isOrthographicCamera) {
      // orthographic
      this.panLeft(
        (deltaX * ((this.object as any).right - (this.object as any).left)) /
          this.object.zoom /
          element.clientWidth,
        this.object.matrix,
      );
      this.panUp(
        (deltaY * ((this.object as any).top - (this.object as any).bottom)) /
          this.object.zoom /
          element.clientHeight,
        this.object.matrix,
      );
    } else {
      // camera neither orthographic nor perspective
      console.warn('WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.');
      this.enablePan = false;
    }
  }

  private dollyOut(dollyScale) {
    if (this.object.isPerspectiveCamera) {
      this.scale /= dollyScale;
    } else if ((this.object as any).isOrthographicCamera) {
      this.object.zoom = Math.max(
        this.minZoom,
        Math.min(this.maxZoom, this.object.zoom * dollyScale),
      );
      this.object.updateProjectionMatrix();
      this.zoomChanged = true;
    } else {
      console.warn(
        'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.',
      );
      this.enableZoom = false;
    }
  }

  /* private */ dollyIn(dollyScale) {
    if (this.object.isPerspectiveCamera) {
      this.scale *= dollyScale;
    } else if ((this.object as any).isOrthographicCamera) {
      this.object.zoom = Math.max(
        this.minZoom,
        Math.min(this.maxZoom, this.object.zoom / dollyScale),
      );
      this.object.updateProjectionMatrix();
      this.zoomChanged = true;
    } else {
      console.warn(
        'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.',
      );
      this.enableZoom = false;
    }
  }

  private handleMouseDownRotate(event) {
    this.rotateStart.set(event.clientX, event.clientY);
  }

  private handleMouseDownDolly(event) {
    this.dollyStart.set(event.clientX, event.clientY);
  }

  private handleMouseDownPan(event) {
    this.panStart.set(event.clientX, event.clientY);
  }

  private handleMouseMoveRotate(event) {
    this.rotateEnd.set(event.clientX, event.clientY);
    this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart).multiplyScalar(this.rotateSpeed);
    var element = this.domElement;
    this.rotateLeft((2 * Math.PI * this.rotateDelta.x) / element.clientHeight); // yes, height
    this.rotateUp((2 * Math.PI * this.rotateDelta.y) / element.clientHeight);
    this.rotateStart.copy(this.rotateEnd);
    this.update();
  }

  private handleMouseMoveDolly(event) {
    this.dollyEnd.set(event.clientX, event.clientY);

    this.dollyDelta.subVectors(this.dollyEnd, this.dollyStart);

    if (this.dollyDelta.y > 0) {
      this.dollyOut(this.getZoomScale());
    } else if (this.dollyDelta.y < 0) {
      this.dollyIn(this.getZoomScale());
    }

    this.dollyStart.copy(this.dollyEnd);

    this.update();
  }

  private handleMouseMovePan(event) {
    this.panEnd.set(event.clientX, event.clientY);
    this.panDelta.subVectors(this.panEnd, this.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.panDelta.x, this.panDelta.y);
    this.panStart.copy(this.panEnd);
    this.update();
  }

  private handleMouseUp() {
    this.grabbing = false;
  }

  private handleMouseWheel(event) {
    if (event.deltaY < 0) {
      this.dollyIn(this.getZoomScale());
    } else if (event.deltaY > 0) {
      this.dollyOut(this.getZoomScale());
    }

    this.update();
  }

  private handleKeyDown(event) {
    var needsUpdate = false;

    switch (event.keyCode) {
      case this.keys.UP:
        this.pan(0, this.keyPanSpeed);
        needsUpdate = true;
        break;

      case this.keys.BOTTOM:
        this.pan(0, -this.keyPanSpeed);
        needsUpdate = true;
        break;

      case this.keys.LEFT:
        this.pan(this.keyPanSpeed, 0);
        needsUpdate = true;
        break;

      case this.keys.RIGHT:
        this.pan(-this.keyPanSpeed, 0);
        needsUpdate = true;
        break;
    }

    if (needsUpdate) {
      // prevent the browser from scrolling on cursor keys
      event.preventDefault();
      this.update();
    }
  }

  private handleTouchStartRotate(event) {
    if (event.touches.length == 1) {
      this.rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
    } else {
      var x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
      var y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
      this.rotateStart.set(x, y);
    }
  }

  private handleTouchStartPan(event) {
    if (event.touches.length == 1) {
      this.panStart.set(event.touches[0].pageX, event.touches[0].pageY);
    } else {
      var x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
      var y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
      this.panStart.set(x, y);
    }
  }

  private handleTouchStartDolly(event) {
    var dx = event.touches[0].pageX - event.touches[1].pageX;
    var dy = event.touches[0].pageY - event.touches[1].pageY;
    var distance = Math.sqrt(dx * dx + dy * dy);
    this.dollyStart.set(0, distance);
  }

  private handleTouchStartDollyPan(event) {
    if (this.enableZoom) this.handleTouchStartDolly(event);
    if (this.enablePan) this.handleTouchStartPan(event);
  }

  private handleTouchStartDollyRotate(event) {
    if (this.enableZoom) this.handleTouchStartDolly(event);
    if (this.enableRotate) this.handleTouchStartRotate(event);
  }

  private handleTouchMoveRotate(event) {
    if (event.touches.length == 1) {
      this.rotateEnd.set(event.touches[0].pageX, event.touches[0].pageY);
    } else {
      var x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
      var y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
      this.rotateEnd.set(x, y);
    }

    this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart).multiplyScalar(this.rotateSpeed);
    var element = this.domElement;
    this.rotateLeft((2 * Math.PI * this.rotateDelta.x) / element.clientHeight); // yes, height
    this.rotateUp((2 * Math.PI * this.rotateDelta.y) / element.clientHeight);
    this.rotateStart.copy(this.rotateEnd);
  }

  private handleTouchMovePan(event) {
    if (event.touches.length == 1) {
      this.panEnd.set(event.touches[0].pageX, event.touches[0].pageY);
    } else {
      var x = 0.5 * (event.touches[0].pageX + event.touches[1].pageX);
      var y = 0.5 * (event.touches[0].pageY + event.touches[1].pageY);
      this.panEnd.set(x, y);
    }

    this.panDelta.subVectors(this.panEnd, this.panStart).multiplyScalar(this.panSpeed);
    this.pan(this.panDelta.x, this.panDelta.y);
    this.panStart.copy(this.panEnd);
  }

  private handleTouchMoveDolly(event) {
    var dx = event.touches[0].pageX - event.touches[1].pageX;
    var dy = event.touches[0].pageY - event.touches[1].pageY;
    var distance = Math.sqrt(dx * dx + dy * dy);
    this.dollyEnd.set(0, distance);
    this.dollyDelta.set(0, Math.pow(this.dollyEnd.y / this.dollyStart.y, this.zoomSpeed));
    this.dollyOut(this.dollyDelta.y);
    this.dollyStart.copy(this.dollyEnd);
  }

  private handleTouchMoveDollyPan(event) {
    if (this.enableZoom) this.handleTouchMoveDolly(event);
    if (this.enablePan) this.handleTouchMovePan(event);
  }

  private handleTouchMoveDollyRotate(event) {
    if (this.enableZoom) this.handleTouchMoveDolly(event);
    if (this.enableRotate) this.handleTouchMoveRotate(event);
  }

  private handleTouchEnd() {}

  private onMouseDown(event) {
    if (this.enabled === false) return;

    // Prevent the browser from scrolling.
    event.preventDefault();

    // Manually set the focus since calling preventDefault above
    // prevents the browser from setting it automatically.
    this.domElement.focus ? this.domElement.focus() : window.focus();
    this.grabbing = true;
    var mouseAction;

    switch (event.button) {
      case 0:
        mouseAction = this.mouseButtons.LEFT;
        break;

      case 1:
        mouseAction = this.mouseButtons.MIDDLE;
        break;

      case 2:
        mouseAction = this.mouseButtons.RIGHT;
        break;

      default:
        mouseAction = -1;
    }

    switch (mouseAction) {
      case MOUSE.DOLLY:
        if (this.enableZoom === false) return;
        this.handleMouseDownDolly(event);
        this.state = this.STATE.DOLLY;
        break;

      case MOUSE.ROTATE:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (this.enablePan === false) return;
          this.handleMouseDownPan(event);
          this.state = this.STATE.PAN;
        } else {
          if (this.enableRotate === false) return;
          this.handleMouseDownRotate(event);
          this.state = this.STATE.ROTATE;
        }

        break;

      case MOUSE.PAN:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (this.enableRotate === false) return;
          this.handleMouseDownRotate(event);
          this.state = this.STATE.ROTATE;
        } else {
          if (this.enablePan === false) return;
          this.handleMouseDownPan(event);
          this.state = this.STATE.PAN;
        }

        break;

      default:
        this.state = this.STATE.NONE;
    }

    if (this.state !== this.STATE.NONE) {
      this.domElement.ownerDocument.addEventListener('mousemove', e => this.onMouseMove(e), false);
      this.domElement.ownerDocument.addEventListener('mouseup', e => this.onMouseUp(e), false);
      this.dispatchEvent(this.startEvent);
    }
  }

  private onMouseMove(event) {
    if (this.enabled === false) return;

    event.preventDefault();

    switch (this.state) {
      case this.STATE.ROTATE:
        if (this.enableRotate === false) return;
        this.handleMouseMoveRotate(event);
        break;

      case this.STATE.DOLLY:
        if (this.enableZoom === false) return;
        this.handleMouseMoveDolly(event);
        break;

      case this.STATE.PAN:
        if (this.enablePan === false) return;
        this.handleMouseMovePan(event);
        break;
    }
  }

  private onMouseUp(event) {
    if (this.enabled === false) return;
    this.handleMouseUp();
    this.domElement.ownerDocument.removeEventListener('mousemove', e => this.onMouseMove(e), false);
    this.domElement.ownerDocument.removeEventListener('mouseup', e => this.onMouseUp(e), false);
    this.dispatchEvent(this.endEvent);
    this.state = this.STATE.NONE;
  }

  private onMouseWheel(event) {
    if (
      this.enabled === false ||
      this.enableZoom === false ||
      (this.state !== this.STATE.NONE && this.state !== this.STATE.ROTATE)
    )
      return;

    event.preventDefault();
    event.stopPropagation();

    this.dispatchEvent(this.startEvent);
    this.handleMouseWheel(event);
    this.dispatchEvent(this.endEvent);
  }

  private onKeyDown(event) {
    if (this.enabled === false || this.enableKeys === false || this.enablePan === false) return;
    this.handleKeyDown(event);
  }

  private onTouchStart(event) {
    if (this.enabled === false) return;

    event.preventDefault(); // prevent scrolling

    switch (event.touches.length) {
      case 1:
        switch (this.touches.ONE) {
          case TOUCH.ROTATE:
            if (this.enableRotate === false) return;
            this.handleTouchStartRotate(event);
            this.state = this.STATE.TOUCH_ROTATE;
            break;
          case TOUCH.PAN:
            if (this.enablePan === false) return;
            this.handleTouchStartPan(event);
            this.state = this.STATE.TOUCH_PAN;
            break;
          default:
            this.state = this.STATE.NONE;
        }

        break;

      case 2:
        switch (this.touches.TWO) {
          case TOUCH.DOLLY_PAN:
            if (this.enableZoom === false && this.enablePan === false) return;
            this.handleTouchStartDollyPan(event);
            this.state = this.STATE.TOUCH_DOLLY_PAN;
            break;
          case TOUCH.DOLLY_ROTATE:
            if (this.enableZoom === false && this.enableRotate === false) return;
            this.handleTouchStartDollyRotate(event);
            this.state = this.STATE.TOUCH_DOLLY_ROTATE;
            break;
          default:
            this.state = this.STATE.NONE;
        }
        break;

      default:
        this.state = this.STATE.NONE;
    }

    if (this.state !== this.STATE.NONE) {
      this.dispatchEvent(this.startEvent);
    }
  }

  private onTouchMove(event) {
    if (this.enabled === false) return;

    event.preventDefault(); // prevent scrolling
    event.stopPropagation();

    switch (this.state) {
      case this.STATE.TOUCH_ROTATE:
        if (this.enableRotate === false) return;
        this.handleTouchMoveRotate(event);
        this.update();
        break;
      case this.STATE.TOUCH_PAN:
        if (this.enablePan === false) return;
        this.handleTouchMovePan(event);
        this.update();
        break;
      case this.STATE.TOUCH_DOLLY_PAN:
        if (this.enableZoom === false && this.enablePan === false) return;
        this.handleTouchMoveDollyPan(event);
        this.update();
        break;
      case this.STATE.TOUCH_DOLLY_ROTATE:
        if (this.enableZoom === false && this.enableRotate === false) return;
        this.handleTouchMoveDollyRotate(event);
        this.update();
        break;
      default:
        this.state = this.STATE.NONE;
    }
  }

  private onTouchEnd(event) {
    if (this.enabled === false) return;
    this.handleTouchEnd();
    this.dispatchEvent(this.endEvent);
    this.state = this.STATE.NONE;
  }

  private onContextMenu(event) {
    if (this.enabled === false) return;
    event.preventDefault();
  }
}

export {Controls as OrbitControls};
