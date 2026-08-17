import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PointerEventHandler, RefObject } from "react";

type SheetAxis = "x" | "y" | "responsive";
type ResolvedSheetAxis = Exclude<SheetAxis, "responsive">;
type CloseIntent = "external" | "request";

type DragState = {
  inheritedVelocity: number;
  moved: boolean;
  pointerId: number;
  samples: Array<{ position: number; time: number }>;
  startCoordinate: number;
  startValue: number;
  target: HTMLElement;
};

type FluidSheetOptions = {
  axis?: SheetAxis;
  dragToDismiss?: boolean;
  onDismiss: () => void;
  open: boolean;
};

type FluidSheetResult<T extends HTMLElement> = {
  dragHandleProps: {
    onLostPointerCapture: PointerEventHandler<HTMLElement>;
    onPointerCancel: PointerEventHandler<HTMLElement>;
    onPointerDown: PointerEventHandler<HTMLElement>;
    onPointerMove: PointerEventHandler<HTMLElement>;
    onPointerUp: PointerEventHandler<HTMLElement>;
  };
  layerRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<T | null>;
  present: boolean;
  requestClose: () => void;
};

const SPRING_RESPONSE = 0.34;
const SPRING_DAMPING = 0.86;
const EXIT_PADDING = 24;
const REDUCED_MOTION_DURATION = 140;
const VELOCITY_WINDOW = 100;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function project(velocity: number, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * 为抽屉提供与手指 1:1 的拖动、速度接力和可中断的弹簧归位。
 * 动画值直接写入 transform，避免触发布局与 React 高频渲染。
 */
export function useFluidSheet<T extends HTMLElement>({
  axis = "y",
  dragToDismiss = true,
  onDismiss,
  open,
}: FluidSheetOptions): FluidSheetResult<T> {
  const [present, setPresent] = useState(open);
  const panelRef = useRef<T | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const entryFrameRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const closingRef = useRef(false);
  const closeIntentRef = useRef<CloseIntent | null>(null);
  const closeSequenceRef = useRef(0);
  const initializedRef = useRef(false);
  const axisRef = useRef<ResolvedSheetAxis>("y");
  const sizeRef = useRef(1);
  const valueRef = useRef(0);
  const velocityRef = useRef(0);
  const reducedMotionRef = useRef(prefersReducedMotion());
  const openRef = useRef(open);
  const presentRef = useRef(present);
  const onDismissRef = useRef(onDismiss);
  openRef.current = open;
  presentRef.current = present;
  onDismissRef.current = onDismiss;

  const resolveAxis = useCallback((): ResolvedSheetAxis => {
    if (axis !== "responsive") return axis;
    return window.matchMedia("(min-width: 1024px)").matches ? "x" : "y";
  }, [axis]);

  const measure = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return sizeRef.current;
    const rect = panel.getBoundingClientRect();
    sizeRef.current = Math.max(axisRef.current === "x" ? rect.width : rect.height, 1);
    return sizeRef.current;
  }, []);

  const setDragging = useCallback((dragging: boolean) => {
    const targets = [layerRef.current, panelRef.current];
    targets.forEach((target) => {
      if (dragging) target?.setAttribute("data-dragging", "true");
      else target?.removeAttribute("data-dragging");
    });
  }, []);

  const syncReducedMotionData = useCallback(() => {
    const reduced = prefersReducedMotion();
    reducedMotionRef.current = reduced;
    layerRef.current?.setAttribute("data-reduced-motion", String(reduced));
    return reduced;
  }, []);

  const setValue = useCallback((nextValue: number) => {
    valueRef.current = nextValue;
    const panel = panelRef.current;
    if (panel) {
      panel.style.transform = axisRef.current === "x"
        ? `translate3d(${nextValue}px, 0, 0)`
        : `translate3d(0, ${nextValue}px, 0)`;
    }

    // 负向橡皮筋过冲仍然是完全打开，而不是因为 abs() 短暂变暗。
    const dismissDistance = Math.max(0, nextValue);
    const progress = Math.max(0, Math.min(1, 1 - dismissDistance / Math.max(sizeRef.current, 1)));
    layerRef.current?.style.setProperty("--sheet-progress", progress.toFixed(4));
  }, []);

  const readPresentationValue = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return valueRef.current;
    const transform = window.getComputedStyle(panel).transform;
    if (!transform || transform === "none") return valueRef.current;
    try {
      const matrix = new DOMMatrixReadOnly(transform);
      return axisRef.current === "x" ? matrix.m41 : matrix.m42;
    } catch {
      return valueRef.current;
    }
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const cancelEntryFrame = useCallback(() => {
    if (entryFrameRef.current !== null) {
      window.cancelAnimationFrame(entryFrameRef.current);
      entryFrameRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const animateSpring = useCallback((target: number, initialVelocity: number, onComplete?: () => void) => {
    cancelAnimation();
    velocityRef.current = initialVelocity;
    if (reducedMotionRef.current) {
      velocityRef.current = 0;
      setValue(target);
      onComplete?.();
      return;
    }

    const omega = (2 * Math.PI) / SPRING_RESPONSE;
    const stiffness = omega * omega;
    const damping = 2 * SPRING_DAMPING * omega;
    let position = readPresentationValue();
    let velocity = initialVelocity;
    let previousTime = performance.now();

    const frame = (time: number) => {
      const delta = Math.min((time - previousTime) / 1000, 0.032);
      previousTime = time;
      const acceleration = -stiffness * (position - target) - damping * velocity;
      velocity += acceleration * delta;
      position += velocity * delta;
      velocityRef.current = velocity;
      setValue(position);

      if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 8) {
        velocityRef.current = 0;
        setValue(target);
        animationFrameRef.current = null;
        onComplete?.();
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(frame);
    };

    animationFrameRef.current = window.requestAnimationFrame(frame);
  }, [cancelAnimation, readPresentationValue, setValue]);

  const calculateDragVelocity = useCallback((drag: DragState, time: number, position?: number) => {
    const lastPosition = position ?? drag.samples[drag.samples.length - 1]?.position ?? drag.startCoordinate;
    const samples = [...drag.samples, { position: lastPosition, time }]
      .filter((sample) => time - sample.time <= VELOCITY_WINDOW)
      .slice(-7);
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = (last.time - first.time) / 1000;
    return elapsed > 0 ? (last.position - first.position) / elapsed : 0;
  }, []);

  const detachDrag = useCallback((cancelled: boolean, position?: number) => {
    const drag = dragRef.current;
    if (!drag) return velocityRef.current;
    const finalPosition = position ?? drag.samples[drag.samples.length - 1]?.position ?? drag.startCoordinate;
    const moved = drag.moved || Math.abs(finalPosition - drag.startCoordinate) > 0.5;
    const velocity = cancelled
      ? 0
      : moved
        ? calculateDragVelocity(drag, performance.now(), finalPosition)
        : drag.inheritedVelocity;
    dragRef.current = null;
    velocityRef.current = velocity;
    setDragging(false);
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId);
    }
    return velocity;
  }, [calculateDragVelocity, setDragging]);

  const finishClose = useCallback((sequence: number) => {
    if (sequence !== closeSequenceRef.current) return;
    clearCloseTimer();
    cancelAnimation();
    const intent = closeIntentRef.current;
    closingRef.current = false;
    closeIntentRef.current = null;
    initializedRef.current = false;
    velocityRef.current = 0;
    setDragging(false);
    presentRef.current = false;
    setPresent(false);
    if (intent === "request") onDismissRef.current();
  }, [cancelAnimation, clearCloseTimer, setDragging]);

  const beginClose = useCallback((intent: CloseIntent, initialVelocity = velocityRef.current) => {
    if (!presentRef.current) return;
    if (closingRef.current) {
      // 父组件在手势/按钮关闭途中收回 open 时，改由外部状态拥有这次关闭。
      if (intent === "external") closeIntentRef.current = "external";
      return;
    }

    closingRef.current = true;
    closeIntentRef.current = intent;
    const sequence = closeSequenceRef.current + 1;
    closeSequenceRef.current = sequence;
    cancelEntryFrame();
    clearCloseTimer();
    measure();

    if (syncReducedMotionData()) {
      cancelAnimation();
      velocityRef.current = 0;
      layerRef.current?.style.setProperty("--sheet-progress", "0");
      closeTimerRef.current = window.setTimeout(() => finishClose(sequence), REDUCED_MOTION_DURATION);
      return;
    }
    animateSpring(sizeRef.current + EXIT_PADDING, initialVelocity, () => finishClose(sequence));
  }, [animateSpring, cancelAnimation, cancelEntryFrame, clearCloseTimer, finishClose, measure, syncReducedMotionData]);

  const interruptClose = useCallback(() => {
    const position = readPresentationValue();
    const velocity = velocityRef.current;
    closeSequenceRef.current += 1;
    cancelEntryFrame();
    clearCloseTimer();
    cancelAnimation();
    closingRef.current = false;
    closeIntentRef.current = null;
    setValue(position);
    return velocity;
  }, [cancelAnimation, cancelEntryFrame, clearCloseTimer, readPresentationValue, setValue]);

  const requestClose = useCallback(() => {
    if (!presentRef.current || closingRef.current) return;
    const inheritedVelocity = detachDrag(false);
    beginClose("request", inheritedVelocity);
  }, [beginClose, detachDrag]);

  useLayoutEffect(() => {
    if (open) {
      if (!present) {
        presentRef.current = true;
        setPresent(true);
      } else if (initializedRef.current && closingRef.current) {
        const inheritedVelocity = interruptClose();
        animateSpring(0, inheritedVelocity);
      }
      return;
    }

    if (!present || !initializedRef.current) return;
    const inheritedVelocity = detachDrag(false);
    beginClose("external", inheritedVelocity);
  }, [animateSpring, beginClose, detachDrag, interruptClose, open, present]);

  useLayoutEffect(() => {
    if (!present || !panelRef.current) return undefined;
    initializedRef.current = true;
    closingRef.current = false;
    closeIntentRef.current = null;
    axisRef.current = resolveAxis();
    panelRef.current.dataset.axis = axisRef.current;
    setDragging(false);
    const size = measure();

    if (syncReducedMotionData()) {
      velocityRef.current = 0;
      setValue(0);
      layerRef.current?.style.setProperty("--sheet-progress", "0");
      entryFrameRef.current = window.requestAnimationFrame(() => {
        entryFrameRef.current = null;
        if (closingRef.current || !openRef.current) return;
        layerRef.current?.style.setProperty("--sheet-progress", "1");
      });
      return cancelEntryFrame;
    }

    velocityRef.current = 0;
    setValue(size + EXIT_PADDING);
    entryFrameRef.current = window.requestAnimationFrame(() => {
      entryFrameRef.current = null;
      if (closingRef.current || !openRef.current) return;
      animateSpring(0, 0);
    });
    return cancelEntryFrame;
  }, [animateSpring, cancelEntryFrame, measure, present, resolveAxis, setDragging, setValue, syncReducedMotionData]);

  useLayoutEffect(() => {
    if (!present) return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reducedMotionRef.current = media.matches;
      layerRef.current?.setAttribute("data-reduced-motion", String(media.matches));
    };
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, [present]);

  useLayoutEffect(() => {
    if (!present || axis !== "responsive") return undefined;
    const media = window.matchMedia("(min-width: 1024px)");
    const updateAxis = () => {
      const nextAxis: ResolvedSheetAxis = media.matches ? "x" : "y";
      if (nextAxis === axisRef.current || !panelRef.current) return;

      const previousSize = Math.max(sizeRef.current, 1);
      const previousValue = readPresentationValue();
      const inheritedVelocity = detachDrag(false);
      const wasClosing = closingRef.current;
      const closeSequence = closeSequenceRef.current;
      cancelEntryFrame();
      cancelAnimation();

      axisRef.current = nextAxis;
      panelRef.current.dataset.axis = nextAxis;
      const nextSize = measure();
      const scale = nextSize / previousSize;
      const nextValue = previousValue * scale;
      const nextVelocity = inheritedVelocity * scale;
      velocityRef.current = nextVelocity;
      setValue(nextValue);

      if (wasClosing) {
        if (reducedMotionRef.current) {
          layerRef.current?.style.setProperty("--sheet-progress", "0");
        } else {
          animateSpring(nextSize + EXIT_PADDING, nextVelocity, () => finishClose(closeSequence));
        }
      } else if (openRef.current) {
        animateSpring(0, nextVelocity);
      } else {
        beginClose("external", nextVelocity);
      }
    };

    media.addEventListener("change", updateAxis);
    return () => media.removeEventListener("change", updateAxis);
  }, [animateSpring, axis, beginClose, cancelAnimation, cancelEntryFrame, detachDrag, finishClose, measure, present, readPresentationValue, setValue]);

  useLayoutEffect(() => () => {
    closeSequenceRef.current += 1;
    cancelAnimation();
    cancelEntryFrame();
    clearCloseTimer();
    setDragging(false);
  }, [cancelAnimation, cancelEntryFrame, clearCloseTimer, setDragging]);

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (!dragToDismiss || axisRef.current !== "y" || event.button !== 0 || !openRef.current || !presentRef.current) return;
    const panel = panelRef.current;
    if (!panel) return;

    const inheritedVelocity = closingRef.current ? interruptClose() : velocityRef.current;
    const startValue = readPresentationValue();
    cancelEntryFrame();
    cancelAnimation();
    measure();
    valueRef.current = startValue;
    velocityRef.current = inheritedVelocity;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      inheritedVelocity,
      moved: false,
      pointerId: event.pointerId,
      samples: [{ position: event.clientY, time: performance.now() }],
      startCoordinate: event.clientY,
      startValue,
      target: event.currentTarget,
    };
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startCoordinate;
    const rawValue = drag.startValue + delta;
    setValue(rawValue < 0 ? rubberband(rawValue, sizeRef.current) : rawValue);

    const now = performance.now();
    const previousSample = drag.samples[drag.samples.length - 1];
    const elapsed = previousSample ? (now - previousSample.time) / 1000 : 0;
    if (elapsed > 0) velocityRef.current = (event.clientY - previousSample.position) / elapsed;
    drag.moved ||= Math.abs(delta) > 0.5;
    drag.samples.push({ position: event.clientY, time: now });
    drag.samples = drag.samples.filter((sample) => now - sample.time <= VELOCITY_WINDOW).slice(-6);
  };

  const finishDrag = useCallback((pointerId: number, cancelled: boolean, position?: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const velocity = detachDrag(cancelled, position);
    const current = readPresentationValue();

    if (!openRef.current) {
      beginClose("external", velocity);
      return;
    }

    const projected = current + project(velocity);
    const shouldDismiss = !cancelled && (projected > sizeRef.current * 0.42 || velocity > 820);
    if (shouldDismiss) beginClose("request", velocity);
    else animateSpring(0, cancelled ? 0 : velocity);
  }, [animateSpring, beginClose, detachDrag, readPresentationValue]);

  return {
    dragHandleProps: {
      onLostPointerCapture: (event) => finishDrag(event.pointerId, false, event.clientY),
      onPointerCancel: (event) => finishDrag(event.pointerId, true, event.clientY),
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => finishDrag(event.pointerId, false, event.clientY),
    },
    layerRef,
    panelRef,
    present,
    requestClose,
  };
}
