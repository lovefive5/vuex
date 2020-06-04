import Vue from 'vue'
import store from './store'
import App from './components/App.vue'

console.log('注入 store 到 vue.options 上')
new Vue({
  store, // inject store to all children
  el: '#app',
  render: h => h(App)
})
