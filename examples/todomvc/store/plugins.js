import { STORAGE_KEY } from './mutations'
import createLogger from '../../../src/plugins/logger'

const localStoragePlugin = store => {
  /**
   * 操作的 mutation 以及最新的状态
   * @param mutation
   * @param todos
   */
  const fn = (mutation, { todos }) => {
    console.log('订阅触发Todos')
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }

  /**
   * 操作的 action 以及最新的状态
   * @param action
   * @param state
   */
  const actionFn = (action, state) => {
    console.log('actionFn1', action, JSON.stringify(state))
  }

  store.subscribe(fn)
  store.subscribeAction({
    before: actionFn
  })
  store.subscribeAction({
    after: actionFn
  })

  // 监听属性变化
  store.watch((state) => state.todos, (newVal) => {
    console.log(newVal)
  })
}

export default process.env.NODE_ENV !== 'production'
  ? [createLogger(), localStoragePlugin]
  : [localStoragePlugin]
