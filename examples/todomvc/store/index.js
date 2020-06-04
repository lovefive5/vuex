import Vue from 'vue'
import Vuex from 'vuex'
import { mutations, STORAGE_KEY } from './mutations'
import actions from './actions'
import plugins from './plugins'

Vue.use(Vuex)

// new Vuex.Store 实例化 Store 的方法
console.log('new Vuex.Store 实例化 Store 的方法')
export default new Vuex.Store({
  state: {
    todos: JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
  },
  actions,
  mutations,
  plugins
})
