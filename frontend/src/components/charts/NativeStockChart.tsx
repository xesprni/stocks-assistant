import { EDGE_LOAD_THRESHOLD, MIN_VISIBLE_BARS, TOUCH_CROSSHAIR_HAPTIC_MIN_INTERVAL_MS, TOUCH_CROSSHAIR_HAPTIC_MS, TOUCH_LONG_PRESS_MS, TOUCH_PAN_THRESHOLD_PX } from "@/components/charts/native/constants";
import { drawChart } from "@/components/charts/native/drawing";
import { cacheSeries, clamp, createXMapper, midpoint, normalizeViewport, paddedBounds, panDeltaBars, pointDistance, viewportCount, visiblePaneRange } from "@/components/charts/native/geometry";
import { type ChartPoint, type NativeChartTooltipState, type NativeChartViewport, type NativeCrosshairState, type NativeStockChartProps, type PaneLayout, type PinchState, type PointerPanMode } from "@/components/charts/native/types";
import type { CSSProperties, PointerEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export function NativeStockChart({
  times,
  panes,
  series,
  theme,
  fitKey,
  primaryRangeSeriesId,
  onVisibleRangeChange,
  onNearStart,
  onNearEnd,
  formatCrosshairValueLabel,
  renderTooltip,
  enableTouchCrosshairHaptics = false,
  className,
}: NativeStockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const viewportRef = useRef<NativeChartViewport>({ from: 0, to: 0 });
  const crosshairRef = useRef<(NativeCrosshairState & { y: number }) | null>(null);
  const dragRef = useRef<{ panMode: PointerPanMode; pointerType: string; startX: number; startY: number; startViewport: NativeChartViewport } | null>(null);
  const activePointersRef = useRef<Map<number, ChartPoint>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const inspectPointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const layoutsRef = useRef<PaneLayout[]>([]);
  const lastDataRef = useRef<{ fitKey?: string | number; length: number; first?: number; last?: number }>({ length: 0 });
  const lastVisibleSignatureRef = useRef("");
  const nearStartLengthRef = useRef<number | null>(null);
  const nearEndLengthRef = useRef<number | null>(null);
  const lastHapticCrosshairIndexRef = useRef<number | null>(null);
  const lastHapticAtRef = useRef(0);
  const edgeLoadingEnabledRef = useRef(false);
  const callbacksRef = useRef({ onVisibleRangeChange, onNearStart, onNearEnd });
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => { });
  const [tooltipState, setTooltipState] = useState<NativeChartTooltipState | null>(null);

  const cachedSeries = useMemo(() => cacheSeries(times, series), [times, series]);
  const dataRef = useRef({ times, panes, series: cachedSeries, theme, primaryRangeSeriesId });

  function clearLongPressTimer() {
    if (longPressTimerRef.current == null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function startTouchInspectTimer(pointerId: number, point: ChartPoint) {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      if (!activePointersRef.current.has(pointerId) || activePointersRef.current.size !== 1) return;
      inspectPointerIdRef.current = pointerId;
      dragRef.current = null;
      lastHapticCrosshairIndexRef.current = null;
      updateCrosshair(point.x, point.y, { haptic: true });
      scheduleDraw();
    }, TOUCH_LONG_PRESS_MS);
  }

  useEffect(() => {
    return () => clearLongPressTimer();
  }, []);

  useLayoutEffect(() => {
    dataRef.current = { times, panes, series: cachedSeries, theme, primaryRangeSeriesId };
  }, [cachedSeries, panes, primaryRangeSeriesId, theme, times]);

  useEffect(() => {
    callbacksRef.current = { onVisibleRangeChange, onNearStart, onNearEnd };
  }, [onNearEnd, onNearStart, onVisibleRangeChange]);

  const scheduleDraw = () => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = sizeRef.current;
      const current = dataRef.current;
      layoutsRef.current = drawChart(
        ctx,
        width,
        height,
        current.times,
        current.panes,
        current.series,
        current.theme,
        viewportRef.current,
        crosshairRef.current,
        formatCrosshairValueLabel,
      );
    });
  };

  const emitVisibleRange = () => {
    const callback = callbacksRef.current.onVisibleRangeChange;
    const current = dataRef.current;
    if (!callback || current.times.length === 0) {
      callback?.(null);
      return;
    }
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    viewportRef.current = viewport;
    const from = clamp(Math.floor(viewport.from), 0, current.times.length - 1);
    const to = clamp(Math.ceil(viewport.to), 0, current.times.length - 1);
    const primary = current.series.find((item) => item.id === current.primaryRangeSeriesId);
    const primaryPane = primary
      ? current.panes.find((pane) => pane.id === primary.paneId) ?? { id: primary.paneId, heightWeight: 1 }
      : null;
    const price = primaryPane ? visiblePaneRange(current.series, primaryPane, from, to) : null;
    const signature = `${from}:${to}:${price?.min.toFixed(6) ?? "na"}:${price?.max.toFixed(6) ?? "na"}`;
    if (signature !== lastVisibleSignatureRef.current) {
      lastVisibleSignatureRef.current = signature;
      callback({
        logical: viewport,
        time: { from: current.times[from], to: current.times[to] },
        price,
      });
    }
    if (!edgeLoadingEnabledRef.current) return;

    if (viewport.from <= EDGE_LOAD_THRESHOLD && nearStartLengthRef.current !== current.times.length) {
      nearStartLengthRef.current = current.times.length;
      callbacksRef.current.onNearStart?.();
    } else if (viewport.from > EDGE_LOAD_THRESHOLD * 2) {
      nearStartLengthRef.current = null;
    }

    if (current.times.length - 1 - viewport.to <= EDGE_LOAD_THRESHOLD && nearEndLengthRef.current !== current.times.length) {
      nearEndLengthRef.current = current.times.length;
      callbacksRef.current.onNearEnd?.();
    } else if (current.times.length - 1 - viewport.to > EDGE_LOAD_THRESHOLD * 2) {
      nearEndLengthRef.current = null;
    }
  };

  const setViewport = (viewport: NativeChartViewport) => {
    edgeLoadingEnabledRef.current = true;
    viewportRef.current = normalizeViewport(viewport, dataRef.current.times.length);
    emitVisibleRange();
    scheduleDraw();
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scheduleDraw();
      emitVisibleRange();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => {
      observer.disconnect();
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      // StrictMode 会重新建立布局 effect；取消后必须释放标记，允许下一次绘制。
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prev = lastDataRef.current;
    const first = times[0];
    const last = times[times.length - 1];
    const fitChanged = prev.fitKey !== fitKey;
    if (fitChanged) {
      crosshairRef.current = null;
      setTooltipState(null);
    }
    if (times.length === 0) {
      viewportRef.current = { from: 0, to: 0 };
      crosshairRef.current = null;
      setTooltipState(null);
      lastDataRef.current = { fitKey, length: 0 };
      lastVisibleSignatureRef.current = "";
      callbacksRef.current.onVisibleRangeChange?.(null);
      scheduleDraw();
      return;
    }

    if (fitChanged || prev.length === 0) {
      edgeLoadingEnabledRef.current = false;
      viewportRef.current = { from: 0, to: times.length - 1 };
    } else if (times.length !== prev.length) {
      const current = viewportRef.current;
      const visible = viewportCount(current);
      const prepended = prev.last === last && times.length > prev.length;
      const appended = prev.first === first && times.length > prev.length && prev.last !== last;
      if (prepended) {
        const added = times.length - prev.length;
        viewportRef.current = { from: current.from + added, to: current.to + added };
      } else if (appended && prev.length - 1 - current.to <= 2) {
        viewportRef.current = { from: Math.max(0, times.length - visible), to: times.length - 1 };
      } else {
        viewportRef.current = current;
      }
      viewportRef.current = normalizeViewport(viewportRef.current, times.length);
    } else {
      viewportRef.current = normalizeViewport(viewportRef.current, times.length);
    }

    lastDataRef.current = { fitKey, length: times.length, first, last };
    emitVisibleRange();
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, fitKey, cachedSeries]);

  useEffect(() => {
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, cachedSeries, theme]);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement> | WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const paneForY = (y: number) => {
    const layout = layoutsRef.current.find((pane) => y >= pane.y && y <= pane.y + pane.height);
    return layout?.id ?? null;
  };

  const paneValueForY = (paneId: string | null, y: number) => {
    const current = dataRef.current;
    if (!paneId || current.times.length === 0) return null;
    const layout = layoutsRef.current.find((pane) => pane.id === paneId);
    if (!layout) return null;
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    const from = clamp(Math.floor(viewport.from), 0, current.times.length - 1);
    const to = clamp(Math.ceil(viewport.to), 0, current.times.length - 1);
    const range = visiblePaneRange(current.series, layout, from, to);
    const bounds = paddedBounds(layout);
    const clampedY = clamp(y, bounds.top, bounds.bottom);
    const ratio = 1 - (clampedY - bounds.top) / bounds.height;
    return range.min + ratio * (range.max - range.min);
  };

  const maybeVibrateTouchCrosshair = (index: number) => {
    if (!enableTouchCrosshairHaptics || typeof navigator.vibrate !== "function") return;
    if (typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(orientation: landscape)").matches) return;
    if (lastHapticCrosshairIndexRef.current === index) return;
    if (lastHapticCrosshairIndexRef.current == null) {
      lastHapticCrosshairIndexRef.current = index;
      return;
    }
    lastHapticCrosshairIndexRef.current = index;
    const now = window.performance.now();
    if (now - lastHapticAtRef.current < TOUCH_CROSSHAIR_HAPTIC_MIN_INTERVAL_MS) return;
    lastHapticAtRef.current = now;
    navigator.vibrate(TOUCH_CROSSHAIR_HAPTIC_MS);
  };

  const updateCrosshair = (x: number, y: number, options?: { haptic?: boolean }) => {
    const current = dataRef.current;
    if (current.times.length === 0 || layoutsRef.current.length === 0) {
      setTooltipState(null);
      return;
    }
    const mapper = createXMapper(layoutsRef.current[0], normalizeViewport(viewportRef.current, current.times.length));
    const index = clamp(Math.round(mapper.xToIndex(x)), 0, current.times.length - 1);
    const paneId = paneForY(y);
    const next = { index, time: current.times[index], paneId, paneValue: paneValueForY(paneId, y), x, y };
    crosshairRef.current = { index: next.index, time: next.time, paneId: next.paneId, y };
    setTooltipState(next);
    if (options?.haptic) maybeVibrateTouchCrosshair(index);
  };

  const startPinch = () => {
    const current = dataRef.current;
    const points = [...activePointersRef.current.values()];
    if (points.length < 2 || current.times.length === 0 || layoutsRef.current.length === 0) return;
    const [a, b] = points;
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    const mapper = createXMapper(layoutsRef.current[0], viewport);
    const center = midpoint(a, b);
    const startCenterIndex = clamp(mapper.xToIndex(center.x), 0, current.times.length - 1);
    const count = viewportCount(viewport);
    pinchRef.current = {
      leftRatio: clamp((startCenterIndex - viewport.from) / count, 0, 1),
      panMode: "direct",
      startCenter: center,
      startCenterIndex,
      startDistance: Math.max(1, pointDistance(a, b)),
      startViewport: viewport,
    };
    dragRef.current = null;
    updateCrosshair(center.x, center.y);
  };

  const updatePinch = () => {
    const current = dataRef.current;
    const pinch = pinchRef.current;
    const points = [...activePointersRef.current.values()];
    if (!pinch || points.length < 2 || current.times.length === 0 || layoutsRef.current.length === 0) return false;
    const [a, b] = points;
    const center = midpoint(a, b);
    const distance = Math.max(1, pointDistance(a, b));
    const mapper = createXMapper(layoutsRef.current[0], normalizeViewport(pinch.startViewport, current.times.length));
    const startCount = viewportCount(pinch.startViewport);
    const nextCount = clamp(
      startCount * (pinch.startDistance / distance),
      Math.min(MIN_VISIBLE_BARS, current.times.length),
      current.times.length,
    );
    const deltaBars = panDeltaBars(center.x - pinch.startCenter.x, mapper.spacing, pinch.panMode);
    const centerIndex = pinch.startCenterIndex + deltaBars;
    const nextFrom = centerIndex - pinch.leftRatio * nextCount;
    setViewport({ from: nextFrom, to: nextFrom + nextCount - 1 });
    updateCrosshair(center.x, center.y);
    return true;
  };

  const handleWheel = (event: WheelEvent) => {
    const current = dataRef.current;
    if (current.times.length === 0 || layoutsRef.current.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromEvent(event);
    const viewport = normalizeViewport(viewportRef.current, current.times.length);
    const mapper = createXMapper(layoutsRef.current[0], viewport);
    const deltaUnit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, sizeRef.current.height)
        : 1;
    const deltaX = event.deltaX * deltaUnit;
    const deltaY = event.deltaY * deltaUnit;
    const horizontalBars = Math.abs(deltaX) > Math.abs(deltaY)
      ? deltaX / Math.max(1, mapper.spacing)
      : 0;
    if (horizontalBars !== 0) {
      setViewport({ from: viewport.from + horizontalBars, to: viewport.to + horizontalBars });
      updateCrosshair(point.x, point.y);
      return;
    }
    const center = clamp(mapper.xToIndex(point.x), 0, current.times.length - 1);
    const currentCount = viewportCount(viewport);
    const factor = Math.exp(clamp(deltaY, -180, 180) * 0.0022);
    const nextCount = clamp(currentCount * factor, Math.min(MIN_VISIBLE_BARS, current.times.length), current.times.length);
    const leftRatio = clamp((center - viewport.from) / currentCount, 0, 1);
    const nextFrom = center - leftRatio * nextCount;
    setViewport({ from: nextFrom, to: nextFrom + nextCount - 1 });
    updateCrosshair(point.x, point.y);
  };
  wheelHandlerRef.current = handleWheel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, []);

  const finishPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    clearLongPressTimer();
    if (inspectPointerIdRef.current === event.pointerId) inspectPointerIdRef.current = null;
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    if (activePointersRef.current.size === 0) dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    scheduleDraw();
  };

  const tooltipContent = tooltipState && renderTooltip ? renderTooltip(tooltipState) : null;
  const tooltipStyle: CSSProperties | undefined = tooltipState
    ? {
      left: tooltipState.x > sizeRef.current.width - 220 ? tooltipState.x - 12 : tooltipState.x + 12,
      maxWidth: "min(14rem, calc(100% - 1rem))",
      top: tooltipState.y > sizeRef.current.height - 150 ? tooltipState.y - 12 : tooltipState.y + 12,
      transform: [
        tooltipState.x > sizeRef.current.width - 220 ? "translateX(-100%)" : "",
        tooltipState.y > sizeRef.current.height - 150 ? "translateY(-100%)" : "",
      ].filter(Boolean).join(" ") || undefined,
    }
    : undefined;

  return (
    <div ref={containerRef} className={["native-stock-chart", className].filter(Boolean).join(" ")} style={{ minWidth: 0, position: "relative" }}>
      <canvas
        ref={canvasRef}
        className="native-stock-chart-canvas block h-full w-full"
        style={{ cursor: dragRef.current ? "grabbing" : "crosshair", touchAction: "none" }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.preventDefault();
          if (dataRef.current.times.length === 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointFromEvent(event);
          activePointersRef.current.set(event.pointerId, point);
          if (activePointersRef.current.size >= 2) {
            clearLongPressTimer();
            inspectPointerIdRef.current = null;
            lastHapticCrosshairIndexRef.current = null;
            startPinch();
            scheduleDraw();
            return;
          }
          pinchRef.current = null;
          dragRef.current = {
            panMode: "direct",
            pointerType: event.pointerType,
            startX: point.x,
            startY: point.y,
            startViewport: viewportRef.current,
          };
          if (event.pointerType === "touch") {
            startTouchInspectTimer(event.pointerId, point);
          } else {
            updateCrosshair(point.x, point.y);
          }
          scheduleDraw();
        }}
        onPointerMove={(event) => {
          event.preventDefault();
          const point = pointFromEvent(event);
          if (activePointersRef.current.has(event.pointerId)) {
            activePointersRef.current.set(event.pointerId, point);
          }
          if (activePointersRef.current.size >= 2) {
            clearLongPressTimer();
            inspectPointerIdRef.current = null;
            lastHapticCrosshairIndexRef.current = null;
            if (!pinchRef.current) startPinch();
            if (updatePinch()) return;
          }
          if (inspectPointerIdRef.current === event.pointerId) {
            updateCrosshair(point.x, point.y, { haptic: true });
            scheduleDraw();
            return;
          }
          updateCrosshair(point.x, point.y);
          const current = dataRef.current;
          if (dragRef.current && layoutsRef.current.length > 0 && current.times.length > 0) {
            if (dragRef.current.pointerType === "touch" && longPressTimerRef.current != null) {
              const movement = Math.hypot(point.x - dragRef.current.startX, point.y - dragRef.current.startY);
              if (movement <= TOUCH_PAN_THRESHOLD_PX) {
                scheduleDraw();
                return;
              }
              clearLongPressTimer();
            }
            const mapper = createXMapper(layoutsRef.current[0], normalizeViewport(dragRef.current.startViewport, current.times.length));
            const deltaBars = panDeltaBars(point.x - dragRef.current.startX, mapper.spacing, dragRef.current.panMode);
            setViewport({
              from: dragRef.current.startViewport.from + deltaBars,
              to: dragRef.current.startViewport.to + deltaBars,
            });
          } else {
            scheduleDraw();
          }
        }}
        onPointerUp={(event) => {
          finishPointer(event);
        }}
        onPointerCancel={(event) => {
          finishPointer(event);
        }}
        onLostPointerCapture={(event) => {
          clearLongPressTimer();
          if (inspectPointerIdRef.current === event.pointerId) inspectPointerIdRef.current = null;
          lastHapticCrosshairIndexRef.current = null;
          activePointersRef.current.delete(event.pointerId);
          if (activePointersRef.current.size < 2) pinchRef.current = null;
          if (activePointersRef.current.size === 0) dragRef.current = null;
          scheduleDraw();
        }}
        onPointerLeave={() => {
          if (!dragRef.current && activePointersRef.current.size === 0) {
            crosshairRef.current = null;
            setTooltipState(null);
            scheduleDraw();
          }
        }}
      />
      {tooltipContent ? (
        <div className="pointer-events-none absolute z-20 w-max" style={tooltipStyle}>
          {tooltipContent}
        </div>
      ) : null}
    </div>
  );
}
export type { NativeCandlePoint, NativeChartPane, NativeChartSeries, NativeChartTheme, NativeChartTooltipState, NativeChartViewport, NativeCrosshairState, NativeCrosshairValueState, NativeHistogramPoint, NativeLinePoint, NativeVisibleRange } from "@/components/charts/native/types";
