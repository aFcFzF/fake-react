
import { readContext } from '../react-context/fiber-context'
import { ExpirationTime, NoWork } from '../react-fiber/expiration-time'
import { Fiber } from '../react-fiber/fiber'
import { computeExpirationTimeForFiber, requestCurrentTime, scheduleWork } from '../react-scheduler'
import { Passive, SideEffectTag, Update as UpdateTag } from '../react-type/effect-type'
import { BasicStateAction, Dispatch, Dispatcher, Hook, HookEffectTag, MountLayout, MountPassive, UnmountMutation, UnmountPassive, Update, UpdateQueue } from '../react-type/hook-type'
import { markWorkInProgressReceivedUpdate } from '../react-work/begin-work'
import { isFunction } from '../utils/getType'
import ReactCurrentDispatcher from './rect-current-dispatcher'

let didScheduleRenderPhaseUpdate: boolean = false
let renderPhaseUpdates: Map<UpdateQueue<any, any>, Update<any, any>> = null // 存储render阶段的queue update

const numberOfReRenders: number = 0

let renderExpirationTime: ExpirationTime = NoWork
let currentlyRenderingFiber: Fiber = null

let currentHook: Hook = null
let nextCurrentHook: Hook = null

let firstWorkInProgressHook: Hook = null
let workInProgressHook: Hook = null
let nextWorkInProgressHook: Hook = null

let remainingExpirationTime: ExpirationTime = NoWork

function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    memoizedState: null,
    baseState: null,
    baseUpdate: null,
    queue: null,
    next: null,
  }

  if (workInProgressHook === null) {
    firstWorkInProgressHook = workInProgressHook = hook // 第一次
  } else {
    workInProgressHook = workInProgressHook.next = hook // 插入链表中
  }
  return workInProgressHook
}

function updateWorkInProgressHook(): Hook {
  if (nextWorkInProgressHook) {
    workInProgressHook = nextWorkInProgressHook
    nextWorkInProgressHook = workInProgressHook.next

    currentHook = nextCurrentHook
    nextCurrentHook = currentHook !== null ? currentHook.next : null
  } else {
    currentHook = nextCurrentHook

    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,
      baseState: currentHook.baseState,
      queue: currentHook.queue,
      baseUpdate: currentHook.baseUpdate,
      next: null,
    }

    if (workInProgressHook === null) {
      workInProgressHook = firstWorkInProgressHook = newHook // 第一次
    } else {
      workInProgressHook = workInProgressHook.next = newHook// 插入链表中
    }
    nextCurrentHook = currentHook.next
  }
  return workInProgressHook
}

function dispatchAction<S, A>(fiber: Fiber, queue: UpdateQueue<S, A>, action: A) {
  const { alternate } = fiber

  // 当前处于render状态
  if (fiber === currentlyRenderingFiber || (alternate !== null && alternate === currentlyRenderingFiber)) {
    didScheduleRenderPhaseUpdate = true // 触发re-render
    const update: Update<S, A> = {
      expirationTime: renderExpirationTime,
      action,
      eagerReducer: null,
      eagerState: null,
      next: null,
    }

    if (renderPhaseUpdates === null) {
      renderPhaseUpdates = new Map()
    }

    const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue)
    if (firstRenderPhaseUpdate === undefined) {
      renderPhaseUpdates.set(queue, update)
    } else {
      let lastRenderPhaseUpdate = firstRenderPhaseUpdate
      while (lastRenderPhaseUpdate.next !== null) {
        lastRenderPhaseUpdate = lastRenderPhaseUpdate.next
      }
      lastRenderPhaseUpdate.next = update
    }
  } else {
    // flushPassiveEffects() // 待实现

    const currentTime = requestCurrentTime()
    const expirationTime = computeExpirationTimeForFiber(currentTime, fiber)
    const update: Update<S, A> = {
      expirationTime,
      action,
      eagerReducer: null,
      eagerState: null,
      next: null,
    }

    const { last } = queue
    if (last === null) {
      update.next = update // 第一个update,创建环形链表
    } else {
      const first = last.next
      if (first !== null) {
        update.next = first
      }
      last.next = update
    }
    queue.last = update

    // 当前工作队列为空，在进入render阶段前提前计算下一个state，update时可以根据eagerReducer直接返回eagerState
    if (fiber.expirationTime === NoWork && (alternate === null || alternate.expirationTime === NoWork)) {
      const { eagerReducer } = queue

      if (eagerReducer !== null) {
        const currentState: S = queue.eagerState
        const eagerState = eagerReducer(currentState, action)

        // 存储提前计算的结果，如果在更新阶段reducer没有发生变化，可以直接使用eager state，不需要重新调用eager reducer在调用一遍
        update.eagerReducer = eagerReducer
        update.eagerState = eagerState

        if (Object.is(eagerState, currentState)) {
          return
        }
      }
    }
    scheduleWork(fiber, expirationTime)
  }
}



