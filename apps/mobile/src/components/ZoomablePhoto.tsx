import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import {
  LongPressGestureHandler,
  PanGestureHandler,
  PinchGestureHandler,
  State,
  TapGestureHandler,
  type LongPressGestureHandlerStateChangeEvent,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
  type PinchGestureHandlerGestureEvent,
  type PinchGestureHandlerStateChangeEvent,
  type TapGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import AuthImage from "./AuthImage";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

type Props = {
  path: string;
  width: number;
  height: number;
  onZoomChange?: (zoomed: boolean) => void;
  onLongPress?: () => void;
  resetSignal?: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function ZoomablePhoto({
  path,
  width,
  height,
  onZoomChange,
  onLongPress,
  resetSignal,
}: Props) {
  const baseScale = useRef(new Animated.Value(1)).current;
  const pinchScale = useRef(new Animated.Value(1)).current;
  const scale = useRef(Animated.multiply(baseScale, pinchScale)).current;

  const baseTx = useRef(new Animated.Value(0)).current;
  const baseTy = useRef(new Animated.Value(0)).current;
  const panTx = useRef(new Animated.Value(0)).current;
  const panTy = useRef(new Animated.Value(0)).current;
  const tx = useRef(Animated.add(baseTx, panTx)).current;
  const ty = useRef(Animated.add(baseTy, panTy)).current;

  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const doubleTapRef = useRef(null);
  const longPressRef = useRef(null);

  const curScale = useRef(1);
  const curTx = useRef(0);
  const curTy = useRef(0);

  const [zoomed, setZoomed] = useState(false);

  const reportZoom = (next: boolean) => {
    setZoomed((prev) => {
      if (prev !== next) onZoomChange?.(next);
      return next;
    });
  };

  const resetAll = (animated: boolean) => {
    curScale.current = 1;
    curTx.current = 0;
    curTy.current = 0;
    pinchScale.setValue(1);
    panTx.setValue(0);
    panTy.setValue(0);
    if (animated) {
      Animated.parallel([
        Animated.spring(baseScale, { toValue: 1, useNativeDriver: false }),
        Animated.spring(baseTx, { toValue: 0, useNativeDriver: false }),
        Animated.spring(baseTy, { toValue: 0, useNativeDriver: false }),
      ]).start();
    } else {
      baseScale.setValue(1);
      baseTx.setValue(0);
      baseTy.setValue(0);
    }
    reportZoom(false);
  };

  useEffect(() => {
    if (resetSignal === undefined) return;
    resetAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  const onPinchEvent = Animated.event<PinchGestureHandlerGestureEvent>(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: false },
  );

  const onPinchStateChange = (e: PinchGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState !== State.ACTIVE) return;
    const next = clamp(curScale.current * e.nativeEvent.scale, MIN_SCALE, MAX_SCALE);
    curScale.current = next;
    baseScale.setValue(next);
    pinchScale.setValue(1);

    if (next <= MIN_SCALE + 0.001) {
      curTx.current = 0;
      curTy.current = 0;
      Animated.parallel([
        Animated.spring(baseScale, { toValue: 1, useNativeDriver: false }),
        Animated.spring(baseTx, { toValue: 0, useNativeDriver: false }),
        Animated.spring(baseTy, { toValue: 0, useNativeDriver: false }),
      ]).start();
      reportZoom(false);
      return;
    }

    const maxX = ((next - 1) * width) / 2;
    const maxY = ((next - 1) * height) / 2;
    const nx = clamp(curTx.current, -maxX, maxX);
    const ny = clamp(curTy.current, -maxY, maxY);
    if (nx !== curTx.current || ny !== curTy.current) {
      curTx.current = nx;
      curTy.current = ny;
      Animated.parallel([
        Animated.spring(baseTx, { toValue: nx, useNativeDriver: false }),
        Animated.spring(baseTy, { toValue: ny, useNativeDriver: false }),
      ]).start();
    }
    reportZoom(true);
  };

  const onPanEvent = Animated.event<PanGestureHandlerGestureEvent>(
    [{ nativeEvent: { translationX: panTx, translationY: panTy } }],
    { useNativeDriver: false },
  );

  const onPanStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.oldState !== State.ACTIVE) return;
    const { translationX, translationY } = e.nativeEvent;
    const maxX = ((curScale.current - 1) * width) / 2;
    const maxY = ((curScale.current - 1) * height) / 2;
    const nx = clamp(curTx.current + translationX, -maxX, maxX);
    const ny = clamp(curTy.current + translationY, -maxY, maxY);
    curTx.current = nx;
    curTy.current = ny;
    baseTx.setValue(nx);
    baseTy.setValue(ny);
    panTx.setValue(0);
    panTy.setValue(0);
  };

  const onDoubleTap = (e: TapGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.state !== State.ACTIVE) return;
    if (curScale.current > MIN_SCALE + 0.001) {
      resetAll(true);
    } else {
      curScale.current = DOUBLE_TAP_SCALE;
      Animated.spring(baseScale, {
        toValue: DOUBLE_TAP_SCALE,
        useNativeDriver: false,
      }).start();
      reportZoom(true);
    }
  };

  const onLongPressStateChange = (e: LongPressGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.state === State.ACTIVE) {
      onLongPress?.();
    }
  };

  return (
    <LongPressGestureHandler
      ref={longPressRef}
      minDurationMs={400}
      maxDist={10}
      onHandlerStateChange={onLongPressStateChange}
      simultaneousHandlers={[pinchRef, panRef]}
    >
      <TapGestureHandler
        ref={doubleTapRef}
        numberOfTaps={2}
        maxDelayMs={250}
        onHandlerStateChange={onDoubleTap}
      >
        <PinchGestureHandler
          ref={pinchRef}
          simultaneousHandlers={panRef}
          onGestureEvent={onPinchEvent}
          onHandlerStateChange={onPinchStateChange}
        >
          <Animated.View
            collapsable={false}
            style={{ width, height, alignItems: "center", justifyContent: "center" }}
          >
            <PanGestureHandler
              ref={panRef}
              simultaneousHandlers={pinchRef}
              enabled={zoomed}
              minPointers={1}
              maxPointers={2}
              avgTouches
              onGestureEvent={onPanEvent}
              onHandlerStateChange={onPanStateChange}
            >
              <Animated.View
                style={{
                  width,
                  height,
                  transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                }}
              >
                <AuthImage
                  path={path}
                  style={{ width, height }}
                  resizeMode="contain"
                />
              </Animated.View>
            </PanGestureHandler>
          </Animated.View>
        </PinchGestureHandler>
      </TapGestureHandler>
    </LongPressGestureHandler>
  );
}
