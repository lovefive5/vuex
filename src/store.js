import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

export class Store {
  /**
   * 构造器
   * @param {*} options
   */
  constructor (options = {}) {
    // console.log('Store 实例化!')
    // debugger
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    // 如果尚未安装且`window`具有`Vue`，则自动安装
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (__DEV__) {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
      plugins = [],
      strict = false
    } = options

    // store internal state
    // 存储内部状态
    this._committing = false
    this._actions = Object.create(null)
    this._actionSubscribers = []
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)
    // 创建model以及关联
    this._modules = new ModuleCollection(options)
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []
    this._watcherVM = new Vue()
    this._makeLocalGettersCache = Object.create(null)

    // bind commit and dispatch to self
    // 引入当前对象
    const store = this

    // 获取 dispatch 和commit
    const { dispatch, commit } = this

    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }

    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    // 获取用户初始化的状态
    console.log('this._modules.root.state', this._modules.root.state)

    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters

    //初始化根模块。
    //这也会递归地注册所有子模块
    //并收集this._wrappedGetters中的所有模块获取器
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)

    //初始化存储虚拟机，该虚拟机负责反应
    //（还将_wrappedGetters注册为计算属性）
    resetStoreVM(this, state)

    // apply plugins
    plugins.forEach(plugin => plugin(this))

    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools

    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  get state () {
    // console.log("get state", this._vm, this._vm._data)
    console.log('Store Get', '获取当前挂载到 [App !!! 不是 VueComponent] Vue 上的state')
    return this._vm._data.$$state
  }

  set state (v) {
    console.log('直接设置值', v)
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  /**
   * 提交 mutation
   * @param _type
   * @param _payload
   * @param _options
   */
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    // 获取提交的函数名和操作
    const mutation = { type, payload }

    // 获取存储的函数
    const entry = this._mutations[type]

    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }

    // 修改全局的 committing 状态
    this._withCommit(() => {
      // 执行包装后的 handler
      entry.forEach(function commitIterator (handler) {
        // 这一步 参见 registerMutation 函数
        handler(payload)
      })
    })

    /**
     * 这里大概就是 mutations 不要异步的关键之一了吧
     * 如果使用异步操作，下面的订阅会先执行，而且 this.state 夜神上一个状态
     */
    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
      .forEach(sub => sub(mutation, this.state))

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  /**
   * 分发操作
   * 订阅分 before 和 after，如果是before ，则在执行action前调用，after在执行action后调用
   * 如果传递的异步不是 Promise,例如只有一个setTimeout，虽然vuex会包装成Promise，但 before和 action还是相当于同步
   * 但如果传递的是一个 Promise 的 setTimeout，则会等 setTimeout的resolve后才会执行 after
   * 如果一定要在action执行完拿到回调，action必须要返回Promise并resolve，其他的如setTimeout并无作用，还是会同时返回。
   * addTodo ({ commit }, text) {
        return new Promise(resolve => {
          setTimeout(() => {
            commit('addTodo', {
              text,
              done: false
            })
            resolve(true)
          }, 5000)
        })
     }
   * @param _type
   * @param _payload
   * @returns {Promise<any>}
   */
  dispatch (_type, _payload) {
    // console.log('dispatch', _type, _payload)
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    // 执行 action 前执行 before 订阅
    try {
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    // 执行 action
    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          this._actionSubscribers
            .filter(sub => sub.after)
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        resolve(res)
      }, error => {
        try {
          this._actionSubscribers
            .filter(sub => sub.error)
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }

  /**
   * 提供订阅
   * @param fn
   * @param options
   * @returns {Function}
   */
  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }

  /**
   * 订阅Action变化，尽量传递对象,如果传递函数，默认是在执行前调用
   * 支持 before 和 after
   * @param fn
   * @param options
   * @returns {Function}
   */
  subscribeAction (fn, options) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers, options)
  }

  /**
   * 监听属性变化
   * @param fn
   * @param cb
   * @param options
   * @returns {() => void}
   */
  watch (fn, cb, options) {
    if (__DEV__) {
      assert(typeof fn === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => fn(this.state, this.getters), cb, options)
  }

  /**
   * 替换State
   * @param state
   */
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  _withCommit (fn) {
    // 获取提交状态并设置提交状态=true
    const committing = this._committing
    this._committing = true
    // 执行函数
    fn()
    // 还原成之前的提交状态
    this._committing = committing
  }
}

