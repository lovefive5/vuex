export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    // mixin 到vue上 , 注入
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {

      options.init = options.init ? [vuexInit].concat(options.init) : vuexInit

      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   * store 会先被挂载到父组件上，然后 子组件的store会取父组件的store
   */

  /**
   * 执行以下操作的时候，会把 Store 绑定到 Vue.option 上
   * new Vue({
      store, // inject store to all children
      el: '#app',
      render: h => h(App)
    })
   *
   */

  function vuexInit () {
    // console.log('vuex - beforeCreate')
    // console.log("this.$options.store", this.$options.store)
    const options = this.$options
    // store injection  - store 注入
    // console.log('options.store', options.store)
    // debugger
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