const State = {
  basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
    return isFunction(action) ? (action as Function)(state) : action
  },

  mountState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
    if (isFunction(initialState)) {
      initialState = (initialState as Function)()
    }
    return Reducer.mountReducer(State.basicStateReducer, initialState)
  },

  updateState<S>(_initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
    return Reducer.updateReducer(State.basicStateReducer)
  },
}

const Reducer = {
  mountReducer<S, I, A>(reducer: (s: S, a: A) => S, initialArg: I, init?: (i: I) => S): [S, Dispatch<A>] {
    const hook: Hook = mountWorkInProgressHook()

    let initialState: S = null
    if (init !== null) {
      initialState = init(initialArg)
    } else {
      initialState = initialArg as any
    }

    hook.memoizedState = hook.baseState = initialState
    const queue = hook.queue = {
      last: null,
      dispatch: null,
      eagerReducer: reducer,
      eagerState: initialState,
    }

    const dispatch: Dispatch<A> = queue.dispatch = dispatchAction.bind(null, currentlyRenderingFiber, queue)
    return [hook.memoizedState, dispatch]
  },

  updateReducer<S, A>(reducer: (s: S, a: A) => S): [S, Dispatch<A>] {
    const hook = updateWorkInProgressHook()
    const { queue } = hook

    if (numberOfReRenders > 0) { // 处于re-render状态
      const { dispatch: _dispatch } = queue

      if (renderPhaseUpdates !== null) {
        const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue)
        if (firstRenderPhaseUpdate !== undefined) {
          renderPhaseUpdates.delete(queue)

          let newState = hook.memoizedState
          let update = firstRenderPhaseUpdate
          do {
            const { action } = update
            newState = reducer(newState, action)
            update = update.next
          } while (update !== null)

          if (!Object.is(newState, hook.memoizedState)) { // 标记为更新
            markWorkInProgressReceivedUpdate()
          }

          hook.memoizedState = newState

          if (hook.baseUpdate === queue.last) {
            hook.baseState = newState
          }

          queue.eagerReducer = reducer
          queue.eagerState = newState

          return [newState, _dispatch]
        }
      }

      return [hook.memoizedState, _dispatch]
    }

    const { last } = queue
    const { baseState, baseUpdate } = hook

    let first: Update<S, A> = null
    if (baseUpdate !== null) {
      if (last !== null) { // 从一次停顿的地方开始，为了防止无限循环，需把环形链表解开
        last.next = null
      }
      first = baseUpdate.next
    } else {
      first = last !== null ? last.next : null
    }

    if (first !== null) {
      let newState: S = baseState
      let prevUpdate: Update<S, A> = baseUpdate
      let update: Update<S, A> = first

      let newBaseState: S = null
      let newBaseUpdate: Update<S, A> = null
      let didSkip: boolean = false

      do {
        const updateExpirationTime: ExpirationTime = update.expirationTime
        if (updateExpirationTime < renderExpirationTime) {
          if (!didSkip) { // 优先级低需要跳过，如果是第一个跳过的Update,需要记录下来
            didSkip = true
            newBaseState = newState
            newBaseUpdate = prevUpdate
          }

          if (updateExpirationTime > remainingExpirationTime) {
            remainingExpirationTime = updateExpirationTime
          }
        } else {
          if (update.eagerReducer === reducer) { // 直接使用提前计算的结果
            newState = update.eagerState
          } else {
            const { action } = update
            newState = reducer(newState, action)
          }
        }

        prevUpdate = update
        update = update.next
      } while (update !== null && update !== first)

      if (!didSkip) {
        newBaseState = newState
        newBaseUpdate = prevUpdate
      }

      if (!Object.is(newState, hook.memoizedState)) {
        markWorkInProgressReceivedUpdate()
      }

      hook.memoizedState = newState
      hook.baseUpdate = newBaseUpdate
      hook.baseState = newBaseState

      queue.eagerReducer = reducer
      queue.eagerState = newState
    }

    const { dispatch } = queue
    return [hook.memoizedState, dispatch]
  },
}