/**
 * 通用订阅
 * @param fn
 * @param subs 订阅定义的数组 [this._subscribers等]
 * @param options
 * @returns {Function} // 返回一个函数，如果执行会删除当前任务
 */
function genericSubscribe (fn, subs, options) {
  // 是否添加了订阅函数,并判断是否要前置,后面类似一个队列，挨个执行
  if (subs.indexOf(fn) < 0) {
    // 是否前置
    options && options.prepend ? subs.unshift(fn) : subs.push(fn)
  }

  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

function resetStoreVM (store, state, hot) {

  console.log('resetStoreVM - store, state, hot', store, state, hot)

  // 挂载到 Store 上的 Vue
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}

  // reset local getters cache
  store._makeLocalGettersCache = Object.create(null)

  // 包裹Getters
  const wrappedGetters = store._wrappedGetters
  console.log('store._wrappedGetters', store._wrappedGetters)
  const computed = {}

  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    // 包裹成闭包函数
    computed[key] = partial(fn, store)

    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters 设置可枚举
    })

    console.log('wrappedGetters - update', computed, store)
  })

  // 改造称不封装的写法
  // Object.keys(wrappedGetters).forEach(item => {
  //   const fn = wrappedGetters[item]
  //   const key = item
  //   computed[key] = partial(fn, store)

  //   Object.defineProperty(store.getters, key, {
  //     get: () => store._vm[key],
  //     enumerable: true // for local getters 设置可枚举
  //   })
  // })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins

  //使用Vue实例存储状态树
  //禁止警告，以防万一用户添加了
  //一些时髦的全局mixins
  const silent = Vue.config.silent

  Vue.config.silent = true

  // 新建一个Vue实例
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })

  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

/**
 * 安装module
 * @param store
 * @param rootState
 * @param path
 * @param module
 * @param hot
 */
function installModule (store, rootState, path, module, hot) {
  // 没有多模块的时候 path =[], 就在根上
  const isRoot = !path.length

  // 获取命名空间
  const namespace = store._modules.getNamespace(path)

  console.log('namespace', namespace, module.namespaced)

  // register in namespace map
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && __DEV__) {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      if (__DEV__) {
        if (moduleName in parentState) {
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 当前命名空间的store
  const local = module.context = makeLocalContext(store, namespace, path)

  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 * 进行本地化的调度，提交，获取和声明
 * 如果没有名称空间，只需使用根名称空间
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  // 必须延迟获取getter和state对象
  // 因为它们将被vm update更改
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace
      if (type.slice(0, splitPos) !== namespace) return

      // extract local getter type
      const localType = type.slice(splitPos)

      // Add a port to the getters proxy.
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

/**
 * 对 handler 做一个包装
 * @param store
 * @param type
 * @param handler
 * @param local
 */
function registerMutation (store, type, handler, local) {
  // debugger
  const entry = store._mutations[type] || (store._mutations[type] = [])

  // console.log('registerMutation - entry', Object.prototype.toString.call(entry))

  entry.push(function wrappedMutationHandler (payload) {
    // 让 store - this 调用 handler，然后把 local.state 的数据 和 payload 传递过去
    handler.call(store, local.state, payload)
  })
}

/**
 * 注册用户传递的 Action
 * @param store
 * @param type
 * @param handler
 * @param local
 */
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])

  /**
   * 解惑，为什么在写action里是 {commit}
   */
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)

    // 判断是不是 Promise ，不是则包装一下，但是如果是异步操作比如setTimeout，就会有问题
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }

    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

/**
 * 处理 Getter
 * @param store
 * @param type
 * @param rawGetter
 * @param local
 */
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (__DEV__) {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

/**
 * 开启严格模式会对$state 进行观测，如果发生变化就报错
 * @param store
 */
function enableStrictMode (store) {
  store._vm.$watch(function () {
    return this._data.$$state
  }, () => {
    if (__DEV__) {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

/**
 * 获取嵌套的状态
 * @param state
 * @param path
 * @returns {*}
 */
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

/**
 * 统一对象导出
 * @param type
 * @param payload
 * @param options
 * @returns {{type: *, payload: *, options: *}}
 */
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (__DEV__) {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

export function install (_Vue) {
  // 如果已经执行了 , 提示
  if (Vue && _Vue === Vue) {
    if (__DEV__) {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  // 引入当前的 Vue 对象
  Vue = _Vue
  applyMixin(Vue)
}
