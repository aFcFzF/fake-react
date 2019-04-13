import { Fiber } from '../react-fiber/fiber'

export type TopLevelType = string

export interface DispatchConfig {
  phasedRegistrationNames?: {
    bubbled: string,
    captured: string,
  },
  dependencies: TopLevelType[],
  registrationName?: string,
  isInteractive?: boolean,
}

export interface ReactSyntheticEvent {
  dispatchConfig: DispatchConfig,
  getPooled: (
    dispatchConfig: DispatchConfig,
    targetInst: Fiber,
    nativeTarget: Event,
    nativeEventTarget: EventTarget,
  ) => ReactSyntheticEvent,
  isPersistent: () => boolean,
}

export interface EventTypes { [key: string]: DispatchConfig }

export type AnyNativeEvent = Event | KeyboardEvent | MouseEvent | Touch

export type PluginName = string

export interface PluginModule<NativeEvent> {
  eventTypes: EventTypes,
  extractEvents: (
    topLevelType: string,
    targetInst: Fiber,
    nativeTarget: NativeEvent,
    nativeEventTarget: EventTarget,
  ) => ReactSyntheticEvent | void,
  tapMoveThreshold?: number,
}