const Effect = {
  mountEffectImpl(fiberEffectTag: SideEffectTag, hookEffectTag: HookEffectTag, create: () => (() => void) | void, deps?: any[]) {
    return null
  },

  updateEffectImpl(fiberEffectTag: SideEffectTag, hookEffectTag: HookEffectTag, create: () => (() => void) | void, deps?: any[]) {

  },


  mountEffect(create: () => (() => void) | void, deps?: any[]) {
    return Effect.mountEffectImpl(UpdateTag | Passive, UnmountPassive | MountPassive, create, deps)
  },

  updateEffect(create: () => (() => void) | void, deps?: any[]) {
    return Effect.updateEffectImpl(UpdateTag | Passive, UnmountPassive | MountPassive, create, deps)
  },
  mountLayoutEffect(create: () => (() => void) | void, deps?: any[]) {
    return Effect.mountEffectImpl(UpdateTag, UnmountMutation | MountLayout, create, deps)
  },

  updateLayoutEffect(create: () => (() => void) | void, deps?: any[]) {
    return Effect.updateEffectImpl(UpdateTag, UnmountMutation | MountLayout, create, deps)
  },
}



const HooksDispatcherOnMount: Dispatcher = {
  readContext,

  useState: State.mountState,
  useEffect: Effect.mountEffect,
  useContext: readContext,

  useReducer: Reducer.mountReducer,
  useCallback: mountCallback,
  useMemo: mountMemo,
  useRef: mountRef,
  useLayoutEffect: Effect.mountLayoutEffect,
}

const HooksDispatcherOnUpdate: Dispatcher = {
  readContext,

  useState: State.updateState,
  useEffect: Effect.updateEffect,
  useContext: readContext,

  useReducer: Reducer.updateReducer,
  useCallback: updateCallback,
  useMemo: updateMemo,
  useRef: updateRef,
  useLayoutEffect: Effect.updateLayoutEffect,
}



function bailoutHooks(current: Fiber, workInProgress: Fiber, expirationTime: ExpirationTime) {
  workInProgress.updateQueue = current.updateQueue
  workInProgress.effectTag &= ~(Passive | UpdateTag)
  if (current.expirationTime <= expirationTime) {
    current.expirationTime = NoWork
  }
}

function renderWithHooks(current: Fiber, workInProgress: Fiber, Component: Function, props: any, refOrContext: any, nextRenderExpirationTime: ExpirationTime): any {
  renderExpirationTime = nextRenderExpirationTime
  currentlyRenderingFiber = workInProgress
  nextCurrentHook = current !== null ? current.memoizedState : null

  ReactCurrentDispatcher.current = nextCurrentHook === null ? HooksDispatcherOnMount : HooksDispatcherOnUpdate

  const children: any = Component(props, refOrContext)
  // 待实现
  // if (didScheduleRenderPhaseUpdate) {

  // }

  return children
}

export { bailoutHooks, renderWithHooks }
